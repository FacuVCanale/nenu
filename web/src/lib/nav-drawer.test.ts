import { describe, expect, it } from "vitest";

import type { AgentView, ProjectView } from "@/lib/types";
import { drawerSections, RECENT_CHATS } from "./nav-drawer";

function pane(paneId: string, status: AgentView["status"], active: number, extra: Partial<AgentView> = {}): AgentView {
  return {
    paneId, workspaceId: "w", workspaceLabel: "Developer", workspaceNumber: 1, tabId: "t", agent: "claude", status,
    cwd: "/", focused: false, lastActiveAt: active, paneLabel: paneId, ...extra,
  };
}

describe("drawerSections", () => {
  it("lists what needs you newest first, then the other chats by last activity with the open one marked", () => {
    const agents = [
      pane("quiet", "idle", 10),
      pane("asks-old", "blocked", 20),
      pane("here", "working", 30, { lastSeenAt: 95 }),
      pane("asks-new", "blocked", 80),
      pane("done", "done", 90),
    ];
    const { needsYou, recent } = drawerSections({ agents, projects: [] }, "here");
    expect(needsYou.map((row) => row.pane.paneId)).toEqual(["asks-new", "asks-old"]);
    // A chat waiting on you is already above; Recent does not list it twice.
    expect(recent.map((row) => [row.pane.paneId, row.current])).toEqual([["here", true], ["done", false], ["quiet", false]]);
    expect(recent[0]).toMatchObject({ title: "here", place: "Developer", at: 95 });
  });

  it("keeps Recent short and names a project's chat after its thread and project", () => {
    const agents = Array.from({ length: RECENT_CHATS + 3 }, (_, i) => pane(`p${i}`, "idle", 100 - i));
    const projects = [{
      slug: "awam", name: "AWAM", goal: "", status: "active",
      threads: [{ id: "t-1", title: "Panel depósito", parentId: "root", role: "worker", status: "open", paneId: "p0" }],
    }] as ProjectView[];
    const { recent } = drawerSections({ agents, projects }, undefined);
    expect(recent).toHaveLength(RECENT_CHATS);
    expect(recent[0]).toMatchObject({ title: "Panel depósito", place: "AWAM" });
  });
});
