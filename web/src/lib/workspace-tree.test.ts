import { describe, expect, it } from "vitest";

import type { AgentView, TabView, WorkspaceView } from "@/lib/types";
import { workspaceTree } from "./workspace-tree";

function workspace(workspaceId: string, number: number): WorkspaceView {
  return { workspaceId, number, label: workspaceId, focused: false, activeTabId: `${workspaceId}:t`, tabCount: 1, paneCount: 1 };
}

function pane(paneId: string, workspaceId: string, times: { active?: number; seen?: number } = {}): AgentView {
  return {
    paneId, workspaceId, workspaceLabel: workspaceId, workspaceNumber: 1, tabId: `${workspaceId}:t`, agent: "claude", status: "idle",
    cwd: "/", focused: false, lastActiveAt: times.active, lastSeenAt: times.seen,
  };
}

const tab = (workspaceId: string): TabView => ({ tabId: `${workspaceId}:t`, workspaceId, number: 1, label: "main", focused: false, paneCount: 1 });

describe("workspaceTree", () => {
  it("puts the workspace that moved or was opened last first, and only marks the one on screen", () => {
    const herd = {
      workspaces: [workspace("old", 1), workspace("here", 2), workspace("busy", 3), workspace("visited", 4)],
      tabs: [tab("old"), tab("here"), tab("busy"), tab("visited")],
      agents: [
        pane("old:p", "old", { active: 10, seen: 5 }),
        pane("here:p", "here", { active: 20, seen: 30 }),
        // An agent that just changed state counts, not only the last time someone opened it.
        pane("busy:p", "busy", { active: 90, seen: 1 }),
        pane("visited:p", "visited", { active: 2, seen: 60 }),
      ],
      shellPanes: [],
    };
    const branches = workspaceTree(herd, "", "here:p");
    expect(branches.map((branch) => branch.workspace.workspaceId)).toEqual(["busy", "visited", "here", "old"]);
    expect(branches.filter((branch) => branch.current).map((branch) => branch.workspace.workspaceId)).toEqual(["here"]);
  });

  it("keeps Herdr's order between workspaces nothing has happened in", () => {
    const herd = {
      workspaces: [workspace("b", 2), workspace("a", 1)],
      tabs: [tab("a"), tab("b")],
      agents: [pane("a:p", "a"), pane("b:p", "b")],
      shellPanes: [],
    };
    expect(workspaceTree(herd).map((branch) => branch.workspace.workspaceId)).toEqual(["a", "b"]);
  });
});
