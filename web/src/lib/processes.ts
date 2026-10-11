import type { ActivityResponse, ActivityTask, ActivityWorkflow } from "@/lib/activity";
import type { SubagentsResponse, SubagentView } from "@/lib/types";

// What a session runs besides its own turn, as one list: workflows and background commands from
// the activity reader, subagents from the subagent reader. One shape, so the chip, its list and its
// counts can never disagree about what is running.

export type ProcessState = "waiting" | "running" | "done" | "failed" | "unknown";

export type ProcessItem =
  | { kind: "workflow"; id: string; state: ProcessState; at?: number; workflow: ActivityWorkflow }
  | { kind: "task"; id: string; state: ProcessState; at?: number; task: ActivityTask }
  | { kind: "subagent"; id: string; state: ProcessState; at?: number; agent: SubagentView };

export interface Processes {
  /** Something stopped until you answer: first in the list and the chip's accent. */
  waiting: ProcessItem[];
  running: ProcessItem[];
  /** Finished, failed or unconfirmed, newest first. */
  done: ProcessItem[];
}

const WORKFLOW_STATE: Record<ActivityWorkflow["status"], ProcessState> = { running: "running", completed: "done", failed: "failed", unknown: "unknown" };
const TASK_STATE: Record<ActivityTask["status"], ProcessState> = { running: "running", completed: "done", failed: "failed", unknown: "unknown" };
const SUBAGENT_STATE: Record<SubagentView["status"], ProcessState> = { waiting: "waiting", running: "running", completed: "done", failed: "failed", idle: "unknown", unknown: "unknown" };

function time(iso: string | undefined): number | undefined {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : undefined;
}

/**
 * Sorts both readers' answers into waiting, running and done. A background Agent task is the same
 * agent the subagent reader lists, so it is dropped whenever that list is there. A reader whose last
 * refresh failed cannot vouch for anything still running: its live rows read as unknown.
 */
export function buildProcesses(activity: ActivityResponse | null, subagents: SubagentsResponse | null, { activityStale = false, subagentsStale = false } = {}): Processes {
  const items: ProcessItem[] = [];
  const live = (state: ProcessState, stale: boolean): ProcessState => stale && (state === "running" || state === "waiting") ? "unknown" : state;
  if (activity?.available) {
    for (const workflow of activity.workflows) {
      const end = workflow.startedAt !== undefined && workflow.durationMs !== undefined ? workflow.startedAt + workflow.durationMs : undefined;
      items.push({ kind: "workflow", id: workflow.runId, state: live(WORKFLOW_STATE[workflow.status], activityStale), at: end ?? workflow.updatedAt ?? workflow.startedAt, workflow });
    }
    for (const task of activity.tasks) {
      if (task.kind === "agent" && subagents?.available) continue;
      items.push({ kind: "task", id: task.id, state: live(TASK_STATE[task.status], activityStale), at: task.at, task });
    }
  }
  if (subagents?.available) {
    for (const agent of subagents.agents) {
      items.push({ kind: "subagent", id: agent.id, state: live(SUBAGENT_STATE[agent.status], subagentsStale), at: time(agent.updatedAt), agent });
    }
  }
  return {
    waiting: items.filter((item) => item.state === "waiting"),
    running: items.filter((item) => item.state === "running"),
    done: items.filter((item) => item.state !== "waiting" && item.state !== "running").sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
  };
}

/** "1 waiting on you", "3 running", or null when nothing needs showing. */
export function processesLabel({ waiting, running }: Processes): string | null {
  if (waiting.length) return `${waiting.length} waiting on you`;
  if (running.length) return `${running.length} running`;
  return null;
}

/** "3 done" or "2 published": what the quiet chip says once nothing waits or runs, or null for nothing. */
export function finishedLabel({ done }: Processes, published: number): string | null {
  if (done.length) return `${done.length} done`;
  if (published) return `${published} published`;
  return null;
}

export function processName(item: ProcessItem): string {
  return item.kind === "workflow" ? item.workflow.name : item.kind === "task" ? item.task.title : item.agent.name;
}
