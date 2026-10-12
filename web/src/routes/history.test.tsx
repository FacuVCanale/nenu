import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import { ROOT_ROUTE_ID, type HistoryData, type HomeData } from "@/lib/loaders";
import type { AgentView, TranscriptEntry } from "@/lib/types";
import { HistoryRoute } from "./history";

// jsdom has no element scrolling; the list pins itself to the newest turn on open.
beforeAll(() => { Element.prototype.scrollTo ??= () => {}; });

const pane = (paneId: string, extra: Partial<AgentView> = {}): AgentView => ({
  paneId, workspaceId: "w2", workspaceLabel: "api", workspaceNumber: 2, tabId: "w2:t1", agent: "codex", status: "idle", cwd: "/", focused: false, ...extra,
});

const turns = (count: number): TranscriptEntry[] => Array.from({ length: count }, (_, i) => ({
  uuid: `e-${i}`,
  ts: new Date(Date.UTC(2026, 9, 10, 12, 0, i)).toISOString(),
  role: i % 2 ? "assistant" : "user",
  parts: [{ kind: "text", text: `Message ${i}` }],
}));

function setup(paneId: string, history: Partial<HistoryData>, agents: AgentView[] = []) {
  const root: HomeData = { bridge: "connected", agents, shellPanes: [], workspaces: [], tabs: [], projects: [], device: undefined,
    sessions: [], session: undefined, snoozedUntil: null, update: undefined, error: false, authError: false };
  const data: HistoryData = { paneId, session: undefined, entries: [], hasMore: false, total: 0, fileTruncated: false, ...history };
  const router = createMemoryRouter([{
    id: ROOT_ROUTE_ID, path: "/", loader: () => root, element: <Outlet />,
    children: [
      { index: true, element: <p>HOME</p> },
      { path: "pane/:paneId", element: <p>PANE</p> },
      { path: "pane/:paneId/history", loader: () => data, element: <HistoryRoute /> },
    ],
  }], { initialEntries: [`/pane/${encodeURIComponent(paneId)}/history`] });
  render(<RouterProvider router={router} />);
  return { router, user: userEvent.setup() };
}

const header = async () => within(await screen.findByRole("banner"));

describe("history header", () => {
  it("names the pane the way every other view does, not by its workspace", async () => {
    setup("w2:codex", { entries: turns(4), total: 4 }, [pane("w2:codex", { terminalTitle: "Fix the header" })]);
    expect((await header()).getByText("Fix the header")).toBeInTheDocument();
    expect(screen.queryByText("api")).not.toBeInTheDocument();
  });

  it("never shows a pane's raw id, even once the pane is gone", async () => {
    setup("w9:ghost", { unavailable: "no-session" });
    await screen.findByRole("banner");
    expect(screen.queryByText(/w9:ghost/)).not.toBeInTheDocument();
  });

  it("offers Find only when there is something to find", async () => {
    setup("w2:codex", { unavailable: "no-session" }, [pane("w2:codex", { paneLabel: "Codex" })]);
    await screen.findByRole("heading", { name: "No conversation yet" });
    expect(screen.queryByRole("button", { name: "Find in history" })).not.toBeInTheDocument();
  });

  it("leaves the count out of the header", async () => {
    setup("w1:idle", { entries: turns(4), total: 4 }, [pane("w1:idle", { paneLabel: "Idle Claude" })]);
    expect((await header()).queryByText(/\d+\s*\/\s*\d+/)).not.toBeInTheDocument();
  });
});

describe("history list", () => {
  it("says how much of a long thread is showing where the older turns load", async () => {
    setup("w1:idle", { entries: turns(90), total: 90 }, [pane("w1:idle", { paneLabel: "Idle Claude" })]);
    expect(await screen.findByRole("button", { name: "Load older" })).toBeInTheDocument();
    expect(screen.getByText("Showing 60 of 90")).toBeInTheDocument();
  });

  it("marks the start of a thread that is all on screen, without a count", async () => {
    setup("w1:idle", { entries: turns(4), total: 4 }, [pane("w1:idle", { paneLabel: "Idle Claude" })]);
    expect(await screen.findByText("Start of the conversation")).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });
});

describe("history with nothing to read", () => {
  it("says why, names the pane and offers one way back to it", async () => {
    const { router, user } = setup("w2:codex", { unavailable: "no-session" }, [pane("w2:codex", { paneLabel: "Codex" })]);
    expect(await screen.findByRole("heading", { name: "No conversation yet" })).toBeInTheDocument();
    expect(screen.getByText(/Codex has no agent session/)).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("button")).toHaveLength(1);
    await user.click(within(main).getByRole("button", { name: "Back to Codex" }));
    expect(router.state.location.pathname).toBe("/pane/w2%3Acodex");
  });

  it("says a closed pane is closed and sends its reader Home", async () => {
    const { router, user } = setup("w9:ghost", { unavailable: "no-session" });
    expect(await screen.findByRole("heading", { name: "This pane is closed" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("main")).getByRole("button", { name: "Back to Home" }));
    expect(router.state.location.pathname).toBe("/");
  });

  it("explains a transcript it could not read", async () => {
    setup("w1:idle", { unavailable: "error" }, [pane("w1:idle", { paneLabel: "Idle Claude" })]);
    expect(await screen.findByRole("heading", { name: "Couldn't read the transcript" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Idle Claude" })).toBeInTheDocument();
  });
});
