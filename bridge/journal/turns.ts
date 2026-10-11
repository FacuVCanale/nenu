import type { TranscriptEntry, TranscriptTurn } from "./types.ts";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown): string | undefined => typeof value === "string" && /^[a-zA-Z0-9._-]{1,200}$/.test(value) ? value : undefined;
const duration = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const timestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return undefined;
  return value;
};
const epoch = (value: unknown): string | undefined => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8640000000000 ? new Date(value * 1000).toISOString() : undefined;

/** Enrich existing entries; event rows never create duplicate transcript speech or change cursors. */
class TurnTracker {
  protected turns = new Map<string, TranscriptTurn>();
  protected entryTurns = new WeakMap<TranscriptEntry, string>();
  protected current: string | undefined;
  attach(entry: TranscriptEntry) {
    if (this.current && (entry.role === "assistant" || entry.role === "user")) this.entryTurns.set(entry, this.current);
  }
  finish(entries: TranscriptEntry[]): TranscriptEntry[] {
    for (const entry of entries) {
      const turnId = this.entryTurns.get(entry), turn = turnId ? this.turns.get(turnId) : undefined;
      if (turnId && turn) { entry.turnId = turnId; entry.turn = turn; }
    }
    return entries;
  }
}

export class CodexTurnTracker extends TurnTracker {
  observe(row: { type?: unknown; payload?: unknown }) {
    const p = object(row.payload), turnId = id(p.turn_id);
    if ((row.type === "turn_context" || row.type === "event_msg" && p.type === "task_started") && turnId) {
      this.current = turnId;
      const turn = p.type === "task_started" ? { status: "running" as const } : this.turns.get(turnId) ?? { status: "running" as const };
      const startedAt = epoch(p.started_at);
      if (startedAt) turn.startedAt = startedAt;
      this.turns.set(turnId, turn);
    }
    if (row.type !== "event_msg" || !turnId || (p.type !== "task_complete" && p.type !== "turn_aborted")) return;
    const turn = this.turns.get(turnId) ?? { status: "running" as const };
    turn.status = p.type === "task_complete" ? "completed" : "aborted";
    const startedAt = epoch(p.started_at), completedAt = epoch(p.completed_at), durationMs = duration(p.duration_ms);
    if (startedAt) turn.startedAt = startedAt;
    if (completedAt) turn.completedAt = completedAt;
    if (durationMs !== undefined) turn.durationMs = durationMs;
    this.turns.set(turnId, turn);
    if (this.current === turnId) this.current = undefined;
  }
  /** The turn a `task_started` (or `turn_context`) opened and nothing closed yet. */
  openTurn(): string | undefined {
    return this.current !== undefined && this.turns.get(this.current)?.status === "running" ? this.current : undefined;
  }
}

/** Claude has no work-turn id. Anchor a group to an actual human uuid (or the first assistant uuid
 * of a continuation after completion), propagate through native
 * parentUuid links (including hidden tool-result rows), and trust only end_turn / turn_duration
 * for completion. No estimate of a start time or elapsed work is made from assistant timestamps.
 */
export class ClaudeTurnTracker extends TurnTracker {
  private rowTurns = new Map<string, string>();
  private messageTurns = new Map<string, string>();
  private active = new Map<boolean, string>();
  observe(row: Record<string, unknown>, human = false) {
    const uuid = id(row.uuid), parent = id(row.parentUuid), sidechain = row.isSidechain === true;
    const message = object(row.message), stop = message.stop_reason, messageId = id(message.id);
    const knownRow = uuid ? this.rowTurns.get(uuid) : undefined;
    const knownMessage = row.type === "assistant" && messageId ? this.messageTurns.get(messageId) : undefined;
    this.current = knownRow ?? knownMessage ?? (parent ? this.rowTurns.get(parent) : this.active.get(sidechain));
    if (human && uuid) {
      this.current = `cl-${uuid}`;
      this.active.set(sidechain, this.current);
    }
    if (!this.current) return;
    if (row.type === "assistant" && uuid && !knownRow && !knownMessage && this.turns.get(this.current)?.status === "completed") {
      // Background completions can trigger another response without a new human message. A new
      // response after end_turn is a new work group; its final must not replace the earlier answer.
      // Native API message ids keep thinking/text chunks together even when their row UUIDs differ.
      this.current = `cl-${uuid}`;
      this.active.set(sidechain, this.current);
    }
    if (uuid) this.rowTurns.set(uuid, this.current);
    if (row.type === "assistant" && messageId) this.messageTurns.set(messageId, this.current);
    const completed = row.type === "assistant" && stop === "end_turn";
    const measured = row.type === "system" && row.subtype === "turn_duration" && duration(row.durationMs) !== undefined;
    if (!completed && !measured && !(row.type === "assistant" && stop === "tool_use")) return;
    const turn = this.turns.get(this.current) ?? { status: "running" as const };
    if (completed || measured) {
      turn.status = "completed";
      const completedAt = timestamp(row.timestamp);
      if (completedAt && (measured || turn.durationMs === undefined)) turn.completedAt = completedAt;
    }
    if (measured) turn.durationMs = duration(row.durationMs);
    this.turns.set(this.current, turn);
  }
}
