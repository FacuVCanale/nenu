import type { AgentStatus, TranscriptEntry } from "./types";

export interface WorkTurn {
  kind: "work";
  id: string;
  entries: TranscriptEntry[];
  activity: TranscriptEntry[];
  answer: TranscriptEntry | null;
  active: boolean;
  settled: boolean;
  interrupted: boolean;
  startedAt?: string;
  durationMs?: number;
}
export type WorkTimelineRow = { kind: "message"; entry: TranscriptEntry } | WorkTurn;
const validTime = (value: string | undefined) => value && Number.isFinite(Date.parse(value)) ? value : undefined;

export function formatWorkDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Group work without rewriting journal entries or moving user/system content into an agent fold. */
export function buildWorkTimeline(entries: TranscriptEntry[], status?: AgentStatus): WorkTimelineRow[] {
  const rows: WorkTimelineRow[] = [];
  let group: TranscriptEntry[] = [];
  let userBoundary: TranscriptEntry | undefined;
  let systemBoundary = "";
  const usedTurnIds = new Set<string>();
  const lastAssistant = entries.findLast((entry) => entry.role === "assistant");

  function flush(bounded: boolean) {
    if (!group.length) return;
    const original = group;
    group = [];
    const first = original[0]!;
    const last = original.at(-1)!;
    const native = original.findLast((entry) => entry.turn)?.turn;
    const isLatest = last.uuid === lastAssistant?.uuid && !bounded;
    const active = isLatest && status === "working" && native?.status !== "completed" && native?.status !== "aborted";
    const explicitFinal = original.findLast((entry) => entry.phase === "final_answer" && entry.parts.some((part) => part.kind === "text"));
    const settled = !!explicitFinal || native?.status === "completed" || native?.status === "aborted" || (bounded && native?.status !== "running") ||
      (isLatest && native?.status !== "running" && status !== undefined && status !== "working" && status !== "blocked" && status !== "unknown");
    const hasWork = original.some((entry) => entry.phase === "commentary" || entry.parts.some((part) => part.kind !== "text"));
    // Old logs with only unclassified prose do not give us permission to hide earlier answers.
    if (!hasWork) { rows.push(...original.map((entry) => ({ kind: "message" as const, entry }))); return; }
    const terminal = explicitFinal ?? (!active && settled ? original.findLast((entry) =>
      entry.phase !== "commentary" && entry.parts.some((part) => part.kind === "text") && !entry.parts.some((part) => part.kind === "tool"),
    ) : undefined);
    const answer = terminal ? { ...terminal, parts: terminal.parts.filter((part) => part.kind === "text") } : null;
    const activity = original.flatMap((entry) => {
      if (entry !== terminal) return [entry];
      const parts = entry.parts.filter((part) => part.kind !== "text");
      return parts.length ? [{ ...entry, parts }] : [];
    });
    const startedAt = validTime(native?.startedAt) ?? validTime(userBoundary?.ts);
    const end = validTime(native?.completedAt) ?? (settled ? validTime(last.ts) : undefined);
    const measured = typeof native?.durationMs === "number" && Number.isFinite(native.durationMs) && native.durationMs >= 0 ? native.durationMs : undefined;
    const elapsed = startedAt && end ? Date.parse(end) - Date.parse(startedAt) : undefined;
    const durationMs = measured ?? (elapsed !== undefined && elapsed >= 0 ? elapsed : undefined);
    const baseId = first.turnId ?? userBoundary?.uuid ?? `orphan:${first.uuid}`;
    const id = usedTurnIds.has(baseId) ? `${baseId}:after:${systemBoundary || first.uuid}` : baseId;
    usedTurnIds.add(baseId);
    rows.push({ kind: "work", id,
      entries: original, activity, answer, active, settled, interrupted: native?.status === "aborted",
      ...(startedAt ? { startedAt } : {}), ...(durationMs !== undefined ? { durationMs } : {}) });
  }

  for (const entry of entries) {
    if (entry.role !== "assistant") {
      flush(true);
      rows.push({ kind: "message", entry });
      userBoundary = entry.role === "user" ? entry : undefined;
      systemBoundary = entry.uuid;
      continue;
    }
    const before = group.at(-1);
    if (before && (before.phase === "final_answer" || before.turnId !== entry.turnId || (!entry.turnId && before.ts.slice(0, 10) !== entry.ts.slice(0, 10)))) {
      flush(true);
      userBoundary = undefined;
    }
    group.push(entry);
  }
  flush(false);
  return rows;
}

/** What a tool call is to the reader: its icon, and the verbs a row says it with. */
export type StepKind = "terminal" | "read" | "edit" | "write" | "search" | "web" | "agent" | "plan" | "tool";
export interface ToolStepDescription {
  kind: StepKind;
  /** Past tense for a finished step ("Ran"), present for the one in progress ("Running"). */
  done: string;
  doing: string;
  /** How the call's summary is drawn: a path keeps its file name whole, code stays monospace. */
  target: "path" | "code" | "text";
}

// Names across harnesses: Claude Code, Codex and pi spell the same few tools differently.
const TOOL_STEPS: Array<[RegExp, ToolStepDescription]> = [
  [/^(bash|shell|exec|exec_command|local_shell|run_shell_command)$/, { kind: "terminal", done: "Ran", doing: "Running", target: "code" }],
  [/^(read|read_file|view|notebookread)$/, { kind: "read", done: "Read", doing: "Reading", target: "path" }],
  [/^(edit|multiedit|edit_file|notebookedit|str_replace_editor|str_replace_based_edit_tool)$/, { kind: "edit", done: "Edited", doing: "Editing", target: "path" }],
  [/^apply_patch$/, { kind: "edit", done: "Edited", doing: "Editing", target: "text" }],
  [/^(write|write_file|create_file)$/, { kind: "write", done: "Wrote", doing: "Writing", target: "path" }],
  [/^(grep|glob|find|rg|search|search_files|codebase_search)$/, { kind: "search", done: "Searched", doing: "Searching", target: "code" }],
  [/^(ls|list_dir|list_directory)$/, { kind: "search", done: "Listed", doing: "Listing", target: "path" }],
  [/^(webfetch|web_fetch|fetch)$/, { kind: "web", done: "Fetched", doing: "Fetching", target: "text" }],
  [/^(websearch|web_search)$/, { kind: "web", done: "Searched the web", doing: "Searching the web", target: "text" }],
  [/^(task|agent|spawn_agent)$/, { kind: "agent", done: "Ran agent", doing: "Running agent", target: "text" }],
  [/^(todowrite|update_plan)$/, { kind: "plan", done: "Updated the plan", doing: "Updating the plan", target: "text" }],
];

/** A tool call as a step; a tool it does not know keeps its own name as the verb. */
export function describeTool(name: string): ToolStepDescription {
  const key = name.toLowerCase();
  return TOOL_STEPS.find(([pattern]) => pattern.test(key))?.[1] ?? { kind: "tool", done: name, doing: name, target: "text" };
}

/** The first line of `text` that has words, trimmed: what a one-line preview of a thought shows. */
export function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/**
 * What a running turn is doing now: the call that has no result yet, or the thought being written.
 * `entry` and `index` name that part, so the timeline draws it once, as this live row; between
 * steps there is no part to name and the row only says Working.
 */
export interface LiveStep {
  kind: StepKind | "thinking" | "working";
  verb: string;
  target: string;
  format: ToolStepDescription["target"] | "thought";
  since?: string;
  entry?: string;
  index?: number;
}

export function liveStep(turn: WorkTurn): LiveStep | null {
  if (!turn.active) return null;
  const entry = turn.activity.at(-1);
  const index = entry ? entry.parts.findLastIndex((part) => part.kind !== "image") : -1;
  const part = entry?.parts[index];
  const at = { ...(validTime(entry?.ts) ? { since: entry!.ts } : {}), entry: entry?.uuid, index };
  if (part?.kind === "tool" && !part.result) {
    const step = describeTool(part.name);
    return { kind: step.kind, verb: step.doing, target: part.summary, format: step.target, ...at };
  }
  if (part?.kind === "thinking") return { kind: "thinking", verb: "Thinking", target: firstLine(part.text), format: "thought", ...at };
  return { kind: "working", verb: "Working", target: "", format: "text" };
}
