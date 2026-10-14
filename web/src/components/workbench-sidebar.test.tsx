import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeData } from "@/lib/loaders";
import type { AgentView, ProjectView } from "@/lib/types";
import { WorkbenchSidebar, type SidebarRequest } from "./workbench-sidebar";

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

  it("keeps the results in place and the pick on its row while polls move the agents", async () => {
    let poll!: (data: HomeData) => void;
    function Live() {
      const [data, setData] = useState(herd);
      poll = setData;
      return <WorkbenchSidebar data={data} />;
    }
    router = createMemoryRouter([{ path: "/", element: <Live /> }, { path: "/pane/:paneId", element: <Live /> }]);
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Search/ }));
    await user.type(screen.getByRole("searchbox"), "a");
    const titles = () => screen.getAllByRole("option").map((option) => option.querySelector(".nav-pane-title")?.textContent);
    const picked = () => screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true")?.querySelector(".nav-pane-title")?.textContent;
    expect(titles()).toEqual(["Workspaces brief", "Landing vs Max", "Panel prod", "Panel ventas"]);
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(picked()).toBe("Panel prod");

    // Panel ventas moves: the list does not reorder under the pick.
    act(() => poll({ ...herd, agents: herd.agents.map((agent) => agent.paneId === "d3" ? { ...agent, lastActiveAt: 100 } : agent) }));
    expect(titles()).toEqual(["Workspaces brief", "Landing vs Max", "Panel prod", "Panel ventas"]);
    expect(picked()).toBe("Panel prod");

    // A row above it closes: the pick stays on the row it was on.
    act(() => poll({ ...herd, agents: herd.agents.filter((agent) => agent.paneId !== "n1") }));
    expect(titles()).toEqual(["Landing vs Max", "Panel prod", "Panel ventas"]);
    expect(picked()).toBe("Panel prod");
    await user.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/pane/d2");
  });

  it("keeps a search through a navigation it did not make, and ends it once its pick is on screen", async () => {
    const user = open("/pane/d1");
    await user.click(screen.getByRole("button", { name: /^Search/ }));
    await user.type(screen.getByRole("searchbox"), "panel");
    // The chat on screen closes and its page replaces itself: the half-typed search stays.
    await act(() => router.navigate("/pane/n1", { replace: true }));
    expect(screen.getByRole("searchbox")).toHaveValue("panel");

    await user.click(screen.getByRole("searchbox"));
    await user.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/pane/d2");
    expect(screen.queryByRole("searchbox")).toBeNull();
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
  const acme: ProjectView = {
    slug: "acme", name: "Acme", status: "active", workspaceIds: ["w1"],
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
      { workspaceId: "w1", number: 1, label: "Acme ws", focused: true, activeTabId: "w1:t", tabCount: 1, paneCount: 5 },
      { workspaceId: "w2", number: 2, label: "globex", focused: false, activeTabId: "w2:t", tabCount: 1, paneCount: 1 },
    ],
    tabs: [
      { tabId: "w1:t", workspaceId: "w1", number: 1, label: "main", focused: true, paneCount: 5 },
      { tabId: "w2:t", workspaceId: "w2", number: 1, label: "main", focused: true, paneCount: 1 },
    ],
    projects: [acme], sessions: [], session: undefined, bridge: "connected", error: false,
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
    const project = screen.getByRole("region", { name: "Acme" });
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

  it("marks the project's coordinator with the workflow glyph", () => {
    open();
    const coordinator = within(screen.getByRole("region", { name: "Acme" })).getByRole("link", { name: /^Coordinator/ });
    expect(coordinator.querySelector("svg.icon")).toHaveClass("icon-workflow");
  });

  it("marks each project with its own glyph, never its initial, in the tree, the drawer and Search", async () => {
    const docs: ProjectView = { slug: "docs-site", name: "Docs", status: "active", threads: [] };
    const source = { ...herd, projects: [acme, docs] } as unknown as HomeData;
    const glyphs = () => [...document.querySelectorAll(".nav-project svg[data-glyph]")].map((svg) => svg.getAttribute("data-glyph"));
    const user = open("/", source);
    expect(glyphs()).toEqual(["bolt", "spark"]);
    expect(document.querySelector(".nav-avatar")).toBeNull();
    expect(screen.getByRole("link", { name: /^Docs/ })).toHaveTextContent(/^Docs$/);
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.keyboard("docs");
    const hit = within(screen.getByRole("group", { name: "Projects" })).getByRole("option", { name: /^Docs/ });
    expect(hit.querySelector("svg[data-glyph]")).toHaveAttribute("data-glyph", "spark");
  });

  it("marks the drawer's projects with the same glyphs", () => {
    const router = createMemoryRouter([{ path: "/", element: <WorkbenchSidebar data={herd} variant="drawer" /> }]);
    render(<RouterProvider router={router} />);
    expect([...document.querySelectorAll(".nav-project svg[data-glyph]")].map((svg) => svg.getAttribute("data-glyph"))).toEqual(["bolt"]);
    expect(document.querySelector(".nav-avatar")).toBeNull();
  });

  it("lists only the workspaces no project holds, and folds a coordinator's threads", async () => {
    const user = open();
    const workspaces = screen.getByRole("region", { name: "Workspaces" });
    expect(within(workspaces).getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["globex"]);
    // globex holds one pane, so its name opens that pane rather than a page of one.
    expect(within(workspaces).getByRole("link", { name: /^globex/ })).toHaveAttribute("href", "/pane/loose");
    await user.click(screen.getByRole("button", { name: "rediseño mobile threads" }));
    expect(screen.queryByText("panel depo")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("collie:sidebar:v1")!).expanded).toEqual({ "acme/t1": false });
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

  it("says a thread that stopped to wait for your reply needs a reply, not a dialog", () => {
    const project = herd.projects![0]!;
    const waiting = { ...project, threads: project.threads.map((item) => item.id === "t1" ? { ...item, liveStatus: "idle" as const, group: "waiting-on-you", selfWaiting: true as const } : item) };
    open("/", { ...herd, projects: [waiting] });
    const head = screen.getByRole("link", { name: /^rediseño mobile/ });
    expect(head).toHaveAccessibleName("rediseño mobile, needs reply");
    expect(head.querySelector(".nav-row-word")).toHaveTextContent("needs reply");
  });

  it("shows a coordinator thread's own state beside its threads' dots", () => {
    const blocked = { ...acme, threads: acme.threads.map((item) => item.id === "t1" ? { ...item, liveStatus: "blocked" as const } : item) };
    open("/", { ...herd, projects: [blocked] });
    const head = screen.getByRole("link", { name: /^rediseño mobile/ });
    expect(head).toHaveAccessibleName("rediseño mobile, needs you");
    expect(head.querySelector(".nav-row-word")).toHaveTextContent("needs you");
  });

  it("counts what needs you on Home, and keeps no Needs you list of its own", () => {
    open();
    expect(screen.getByRole("link", { name: "Home, 1 needs you" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Needs you/ })).not.toBeInTheDocument();
  });

  it("brings the tree back to where it was scrolled after a search", async () => {
    const user = open();
    const scroller = document.querySelector<HTMLElement>(".nav-scroll")!;
    const scrollTo = (top: number) => { scroller.scrollTop = top; fireEvent.scroll(scroller); };
    scrollTo(300);

    await user.click(screen.getByRole("button", { name: /^Search/ }));
    await user.type(screen.getByRole("searchbox"), "panel");
    scrollTo(40);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(scroller.scrollTop).toBe(300);
  });

  it("lists open work most urgent first with coordinators ahead, and History as a closed grey tree of node details", async () => {
    const org: ProjectView = { ...acme, threads: [
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
    const project = within(screen.getByRole("region", { name: "Acme" }));
    const names = () => project.getAllByRole("link").map((link) => link.querySelector(".nav-row-text")?.textContent);
    expect(names()).toEqual(["Acme", "Coordinator", "rediseño", "merca", "panel depo", "landing", "stray"]);
    // A node with no live pane opens its own detail, not the project.
    expect(project.getByRole("link", { name: /^landing/ })).toHaveAttribute("href", "/project/acme/node/t1");

    const history = project.getByRole("button", { name: /^History/ });
    expect(history).toHaveAttribute("aria-expanded", "false");
    expect(project.queryByText("new fix")).not.toBeInTheDocument();
    await user.click(history);
    expect(names().slice(7)).toEqual(["newer plan", "old plan", "new fix"]);
    expect(project.getByRole("link", { name: /^new fix/ })).toHaveAttribute("href", "/project/acme/node/t11");
    await user.click(project.getByRole("button", { name: "old plan threads" }));
    expect(names().slice(7)).toEqual(["newer plan", "old plan", "old step", "new fix"]);
  });

  it("calls the coordinator what every other view calls it, in the drawer's Needs you", () => {
    const asking = { ...acme, coordinator: { ...acme.coordinator!, liveStatus: "blocked" as const } };
    const source = { ...herd, agents: herd.agents.map((agent) => agent.paneId === "c" ? { ...agent, status: "blocked" as const, tabLabel: "lead" } : agent), projects: [asking] };
    const router = createMemoryRouter([{ path: "/pane/:paneId", element: <WorkbenchSidebar data={source} variant="drawer" /> }], { initialEntries: ["/pane/loose"] });
    render(<RouterProvider router={router} />);
    const list = screen.getByRole("region", { name: "Needs you" });
    expect(within(list).getAllByRole("link").map((link) => link.querySelector(".nav-pane-title")?.textContent)).toEqual(["Acme coordinator", "panel depo"]);
  });

  it("names a chat in the drawer's Recent as the chat names itself, with its workspace and tab under it", () => {
    const source = { ...herd, agents: herd.agents.map((agent) => agent.paneId === "c" ? { ...agent, tabLabel: "lead" } : agent) };
    const router = createMemoryRouter([{ path: "/pane/:paneId", element: <WorkbenchSidebar data={source} variant="drawer" /> }], { initialEntries: ["/pane/loose"] });
    render(<RouterProvider router={router} />);
    const recent = within(screen.getByRole("region", { name: "Recent" }));
    const coordinator = recent.getByRole("link", { name: /^Acme coordinator/ });
    expect(coordinator.querySelector(".nav-pane-detail")).toHaveTextContent("w1 · lead");
  });

  it("opens History on its five newest nodes and leaves the rest to the project page", async () => {
    const done = (n: number, day: number, extra: Partial<ProjectView["threads"][number]> = {}) =>
      thread(`h${n}`, `done ${n}`, "root", { status: "resolved", updated: `2026-10-0${day}T00:00:00Z`, ...extra });
    const org: ProjectView = { ...acme, threads: [
      done(1, 1), done(2, 2), done(3, 3, { role: "coordinator" }), done(4, 4), done(5, 5), done(6, 6), done(7, 7), done(8, 8, { parentId: "h3" }),
    ] };
    const user = open("/", { ...herd, projects: [org] });
    const project = within(screen.getByRole("region", { name: "Acme" }));
    await user.click(project.getByRole("button", { name: /^History/ }));
    // The five that moved last, still drawn coordinators first; the rest is one tap away.
    const names = project.getAllByRole("link").map((link) => link.querySelector(".nav-row-text")?.textContent).filter((name) => name?.startsWith("done"));
    expect(names).toEqual(["done 3", "done 7", "done 6", "done 5", "done 4"]);
    expect(project.getByRole("link", { name: "Show all 8 in project" })).toHaveAttribute("href", "/project/acme");
  });

  it("marks Home as the page on screen only on Home", () => {
    open("/");
    expect(screen.getByRole("link", { name: /^Home\b/ })).toHaveAttribute("aria-current", "page");
  });

  it("leaves Home unmarked in a chat", () => {
    open("/pane/depo");
    expect(screen.getByRole("link", { name: /^Home\b/ })).not.toHaveAttribute("aria-current");
  });

  describe("in the phone's sheets", () => {
    const sheet = (request?: SidebarRequest) => {
      const router = createMemoryRouter([{ path: "/", element: <WorkbenchSidebar data={herd} variant="sheet" request={request} /> }]);
      render(<RouterProvider router={router} />);
    };

    it("holds what Browse did under its box until you type, then only the results", async () => {
      sheet({ target: "search", seq: 1 });
      expect(screen.getByRole("searchbox")).toHaveFocus();
      expect(screen.getByRole("region", { name: "Workspaces" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
      await userEvent.setup().type(screen.getByRole("searchbox"), "panel");
      expect(screen.queryByRole("region", { name: "Workspaces" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    });
  });

  it("orients an empty herd: where agents come from, and on a phone a way to start one", async () => {
    const empty = { ...herd, agents: [], workspaces: [], tabs: [], projects: [] } as unknown as HomeData;
    const onNewChat = vi.fn();
    const router = createMemoryRouter([{ path: "/", element: <WorkbenchSidebar data={empty} variant="sheet" onNewChat={onNewChat} /> }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
    // The button below names the way to start; the words only add where else agents come from.
    expect(screen.getByText("Agents you start in Herdr show up here too.")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "New agent" }));
    expect(onNewChat).toHaveBeenCalledOnce();
  });

  it("keeps an empty desk sidebar to one quiet line, since Home beside it leads the start", () => {
    const empty = { ...herd, agents: [], workspaces: [], tabs: [], projects: [] } as unknown as HomeData;
    const router = createMemoryRouter([{ path: "/", element: <WorkbenchSidebar data={empty} onNewChat={vi.fn()} /> }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByText("No agents yet.")).toHaveClass("nav-empty");
    expect(screen.queryByRole("heading", { name: /No agents yet/ })).toBeNull();
    expect(screen.queryByText(/show up here/)).toBeNull();
  });

  it("names the host and what it holds in the footer, beside Settings", () => {
    open();
    expect(screen.getByText("2 workspaces · 6 agents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });
});
