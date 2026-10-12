import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import type { HomeData } from "@/lib/loaders";
import type { AgentView, ProjectView } from "@/lib/types";
import { WorkbenchSidebar } from "./workbench-sidebar";

function pane(paneId: string, paneLabel: string, lastActiveAt = 0): AgentView {
  return { paneId, paneLabel, lastActiveAt, workspaceId: "w", workspaceLabel: "w", workspaceNumber: 1, tabId: "t", agent: "claude", status: "idle", cwd: "/", focused: false };
}

beforeEach(() => localStorage.clear());

describe("the sidebar's workspaces, with no projects", () => {
  const herd = {
    agents: [
      { ...pane("d1", "", 50), paneLabel: undefined, workspaceId: "w2", workspaceLabel: "Design", tabId: "t-coord", terminalTitle: "Landing vs Max", status: "done" },
      { ...pane("d2", "", 40), paneLabel: undefined, workspaceId: "w2", workspaceLabel: "Design", tabId: "t-panels", tabLabel: "panels", terminalTitle: "Panel prod", status: "working" },
      { ...pane("d3", "", 30), paneLabel: undefined, workspaceId: "w2", workspaceLabel: "Design", tabId: "t-panels", tabLabel: "panels", terminalTitle: "Panel ventas", status: "blocked" },
      { ...pane("n1", "", 90), paneLabel: undefined, workspaceId: "w1", workspaceLabel: "Nenu", tabId: "t-nenu", terminalTitle: "Workspaces brief", status: "working" },
    ],
    shellPanes: [],
    workspaces: [
      { workspaceId: "w1", number: 1, label: "Nenu", focused: false, activeTabId: "t-nenu", tabCount: 1, paneCount: 1 },
      { workspaceId: "w2", number: 2, label: "Design", focused: false, activeTabId: "t-coord", tabCount: 2, paneCount: 3 },
    ],
    tabs: [
      { tabId: "t-nenu", workspaceId: "w1", number: 1, label: "main", focused: true, paneCount: 1 },
      { tabId: "t-coord", workspaceId: "w2", number: 1, label: "coordinator", focused: false, paneCount: 1 },
      { tabId: "t-panels", workspaceId: "w2", number: 2, label: "panels", focused: false, paneCount: 2 },
    ],
    projects: [], sessions: [], session: undefined,
  } as unknown as HomeData;

  let router: ReturnType<typeof createMemoryRouter>;
  function open(path: string) {
    router = createMemoryRouter([
      { path: "/", element: <WorkbenchSidebar data={herd} /> },
      { path: "/pane/:paneId", element: <WorkbenchSidebar data={herd} /> },
    ], { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return userEvent.setup();
  }
  const workspaces = () => within(screen.getByRole("region", { name: "Workspaces" }));

  it("puts the workspace that moved last first, marks and opens the one on screen, and lists a split tab's panes with their state", () => {
    open("/pane/d1");
    expect(workspaces().getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["Nenu", "Design"]);

    const design = screen.getByRole("region", { name: "Design" });
    expect(within(design).getByRole("link", { name: /^Design/ })).toHaveAttribute("aria-current", "true");
    expect(within(screen.getByRole("region", { name: "Nenu" })).getByRole("link", { name: /^Nenu/ })).not.toHaveAttribute("aria-current");
    expect(within(design).getByRole("button", { name: "Design panes" })).toHaveAttribute("aria-expanded", "true");
    // The workspace opens on the agent asking for you.
    expect(within(design).getByRole("link", { name: /^Design/ })).toHaveAttribute("href", "/pane/d3");
    // A one-pane tab's row is named after its agent, as the chat it opens is.
    expect(within(design).getByRole("link", { name: /^Landing vs Max/ })).toHaveAttribute("aria-current", "page");
    expect(within(design).getByRole("link", { name: /^Landing vs Max/ })).toHaveTextContent("Landing vs Maxdone");
    const panels = within(design).getByRole("group", { name: "panels" });
    expect(within(panels).getAllByRole("link").map((link) => link.textContent)).toEqual(["Panel prodworking", "Panel ventasneeds you"]);

    // Elsewhere, a workspace with nothing waiting on you starts folded.
    expect(screen.getByRole("button", { name: "Nenu panes" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Workspaces brief")).not.toBeInTheDocument();
  });

  it("remembers a fold", async () => {
    const user = open("/");
    // On Home nothing is on screen: the workspace holding a blocked agent opens, the rest wait.
    expect(screen.getByRole("button", { name: "Design panes" })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Nenu panes" }));
    expect(screen.getByText("Workspaces brief")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("collie:sidebar:v1")!)).toEqual({ expanded: {}, workspaces: { w1: true } });
  });

  it("searches agents by name: the matches in a list, the first picked, arrows move the pick and Enter opens it", async () => {
    const user = open("/");
    await user.click(screen.getByRole("button", { name: /^Search/ }));
    const box = screen.getByRole("searchbox");
    await user.type(box, "panel");
    const results = screen.getByRole("listbox", { name: "Search results" });
    expect(within(results).queryByRole("region")).toBeNull();
    const options = () => within(results).getAllByRole("option");
    // Named as everywhere else, where it lives underneath, the newest to move first.
    expect(options().map((option) => option.textContent)).toEqual(["Panel prodDesign · panels, working", "Panel ventasDesign · panels, needs you"]);
    expect(options()[0]!.querySelector("mark")).toHaveTextContent("Panel");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options()[0]!.id);

    await user.keyboard("{ArrowDown}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(options()[0]).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/pane/d3");
  });

  it("says when nothing matches", async () => {
    const user = open("/");
    await user.click(screen.getByRole("button", { name: /^Search/ }));
    await user.type(screen.getByRole("searchbox"), "nothing like it");
    expect(screen.getByText("No matches for “nothing like it”")).toBeInTheDocument();
    expect(screen.queryByRole("option")).toBeNull();
  });
});

describe("the sidebar", () => {
  const thread = (id: string, title: string, parentId: string, extra: Partial<ProjectView["threads"][number]> = {}): ProjectView["threads"][number] =>
    ({ id, title, parentId, role: "worker", status: "open", ...extra });
  const awam: ProjectView = {
    slug: "awam", name: "AWAM", status: "active", workspaceIds: ["w1"],
    coordinator: { paneId: "c", agent: "codex", liveStatus: "working" },
    threads: [
      thread("t1", "rediseño mobile", "root", { role: "coordinator", paneId: "lead", liveStatus: "idle" }),
      thread("t2", "panel depo", "t1", { paneId: "depo", liveStatus: "blocked" }),
      thread("t3", "panel merca", "t1", { paneId: "merca", liveStatus: "idle", group: "ready-for-review" }),
      thread("t4", "landing", "root"),
      thread("t5", "old", "t1", { status: "resolved" }),
    ],
  };
  const at = (paneId: string, workspaceId: string, status: AgentView["status"] = "idle"): AgentView =>
    ({ ...pane(paneId, paneId), workspaceId, workspaceLabel: workspaceId, tabId: `${workspaceId}:t`, status });
  const herd = {
    agents: [at("c", "w1", "working"), at("lead", "w1"), at("depo", "w1", "blocked"), at("merca", "w1"), at("stray", "w1"), at("loose", "w2", "working")],
    shellPanes: [],
    workspaces: [
      { workspaceId: "w1", number: 1, label: "AWAM ws", focused: true, activeTabId: "w1:t", tabCount: 1, paneCount: 5 },
      { workspaceId: "w2", number: 2, label: "soflex", focused: false, activeTabId: "w2:t", tabCount: 1, paneCount: 1 },
    ],
    tabs: [
      { tabId: "w1:t", workspaceId: "w1", number: 1, label: "main", focused: true, paneCount: 5 },
      { tabId: "w2:t", workspaceId: "w2", number: 1, label: "main", focused: true, paneCount: 1 },
    ],
    projects: [awam], sessions: [], session: undefined, bridge: "connected", error: false,
  } as unknown as HomeData;

  function open(path = "/", source: HomeData = herd) {
    const router = createMemoryRouter([
      { path: "/", element: <WorkbenchSidebar data={source} /> },
      { path: "/pane/:paneId", element: <WorkbenchSidebar data={source} /> },
    ], { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return userEvent.setup();
  }

  it("nests threads under their coordinator and marks what needs you and what is ready for review", () => {
    open("/pane/depo");
    const project = screen.getByRole("region", { name: "AWAM" });
    const lead = within(project).getByRole("group", { name: "rediseño mobile" });
    expect(within(lead).getByRole("link", { name: /^rediseño mobile/ })).toHaveAttribute("href", "/pane/lead");
    expect(within(lead).getByRole("link", { name: /^panel depo/ })).toHaveAccessibleName("panel depo, needs you");
    expect(within(lead).getByRole("link", { name: /^panel depo/ })).toHaveAttribute("aria-current", "page");
    expect(within(lead).getByRole("link", { name: "panel merca, ready for review" })).toHaveTextContent("review");
    // A root worker sits beside the coordinator thread, and the resolved one folds into History.
    expect(within(project).getByRole("link", { name: /^landing/ }).closest("[role=group]")).toBeNull();
    expect(within(project).getByRole("button", { name: /^History/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(project).queryByText("old")).not.toBeInTheDocument();
    // A pane in the project's workspace that runs no thread still has a row.
    expect(within(project).getByRole("link", { name: /^stray/ })).toHaveAttribute("href", "/pane/stray");
  });

  it("lists only the workspaces no project holds, and folds a coordinator's threads", async () => {
    const user = open();
    const workspaces = screen.getByRole("region", { name: "Workspaces" });
    expect(within(workspaces).getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["soflex"]);
    // soflex holds one pane, so its name opens that pane rather than a page of one.
    expect(within(workspaces).getByRole("link", { name: /^soflex/ })).toHaveAttribute("href", "/pane/loose");
    await user.click(screen.getByRole("button", { name: "rediseño mobile threads" }));
    expect(screen.queryByText("panel depo")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("collie:sidebar:v1")!).expanded).toEqual({ "awam/t1": false });
  });

  it("finds a project's nodes under Projects and any other pane under Chats", async () => {
    const user = open();
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("panel");
    const projects = screen.getByRole("group", { name: "Projects" });
    expect(within(projects).getAllByRole("option").map((option) => option.getAttribute("href"))).toEqual(["/pane/depo", "/pane/merca"]);
    await user.clear(screen.getByRole("searchbox"));
    await user.keyboard("stray");
    const chats = screen.getByRole("group", { name: "Chats" });
    expect(within(chats).getByRole("option", { name: /^stray/ })).toHaveAttribute("href", "/pane/stray");
    expect(screen.queryByRole("group", { name: "Projects" })).toBeNull();
  });

  it("shows a coordinator thread's own state beside its threads' dots", () => {
    const blocked = { ...awam, threads: awam.threads.map((item) => item.id === "t1" ? { ...item, liveStatus: "blocked" as const } : item) };
    open("/", { ...herd, projects: [blocked] });
    const head = screen.getByRole("link", { name: /^rediseño mobile/ });
    expect(head).toHaveAccessibleName("rediseño mobile, needs you");
    expect(head.querySelector(".nav-row-word")).toHaveTextContent("needs you");
  });

  it("counts what needs you and narrows the list to it", async () => {
    const user = open();
    const needsYou = screen.getByRole("button", { name: "Needs you, 1" });
    await user.click(needsYou);
    expect(needsYou).toHaveAttribute("aria-pressed", "true");
    const list = screen.getByRole("region", { name: "Needs you" });
    expect(within(list).getAllByRole("link").map((link) => link.textContent)).toEqual(["panel depoAWAM, needs you"]);
    await user.click(needsYou);
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
  });

  it("lists open work most urgent first with coordinators ahead, and History as a closed grey tree of node details", async () => {
    const org: ProjectView = { ...awam, threads: [
      thread("t1", "landing", "root"),
      thread("t2", "panel depo", "root", { paneId: "depo", liveStatus: "blocked" }),
      thread("t3", "rediseño", "root", { role: "coordinator", paneId: "lead", liveStatus: "idle" }),
      thread("t4", "merca", "t3", { paneId: "merca", liveStatus: "idle", group: "ready-for-review" }),
      thread("t9", "old plan", "root", { role: "coordinator", status: "resolved", updated: "2026-09-01T00:00:00Z" }),
      thread("t10", "old step", "t9", { status: "resolved", updated: "2026-09-01T01:00:00Z" }),
      thread("t11", "new fix", "root", { status: "resolved", updated: "2026-10-01T00:00:00Z" }),
      thread("t12", "newer plan", "root", { role: "coordinator", status: "resolved", updated: "2026-10-02T00:00:00Z" }),
    ] };
    const user = open("/", { ...herd, projects: [org] });
    const project = within(screen.getByRole("region", { name: "AWAM" }));
    const names = () => project.getAllByRole("link").map((link) => link.querySelector(".nav-row-text")?.textContent);
    expect(names()).toEqual(["AWAM", "Coordinator", "rediseño", "merca", "panel depo", "landing", "stray"]);
    // A node with no live pane opens its own detail, not the project.
    expect(project.getByRole("link", { name: /^landing/ })).toHaveAttribute("href", "/project/awam/node/t1");

    const history = project.getByRole("button", { name: /^History/ });
    expect(history).toHaveAttribute("aria-expanded", "false");
    expect(project.queryByText("new fix")).not.toBeInTheDocument();
    await user.click(history);
    expect(names().slice(7)).toEqual(["newer plan", "old plan", "new fix"]);
    expect(project.getByRole("link", { name: /^new fix/ })).toHaveAttribute("href", "/project/awam/node/t11");
    await user.click(project.getByRole("button", { name: "old plan threads" }));
    expect(names().slice(7)).toEqual(["newer plan", "old plan", "old step", "new fix"]);
  });

  it("calls the coordinator what every other view calls it, in Needs you and the drawer's Recent", async () => {
    const asking = { ...awam, coordinator: { ...awam.coordinator!, liveStatus: "blocked" as const } };
    const source = { ...herd, agents: herd.agents.map((agent) => agent.paneId === "c" ? { ...agent, status: "blocked" as const, tabLabel: "lead" } : agent), projects: [asking] };
    const user = open("/", source);
    await user.click(screen.getByRole("button", { name: "Needs you, 2" }));
    const list = screen.getByRole("region", { name: "Needs you" });
    expect(within(list).getAllByRole("link").map((link) => link.querySelector(".nav-pane-title")?.textContent)).toEqual(["AWAM coordinator", "panel depo"]);
  });

  it("names a chat in the drawer's Recent as the chat names itself, with its workspace and tab under it", () => {
    const source = { ...herd, agents: herd.agents.map((agent) => agent.paneId === "c" ? { ...agent, tabLabel: "lead" } : agent) };
    const router = createMemoryRouter([{ path: "/pane/:paneId", element: <WorkbenchSidebar data={source} variant="drawer" /> }], { initialEntries: ["/pane/loose"] });
    render(<RouterProvider router={router} />);
    const recent = within(screen.getByRole("region", { name: "Recent" }));
    const coordinator = recent.getByRole("link", { name: /^AWAM coordinator/ });
    expect(coordinator.querySelector(".nav-pane-detail")).toHaveTextContent("w1 · lead");
  });

  it("opens History on its five newest nodes and leaves the rest to the project page", async () => {
    const done = (n: number, day: number, extra: Partial<ProjectView["threads"][number]> = {}) =>
      thread(`h${n}`, `done ${n}`, "root", { status: "resolved", updated: `2026-10-0${day}T00:00:00Z`, ...extra });
    const org: ProjectView = { ...awam, threads: [
      done(1, 1), done(2, 2), done(3, 3, { role: "coordinator" }), done(4, 4), done(5, 5), done(6, 6), done(7, 7), done(8, 8, { parentId: "h3" }),
    ] };
    const user = open("/", { ...herd, projects: [org] });
    const project = within(screen.getByRole("region", { name: "AWAM" }));
    await user.click(project.getByRole("button", { name: /^History/ }));
    // The five that moved last, still drawn coordinators first; the rest is one tap away.
    const names = project.getAllByRole("link").map((link) => link.querySelector(".nav-row-text")?.textContent).filter((name) => name?.startsWith("done"));
    expect(names).toEqual(["done 3", "done 7", "done 6", "done 5", "done 4"]);
    expect(project.getByRole("link", { name: "Show all 8 in project" })).toHaveAttribute("href", "/project/awam");
  });

  it("marks Home as the page on screen only on Home", () => {
    open("/");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("leaves Home unmarked in a chat", () => {
    open("/pane/depo");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("names the host and what it holds in the footer, beside Settings", () => {
    open();
    expect(screen.getByText("2 workspaces · 6 agents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});
