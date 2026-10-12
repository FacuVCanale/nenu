import { parseInline, type MdSpan } from "./markdown";
import type { AgentStatus, TranscriptEntry, TranscriptPart } from "./types";

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
export type StepKind = "terminal" | "read" | "edit" | "write" | "search" | "web" | "agent" | "plan" | "question" | "tool";
export interface ToolStepDescription {
  kind: StepKind;
  /** Past tense for a finished step ("Ran"), present for the one in progress ("Running"). */
  done: string;
  doing: string;
  /** The request, while a dialog asks the operator about the call ("Run"): it has not run yet. */
  ask: string;
  /** How the call's summary is drawn: a path keeps its file name whole, code stays monospace, a document by its title. */
  target: "path" | "code" | "text" | "title";
}

// Names across harnesses: Claude Code, Codex and pi spell the same few tools differently.
const TOOL_STEPS: Array<[RegExp, ToolStepDescription]> = [
  [/^(bash|shell|exec|exec_command|local_shell|run_shell_command)$/, { kind: "terminal", done: "Ran", doing: "Running", ask: "Run", target: "code" }],
  [/^(read|read_file|view|notebookread)$/, { kind: "read", done: "Read", doing: "Reading", ask: "Read", target: "path" }],
  [/^(edit|multiedit|edit_file|notebookedit|str_replace_editor|str_replace_based_edit_tool)$/, { kind: "edit", done: "Edited", doing: "Editing", ask: "Edit", target: "path" }],
  [/^apply_patch$/, { kind: "edit", done: "Edited", doing: "Editing", ask: "Edit", target: "text" }],
  [/^(write|write_file|create_file)$/, { kind: "write", done: "Wrote", doing: "Writing", ask: "Write", target: "path" }],
  [/^(grep|glob|find|rg|search|search_files|codebase_search)$/, { kind: "search", done: "Searched", doing: "Searching", ask: "Search", target: "code" }],
  [/^(ls|list_dir|list_directory)$/, { kind: "search", done: "Listed", doing: "Listing", ask: "List", target: "path" }],
  [/^(webfetch|web_fetch|fetch)$/, { kind: "web", done: "Fetched", doing: "Fetching", ask: "Fetch", target: "text" }],
  [/^(websearch|web_search)$/, { kind: "web", done: "Searched the web", doing: "Searching the web", ask: "Search the web", target: "text" }],
  [/^(task|agent|spawn_agent)$/, { kind: "agent", done: "Ran agent", doing: "Running agent", ask: "Run agent", target: "text" }],
  [/^(todowrite|update_plan)$/, { kind: "plan", done: "Updated the plan", doing: "Updating the plan", ask: "Update the plan", target: "text" }],
  // Claude's plan, shown to the operator to approve: the line says Plan once, with the plan's title.
  [/^exitplanmode$/, { kind: "plan", done: "Plan", doing: "Plan", ask: "Plan", target: "title" }],
];

/** A call the bridge read questions from (its `questions`) reads as the question it asks. */
export const QUESTION_STEP: ToolStepDescription = { kind: "question", done: "Question", doing: "Question", ask: "Question", target: "text" };

// Claude Code's spelling of an MCP tool: mcp__<server>__<tool>.
const MCP_TOOL = /^mcp__.+?__(.+)$/;

/** A tool call as a step; a tool it does not know keeps its own name (an MCP tool's, without its server) as the verb. */
export function describeTool(name: string): ToolStepDescription {
  const key = name.toLowerCase();
  const own = MCP_TOOL.exec(name)?.[1] ?? name;
  return TOOL_STEPS.find(([pattern]) => pattern.test(key))?.[1] ?? { kind: "tool", done: own, doing: own, ask: own, target: "text" };
}

/** The words the renderer draws for `spans`, without their formatting. */
function plain(spans: MdSpan[]): string {
  return spans.map((span) => "text" in span ? span.text : span.kind === "image" ? span.alt : plain(span.spans)).join("");
}

// A heading's hashes and a quote's marker are syntax the renderer never prints.
const BLOCK_MARK = /^(?:#{1,6}\s+|>\s?)/;

/**
 * The first line of `text` that has words, as the rendered thought reads it: Codex and pi open a
 * thought with a `**bold title**`, and a preview must not show the asterisks.
 */
export function firstLine(text: string): string {
  return text.split("\n").map((line) => plain(parseInline(line.trim().replace(BLOCK_MARK, ""))).trim()).find(Boolean) ?? "";
}

/**
 * What a running turn is doing now: a call still waiting for its result, or the thought being
 * written. `entry` and `index` name that part, so the timeline draws it once, as the turn's live row.
 */
export interface LiveStep {
  part: Extract<TranscriptPart, { kind: "tool" | "thinking" }>;
  entry: string;
  index: number;
  since?: string;
}

export function liveStep(turn: WorkTurn): LiveStep | null {
  if (!turn.active) return null;
  const at = (entry: TranscriptEntry, index: number) => ({ entry: entry.uuid, index, ...(validTime(entry.ts) ? { since: entry.ts } : {}) });
  // Parallel calls finish in any order, so the latest call still waiting for its result is the one
  // in progress, wherever it sits; only with none does the turn's last part say what happens now.
  for (const entry of turn.activity.toReversed()) {
    const index = entry.parts.findLastIndex((part) => part.kind === "tool" && !part.result);
    const part = entry.parts[index];
    if (part?.kind === "tool") return { part, ...at(entry, index) };
  }
  // Between steps there is nothing to name, and the turn's own line already says it is working.
  const last = turn.activity.at(-1);
  const index = last ? last.parts.findLastIndex((part) => part.kind !== "image") : -1;
  const part = last?.parts[index];
  return last && part?.kind === "thinking" ? { part, ...at(last, index) } : null;
}
