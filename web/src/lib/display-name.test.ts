import { describe, expect, it } from "vitest";

import { displayName, displayPlace } from "./display-name";
import type { AgentView, ProjectView } from "./types";

function pane(paneId: string, extra: Partial<AgentView> = {}): AgentView {
  return { paneId, workspaceId: "w1", workspaceLabel: "nenu", workspaceNumber: 1, tabId: "w1:t1", agent: "claude", status: "idle", cwd: "/repo", focused: false, ...extra };
}

const projects: ProjectView[] = [{
  slug: "awam", name: "Awam", status: "active",
  coordinator: { paneId: "coord", agent: "claude", liveStatus: "working" },
  threads: [
    { id: "T1", title: "Panel depósito", parentId: "root", role: "worker", status: "open", paneId: "worker", liveStatus: "blocked" },
    { id: "T2", title: "  ", parentId: "root", role: "worker", status: "open", paneId: "untitled", liveStatus: "idle" },
  ],
}];

describe("displayName", () => {
  it("calls a project's worker by its thread title, whatever Herdr or Claude call the pane", () => {
    const worker = pane("worker", { paneLabel: "Blocked Claude", sessionName: "deposit-panel", tabLabel: "redesign" });
    expect(displayName(worker, projects)).toBe("Panel depósito");
  });

  it("calls a project's coordinator after its project", () => {
    expect(displayName(pane("coord", { paneLabel: "Working Claude" }), projects)).toBe("Awam coordinator");
  });

  it("falls back from the pane label to the session name, the terminal title, then the agent", () => {
    expect(displayName(pane("p", { paneLabel: "Reviewer", sessionName: "s", terminalTitle: "t" }), projects)).toBe("Reviewer");
    expect(displayName(pane("p", { sessionName: "billing-fix", terminalTitle: "t" }), projects)).toBe("billing-fix");
    expect(displayName(pane("p", { terminalTitle: "Running tests" }), projects)).toBe("Running tests");
    expect(displayName(pane("p"), projects)).toBe("claude");
    expect(displayName(pane("p", { kind: "shell" }), undefined)).toBe("shell");
  });

  it("does not let a blank thread title hide the pane's own name", () => {
    expect(displayName(pane("untitled", { paneLabel: "Scratch" }), projects)).toBe("Scratch");
  });

  it("never names a pane after its tab, so the tab can be the line under it", () => {
    expect(displayName(pane("p", { tabLabel: "redesign" }), projects)).not.toBe("redesign");
  });
});

describe("displayPlace", () => {
  it("places a loose pane in its workspace and tab", () => {
    expect(displayPlace(pane("p", { tabLabel: "redesign" }), projects)).toBe("nenu › redesign");
  });

  it("drops a tab whose label says nothing, and names an unlabelled workspace by number", () => {
    expect(displayPlace(pane("p"), projects)).toBe("nenu");
    expect(displayPlace(pane("p", { workspaceLabel: "", workspaceNumber: 2 }), projects)).toBe("Workspace 2");
  });

  it("places a project's worker in its project", () => {
    expect(displayPlace(pane("worker", { tabLabel: "redesign" }), projects)).toBe("Awam");
  });

  it("places the coordinator where it runs, since its name already says the project", () => {
    expect(displayPlace(pane("coord", { tabLabel: "coordinator" }), projects)).toBe("nenu › coordinator");
  });
});
