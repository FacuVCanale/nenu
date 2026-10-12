import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThreadSidebar } from "./agent-sidebar";
import { fixtureAgents } from "@/test/handlers";
import type { AgentView, ProjectView } from "@/lib/types";

const idleAgent: AgentView = {
  paneId: "w3:p1",
  workspaceId: "w3",
  workspaceLabel: "sandbox",
  workspaceNumber: 3,
  tabId: "w3:t1",
  agent: "claude",
  status: "idle",
  cwd: "/home/you/sandbox",
  focused: false,
};

describe("ThreadSidebar", () => {
  it("renders an empty state when there are no agents", () => {
    render(<ThreadSidebar agents={[]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.getByText("No agents running.")).toBeInTheDocument();
  });

  it("groups panes into Needs you, This workspace and Recent, headed in sentence case", () => {
    render(
      <ThreadSidebar agents={[...fixtureAgents, idleAgent]} currentPaneId="w2:p1" onSelect={vi.fn()} />,
    );
    const headings = screen.getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Needs you1", "This workspace1", "Recent1"]);
    // The blocked agent leads, wherever it lives; the open pane sits in its own workspace's section.
    expect(within(screen.getByRole("region", { name: "Needs you" })).getByRole("button")).toHaveTextContent("webapp");
    expect(within(screen.getByRole("region", { name: "This workspace" })).getByRole("button")).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("region", { name: "Recent" })).getByRole("button")).toHaveTextContent("sandbox");
  });

  it("omits groups that have no members", () => {
    // Only a blocked agent → no This workspace / Recent headers.
    render(<ThreadSidebar agents={[fixtureAgents[0]!]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /^Needs you/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^This workspace/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Recent/ })).toBeNull();
  });

  it("names each pane as every other view does, where it lives under it, with no logo or monospace", () => {
    const named: AgentView = { ...idleAgent, paneId: "w3:p9", paneLabel: "Fix login", tabLabel: "auth" };
    const worker: AgentView = { ...idleAgent, paneId: "w3:p8", paneLabel: "raw label" };
    const projects: ProjectView[] = [{
      slug: "hub", name: "Hub", status: "active",
      threads: [{ id: "t1", title: "Checkout", parentId: "root", role: "worker", status: "open", paneId: "w3:p8" }],
    }];
    const { container } = render(<ThreadSidebar agents={[named, worker]} projects={projects} currentPaneId="" onSelect={vi.fn()} />);
    const rows = screen.getAllByRole("button").map((row) => [row.querySelector(".nav-pane-title")?.textContent, row.querySelector(".nav-pane-detail")?.textContent]);
    expect(rows).toEqual([["Fix login", "sandbox · auth"], ["Checkout", "Hub"]]);
    expect(container.querySelector(".font-mono")).toBeNull();
    expect(container.querySelector("img, [data-agent-icon]")).toBeNull();
  });

  it("marks the current pane with aria-current='page'", () => {
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="w2:p1" onSelect={vi.fn()} />);
    const current = screen.getByRole("button", { current: "page" });
    // Unnamed, the pane goes by its agent, as its header does; where it lives is the line under it.
    expect(current.querySelector(".nav-pane-title")).toHaveTextContent("codex");
    expect(current.querySelector(".nav-pane-detail")).toHaveTextContent("collie");
  });

  it("does not mark any pane current when the id matches nothing", () => {
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="nope" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { current: "page" })).toBeNull();
  });

  it("fires onSelect with the pane id when a thread is tapped", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ThreadSidebar agents={fixtureAgents} currentPaneId="w2:p1" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /webapp/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("w1:p1");
  });

  const shellPane: AgentView = {
    paneId: "w3:p2",
    workspaceId: "w3",
    workspaceLabel: "sandbox",
    workspaceNumber: 3,
    tabId: "w3:t2",
    agent: "shell",
    status: "unknown",
    cwd: "/home/you/sandbox",
    focused: false,
    kind: "shell",
  };

  it("lists bare shell panes under a Shells group and makes them selectable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={[shellPane]}
        currentPaneId=""
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("Shells")).toBeInTheDocument();
    // The shell row is titled by its space like every other row; the terminal glyph is what marks
    // it as a shell. It's the only pane in "sandbox" here, so the name is unambiguous.
    await user.click(screen.getByRole("button", { name: /sandbox/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("w3:p2");
  });

  it("still renders shells when there are no agents (fresh space reachable)", () => {
    render(<ThreadSidebar agents={[]} shellPanes={[shellPane]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.queryByText("No agents running.")).toBeNull();
    expect(screen.getByText("Shells")).toBeInTheDocument();
  });

  it("is switch-only — no close control on any row", () => {
    render(<ThreadSidebar agents={[fixtureAgents[0]!]} currentPaneId="" onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

});

// The "Switch pane" sheet sees the WHOLE herd, so it has the dashboard's original problem: the two
// long tails (Recent, and the bare shells) bury the handful of agents you opened it to reach.
describe("ThreadSidebar — folding the long tails", () => {
  const manyShells: AgentView[] = Array.from({ length: 12 }, (_, i) => ({
    paneId: `w3:s${i}`,
    workspaceId: "w3",
    workspaceLabel: `scratch${i}`,
    workspaceNumber: 3,
    tabId: "w3:t2",
    agent: "shell",
    status: "unknown",
    cwd: "/home/you/sandbox",
    focused: false,
    kind: "shell",
  }));

  it("folds Shells away, keeping the count and the agents visible", () => {
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={manyShells}
        currentPaneId=""
        onSelect={vi.fn()}
        shellsOpen={false}
        onShellsOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("scratch0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /shells/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /shells/i })).toHaveTextContent("12");
    // The agents you came for are still there.
    expect(screen.getByText("webapp")).toBeInTheDocument();
  });

  it("shows the shells again when expanded", () => {
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={manyShells}
        currentPaneId=""
        onSelect={vi.fn()}
        shellsOpen
        onShellsOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("scratch0")).toBeInTheDocument();
  });

  it("reports the Shells fold to its owner rather than keeping the state itself", async () => {
    const user = userEvent.setup();
    const onShellsOpenChange = vi.fn();
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={manyShells}
        currentPaneId=""
        onSelect={vi.fn()}
        shellsOpen
        onShellsOpenChange={onShellsOpenChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Shells\d+$/ }));
    expect(onShellsOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("folds Recent too, the same way the dashboard does", async () => {
    const user = userEvent.setup();
    const onRecentOpenChange = vi.fn();
    render(
      <ThreadSidebar
        agents={[...fixtureAgents, idleAgent]}
        currentPaneId=""
        onSelect={vi.fn()}
        recentOpen
        onRecentOpenChange={onRecentOpenChange}
      />,
    );
    expect(screen.getByText("sandbox")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /recent/i }));
    expect(onRecentOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("never offers a fold on the attention sections", () => {
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={manyShells}
        currentPaneId="w2:p1"
        onSelect={vi.fn()}
        recentOpen
        onRecentOpenChange={vi.fn()}
        shellsOpen
        onShellsOpenChange={vi.fn()}
      />,
    );
    // fixtureAgents are blocked + the open pane's workspace; only Shells should be expandable here.
    const expandable = screen.getAllByRole("button", { expanded: true }).map((b) => b.textContent);
    expect(expandable).toHaveLength(1);
    expect(expandable[0]).toMatch(/shells/i);
  });

  it("stays un-foldable when the parent wires nothing, as before", () => {
    render(
      <ThreadSidebar
        agents={fixtureAgents}
        shellPanes={manyShells}
        currentPaneId=""
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("scratch0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { expanded: true })).not.toBeInTheDocument();
  });
});
