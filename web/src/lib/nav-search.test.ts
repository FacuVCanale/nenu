import { describe, expect, it } from "vitest";

import { matchRange, navSearch, type SearchHit } from "./nav-search";
import type { AgentView, ProjectView } from "./types";

function pane(paneId: string, extra: Partial<AgentView> = {}): AgentView {
  return { paneId, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status: "idle", cwd: "/", focused: false, ...extra };
}

const project: ProjectView = {
  slug: "hub", name: "Hub", status: "active",
  coordinator: { paneId: "c", agent: "claude", liveStatus: "working" },
  threads: [
    { id: "T1", title: "Build", parentId: "root", role: "worker", status: "open", paneId: "a", liveStatus: "working" },
    { id: "T2", title: "Review", parentId: "root", role: "worker", status: "open", paneId: "b", liveStatus: "blocked" },
    { id: "T3", title: "Queued", parentId: "root", role: "worker", status: "starting" },
    { id: "T0", title: "Old", parentId: "root", role: "worker", status: "resolved", paneId: "z", liveStatus: "working" },
  ],
};

describe("navigation search", () => {
  const names = (hits: SearchHit[]) => hits.map((hit) => hit.title);
  const groups = (query: string, source = herd, limit?: number) =>
    navSearch(source, query, limit).map((group) => [group.label, names(group.hits), group.more]);
  const herd = {
    agents: [
      pane("idle", { paneLabel: "Idle Claude", lastActiveAt: 10 }),
      pane("work", { paneLabel: "Working Claude", lastActiveAt: 30 }),
      pane("ask", { paneLabel: "Blocked Claude", lastActiveAt: 20, status: "blocked" }),
      pane("cx", { paneLabel: "Codex", agent: "codex", lastActiveAt: 40 }),
      pane("note", { paneLabel: "Notes", workspaceLabel: "claws", lastActiveAt: 50 }),
      pane("c", { lastActiveAt: 5 }),
      pane("b", { paneLabel: "raw review", lastActiveAt: 5 }),
    ],
    shellPanes: [pane("sh", { kind: "shell", paneLabel: "dev server", agent: "" })],
    projects: [project],
  };

  it("lists the agents whose name matches, newest first, ahead of those matching only by where they live", () => {
    expect(groups("cla")).toEqual([["Chats", ["Working Claude", "Blocked Claude", "Idle Claude", "Notes"], 0]]);
    const work = navSearch(herd, "cla")[0]!.hits[0]!;
    expect(work).toMatchObject({ kind: "pane", key: "pane:work", place: { place: "w", tab: null } });
  });

  it("files a project, its coordinator and its threads under Projects, never again under Chats", () => {
    expect(groups("hub")).toEqual([["Projects", ["Hub", "Hub coordinator"], 0]]);
    expect(groups("review")).toEqual([["Projects", ["Review"], 0]]);
    const review = navSearch(herd, "review")[0]!.hits[0]!;
    expect(review).toMatchObject({ kind: "node", state: "needs", place: { place: "Hub", tab: null } });
  });

  it("finds shells and resolved threads too, open work first", () => {
    expect(groups("serv")).toEqual([["Chats", ["dev server"], 0]]);
    expect(groups("o")[0]).toEqual(["Projects", ["Hub coordinator", "Old"], 0]);
  });

  it("caps each group and says how many more there are", () => {
    const many = { agents: Array.from({ length: 11 }, (_, i) => pane(`a${i}`, { paneLabel: `Agent ${i}` })), shellPanes: [], projects: [] };
    expect(groups("agent", many, 8)).toEqual([["Chats", ["Agent 0", "Agent 1", "Agent 2", "Agent 3", "Agent 4", "Agent 5", "Agent 6", "Agent 7"], 3]]);
  });

  it("finds a workspace by its name, between Projects and Chats", () => {
    const ws = (workspaceId: string, number: number, label: string) => ({ workspaceId, number, label, focused: false, activeTabId: "", tabCount: 2, paneCount: 1 });
    const source = { ...herd, workspaces: [ws("w9", 9, "claws"), ws("w2", 2, "api")] };
    expect(groups("claw", source)).toEqual([["Workspaces", ["claws"], 0], ["Chats", ["Notes"], 0]]);
    expect(navSearch(source, "claw")[0]!.hits[0]).toMatchObject({ kind: "workspace", key: "workspace:w9", place: { place: "2 tabs", tab: null } });
  });

  it("finds an agent by its kind, its folder or its terminal's title, below the agents whose name matches", () => {
    const source = {
      agents: [
        pane("fix", { paneLabel: "Fix login", agent: "codex", cwd: "/home/me/shop-api", terminalTitle: "vim auth.ts", lastActiveAt: 60 }),
        pane("cx", { paneLabel: "Codex", agent: "codex", lastActiveAt: 40 }),
        pane("cl", { paneLabel: "Claude", agent: "claude", lastActiveAt: 50 }),
      ],
      shellPanes: [], projects: [],
    };
    expect(groups("codex", source)).toEqual([["Chats", ["Codex", "Fix login"], 0]]);
    expect(groups("shop-api", source)).toEqual([["Chats", ["Fix login"], 0]]);
    expect(groups("auth.ts", source)).toEqual([["Chats", ["Fix login"], 0]]);
    // The kind is a whole word: a partial name does not list every agent of that kind.
    expect(groups("cod", source)).toEqual([["Chats", ["Codex"], 0]]);
  });

  it("leads with the group holding the best match, so the first row picked is the closest name", () => {
    const source = {
      agents: [pane("c", { cwd: "/srv/billing", lastActiveAt: 90 }), pane("bill", { paneLabel: "Billing fix", lastActiveAt: 10 })],
      shellPanes: [], projects: [project],
    };
    expect(groups("billing", source)).toEqual([["Chats", ["Billing fix"], 0], ["Projects", ["Hub coordinator"], 0]]);
  });

  it("finds nothing without a query", () => {
    expect(navSearch(herd, "  ")).toEqual([]);
  });

  it("locates the matched text, ignoring case", () => {
    expect(matchRange("Working Claude", "cla")).toEqual([8, 11]);
    expect(matchRange("Working Claude", " CLA ")).toEqual([8, 11]);
    expect(matchRange("Codex", "cla")).toBeNull();
    expect(matchRange("Codex", "")).toBeNull();
  });
});
