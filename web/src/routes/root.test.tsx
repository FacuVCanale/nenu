import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { BootSplash, RootError, shownLastSeenAt } from "./root";
import { BUILD } from "@/lib/build";
import { CONNECTION_LOST_MS } from "@/hooks/use-connection-lost";
import { __resetConnectionHealth } from "@/lib/connection-health";
import type { HomeData, PaneData } from "@/lib/loaders";

// BootSplash is the router's HydrateFallback: it stays mounted until the FIRST loader run settles, so
// over a dead tailnet (a hanging initial fetch) it could otherwise wait forever with no way out. It
// draws the app's own frame while it connects, so the app arrives without a jump, and it says which
// host it cannot reach once stuck past CONNECTION_LOST_MS.
// Fake timers drive the wall-clock hook (Vitest advances Date.now with them).
describe("BootSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetConnectionHealth(); // module-load anchor == frozen clock: a dead cold start escalates ~15s in
  });
  afterEach(() => vi.useRealTimers());

  it("draws the app's frame and says which host it is connecting to", () => {
    const { container } = render(<BootSplash />);
    expect(screen.getByRole("status")).toHaveTextContent(`Connecting to ${window.location.host}…`);
    expect(container.querySelector(".workbench-app-header")).not.toBeNull();
    expect(container.querySelector(".bottom-tab-bar")).not.toBeNull();
    expect(screen.queryByText(/herd/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(CONNECTION_LOST_MS - 1));
    expect(screen.queryByText(/Can.t reach Nenu/)).not.toBeInTheDocument();
  });

  it("says it cannot reach the host, with a Retry, once stuck past the threshold", () => {
    const { container } = render(<BootSplash />);
    act(() => vi.advanceTimersByTime(CONNECTION_LOST_MS));
    expect(screen.queryByText(/Connecting to/)).not.toBeInTheDocument();
    expect(screen.getByText(`Can’t reach Nenu at ${window.location.host}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // The frame stays, so the screen does not jump when Retry or the network brings the app back.
    expect(container.querySelector(".workbench-app-header")).not.toBeNull();
  });
});

describe("RootError", () => {
  function Boom(): never {
    throw new Error("Cannot read properties of undefined (reading 'charAt')");
  }
  function crash(route: { loader?: () => never; element?: ReactNode }, path = "/") {
    const router = createMemoryRouter([{ path: "*", errorElement: <RootError />, ...route }], { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
  }
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("reads as Nenu's problem, with a 44px Reload, and keeps the raw message behind a disclosure", async () => {
    const router = crash({ element: <Boom /> });
    expect(await screen.findByRole("heading", { name: "Nenu hit a problem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    const raw = screen.getByText(/reading 'charAt'/);
    expect(raw).not.toBeVisible();
    fireEvent.click(screen.getByText("Technical details"));
    expect(raw).toBeVisible();
    router.dispose();
  });

  it("copies the message, the stack and the build for a bug report", async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const router = crash({ element: <Boom /> });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Copy details" })); });
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("Cannot read properties of undefined (reading 'charAt')");
    expect(copied).toContain("Boom");
    expect(copied).toContain(BUILD.version);
    router.dispose();
  });

  it("answers a 404 with Page not found, not the crash screen", async () => {
    const router = crash({ loader: () => { throw new Response(null, { status: 404 }); }, element: <p>never</p> }, "/gone?s=qa");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/?s=qa");
    expect(screen.queryByText("Nenu hit a problem")).not.toBeInTheDocument();
    router.dispose();
  });
});

// The one connection surface is mounted in RootLayout and dates what is on screen. On the dashboard
// that is the herd; inside a pane it is the mirror, and after a cold boot the two stamps can be hours
// apart — the operator opened the pane at 12:05 and left the dashboard polling until 14:32.

const NOON = new Date(2026, 0, 2, 12, 5).getTime();
const AFTERNOON = new Date(2026, 0, 2, 14, 32).getTime();

function home(lastSeenAt?: number): HomeData {
  return {
    bridge: "connected",
    device: undefined,
    agents: [],
    shellPanes: [],
    workspaces: [],
    tabs: [],
    sessions: [],
    session: undefined,
    snoozedUntil: null,
    update: undefined,
    error: true,
    authError: false,
    lastSeenAt,
  };
}

function pane(overrides: Partial<PaneData>): PaneData {
  return {
    paneId: "w1:p1",
    session: undefined,
    text: "old terminal text",
    truncated: false,
    requestedLines: 600,
    revision: 0,
    error: true,
    authError: false,
    ...overrides,
  };
}

describe("which 'last seen' the connection bar shows", () => {
  it("uses the snapshot's stamp on the dashboard (no pane route active)", () => {
    expect(shownLastSeenAt(home(AFTERNOON), undefined)).toBe(AFTERNOON);
  });

  it("uses the PANE's own stamp while a stale mirror is what's being read", () => {
    expect(shownLastSeenAt(home(AFTERNOON), pane({ lastSeenAt: NOON }))).toBe(NOON);
  });

  it("says nothing rather than borrowing the herd's stamp for an undatable mirror", () => {
    expect(shownLastSeenAt(home(AFTERNOON), pane({ lastSeenAt: undefined }))).toBeUndefined();
  });

  it("falls back to the snapshot when the stale pane has no text to date", () => {
    expect(shownLastSeenAt(home(AFTERNOON), pane({ text: "", lastSeenAt: undefined }))).toBe(
      AFTERNOON,
    );
  });

  it("falls back to the snapshot when the pane itself is live", () => {
    expect(shownLastSeenAt(home(AFTERNOON), pane({ error: false, lastSeenAt: NOON }))).toBe(
      AFTERNOON,
    );
  });
});
