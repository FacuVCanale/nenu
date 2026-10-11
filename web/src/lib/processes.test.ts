import { describe, expect, test } from "vitest";
import type { ActivityResponse } from "@/lib/activity";
import type { SubagentsResponse } from "@/lib/types";
import { buildProcesses, processesLabel } from "./processes";

const workflow = (runId: string, status: "running" | "completed", startedAt: number, durationMs?: number) =>
  ({ runId, name: runId, status, startedAt, durationMs, phases: [], agentCount: 2, doneCount: status === "running" ? 0 : 2 });

const activity: ActivityResponse = {
  available: true, sessionKey: "s", truncated: false, artifacts: [],
  workflows: [workflow("wf-live", "running", 1_000), workflow("wf-old", "completed", 100, 400)],
  tasks: [
    { id: "b1", kind: "bash", title: "bun test --watch", status: "running", at: 2_000, hasOutput: true },
    { id: "ag1", kind: "agent", title: "reviewer", status: "running", at: 2_000, hasOutput: false },
    { id: "b2", kind: "bash", title: "bun run build", status: "failed", exitCode: 1, at: 3_000, hasOutput: true },
  ],
};
const subagents: SubagentsResponse = {
  available: true, sessionKey: "k", truncated: false, agents: [
    { id: "a1", parentId: "", name: "reviewer", task: "Review", status: "waiting", updatedAt: new Date(5_000).toISOString() },
    { id: "a2", parentId: "", name: "explorer", task: "Explore", status: "running" },
    { id: "a3", parentId: "", name: "ui-audit", task: "Audit", status: "completed", updatedAt: new Date(4_000).toISOString() },
  ],
};

describe("buildProcesses", () => {
  test("puts what waits on you first, then what runs, then what ended newest first", () => {
    const p = buildProcesses(activity, subagents);
    expect(p.waiting.map((i) => i.id)).toEqual(["a1"]);
    expect(p.running.map((i) => i.id)).toEqual(["wf-live", "b1", "a2"]);
    expect(p.done.map((i) => i.id)).toEqual(["a3", "b2", "wf-old"]);
  });

  test("a background Agent task is the subagent already listed, unless there is no subagent list", () => {
    expect(buildProcesses(activity, subagents).running.some((i) => i.id === "ag1")).toBe(false);
    expect(buildProcesses(activity, null).running.map((i) => i.id)).toEqual(["wf-live", "b1", "ag1"]);
  });

  test("a reader that failed its last refresh vouches for nothing still running", () => {
    const p = buildProcesses(activity, subagents, { subagentsStale: true });
    expect(p.waiting).toEqual([]);
    expect(p.running.map((i) => i.id)).toEqual(["wf-live", "b1"]);
    expect(p.done.filter((i) => i.state === "unknown").map((i) => i.id).sort()).toEqual(["a1", "a2"]);
  });

  test("an unavailable reader contributes nothing", () => {
    const p = buildProcesses({ available: false, reason: "unsupported" }, { available: false, reason: "no-session" });
    expect(p).toEqual({ waiting: [], running: [], done: [] });
    expect(processesLabel(p)).toBeNull();
  });
});

test("the chip names who waits on you before what runs", () => {
  expect(processesLabel(buildProcesses(activity, subagents))).toBe("1 waiting on you");
  expect(processesLabel(buildProcesses(activity, null))).toBe("3 running");
});
