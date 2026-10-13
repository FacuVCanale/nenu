import type { TranscriptEntry } from "./journal/types.ts";
import type { OrgProjectView } from "./projects.ts";
import type { AgentView } from "./types.ts";

// What a notification says about a pane, so the operator can tell from the lock screen who finished,
// what it answered and where, instead of "claude is done" sixteen times. Pure: the bridge hands in
// the session's projects and the pane's journal (server.ts); tests hand in fixtures.

export type NotifiableStatus = "blocked" | "done";

/** Who a pane is to the operator: one of a project's threads, its coordinator, or a loose agent. */
export type AlertKind = "agent" | "thread" | "coordinator";

export interface AlertDetail {
  status: NotifiableStatus;
  kind: AlertKind;
  /** The turn that just ended was started by a subagent or background task finishing, not by the operator. */
  background: boolean;
  /** The thread's id and title, "<project> coordinator", or the pane's own label. */
  name: string;
  /** The project, or the workspace (and tab) the pane runs in. */
  where: string;
  /** The first line of the agent's last answer, for a finished turn whose journal could be read. */
  summary?: string;
}

const SUMMARY_MAX = 120;

export function describeAlert(
  agent: AgentView,
  status: NotifiableStatus,
  projects: readonly OrgProjectView[] = [],
  entries: readonly TranscriptEntry[] | null = null,
): AlertDetail {
  const outcome = status === "done" && entries ? turnOutcome(entries) : { background: false };
  for (const project of projects) {
    if (project.coordinator?.paneId === agent.paneId) {
      return { status, kind: "coordinator", name: `${project.name} coordinator`, where: project.name, ...outcome };
    }
    const thread = project.threads.find((t) => t.paneId === agent.paneId);
    if (thread) return { status, kind: "thread", name: `${thread.id} ${thread.title}`.trim(), where: project.name, ...outcome };
  }
  const label = [agent.paneLabel, agent.sessionName, agent.tabLabel, agent.terminalTitle].find((l) => names(l, agent.agent));
  if (!label) return { status, kind: "agent", name: agent.workspaceLabel, where: "", ...outcome };
  const tab = names(agent.tabLabel, agent.agent) && agent.tabLabel !== label ? ` · ${agent.tabLabel}` : "";
  return { status, kind: "agent", name: label, where: `${agent.workspaceLabel}${tab}`, ...outcome };
}

/** A label that tells a pane apart: not a positional tab number, nor the title the CLI gives itself. */
function names(label: string | undefined, agent: string): label is string {
  const l = label?.trim().toLowerCase() ?? "";
  return l !== "" && !/^\d+$/.test(l) && l !== agent.toLowerCase() && !CLI_TITLES.has(l);
}

/** Titles the CLIs set before the session has a name (measured: Claude Code's). */
const CLI_TITLES = new Set(["claude code", "claude", "codex", "pi", "opencode", "grok"]);

/**
 * What started the turn the journal ends with, and the first line of its last answer. Walks back
 * over the turn's answers to the row that started it: the operator's message, or a row a finished
 * background task wrote. Other notes (a skill's prompt, a command's output, "Interrupted") belong to
 * whatever turn they sit in, so the walk passes them.
 */
export function turnOutcome(entries: readonly TranscriptEntry[]): { background: boolean; summary?: string } {
  let summary: string | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (entry.role === "assistant") {
      summary ??= firstLine(entry.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n"));
      continue;
    }
    if (entry.role === "user") return { background: false, ...(summary ? { summary } : {}) };
    if (entry.background) return { background: true, ...(summary ? { summary } : {}) };
  }
  return { background: false, ...(summary ? { summary } : {}) };
}

/** The first line that says something, without Markdown's marks, cut on a word to fit a lock screen. */
function firstLine(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((l) => l.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, "").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim())
    .find((l) => l !== "");
  if (!line || line.length <= SUMMARY_MAX) return line;
  const cut = line.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut}…`;
}
