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
  // The router's HydrateFallback renders inside the router, so the splash can draw the app's own links.
  const renderSplash = (path = "/") => render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <BootSplash /> }], { initialEntries: [path] })} />);

  it("draws the app's frame and says which host it is connecting to", () => {
    const { container } = renderSplash();
    expect(screen.getByRole("status")).toHaveTextContent(`Connecting to ${window.location.host}…`);
    expect(container.querySelector(".workbench-app-header")).not.toBeNull();
    expect(container.querySelector(".bottom-tab-bar")).not.toBeNull();
    expect(screen.queryByText(/herd/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(CONNECTION_LOST_MS - 1));
    expect(screen.queryByText(/Can.t reach Nenu/)).not.toBeInTheDocument();
  });

  it("draws the app's own tab bar, so it does not change under the thumb when the app arrives", () => {
    const { container } = renderSplash("/?s=qa");
    const bar = container.querySelector(".bottom-tab-bar")!;
    expect(bar.querySelector("[aria-current=page]")).toHaveTextContent("Home");
    expect(bar.querySelector("a")).toHaveAttribute("href", "/?s=qa");
    expect(bar.querySelector(".bottom-tab-new")).toBeDisabled();
    // Drawn, not usable: nothing to open until the first snapshot lands.
    expect(bar.closest("[inert]")).not.toBeNull();
  });

  it("says it cannot reach the host, with a Retry, once stuck past the threshold", () => {
    const { container } = renderSplash();
    act(() => vi.advanceTimersByTime(CONNECTION_LOST_MS));
    expect(screen.queryByText(/Connecting to/)).not.toBeInTheDocument();
    expect(screen.getByText(`Can’t reach Nenu at ${window.location.host}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveClass("ui-button-lg", "bg-foreground");
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
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("reads as Nenu's problem, with a Reload, and keeps the raw message behind a disclosure", async () => {
    const router = crash({ element: <Boom /> });
    expect(await screen.findByRole("heading", { name: "Nenu hit a problem" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    // The shared empty state: its title size, and its one action style (the large ink button).
    const page = screen.getByRole("heading", { name: "Nenu hit a problem" }).closest("[data-slot=empty-state]");
    expect(page).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Nenu hit a problem" })).toHaveClass("text-headline");
    expect(screen.getByRole("button", { name: "Reload" })).toHaveClass("ui-button-lg", "bg-foreground");
    expect(screen.getByRole("button", { name: "Copy details" })).toHaveClass("ui-button-lg");
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

  it("says Copied for a moment, then offers the copy again", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true });
    const router = crash({ element: <Boom /> });
    const button = await screen.findByRole("button", { name: "Copy details" });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(button); });
    expect(button).toHaveTextContent("Copied");
    act(() => vi.advanceTimersByTime(1500));
    expect(button).toHaveTextContent("Copy details");
    router.dispose();
  });

  it("opens the details for selecting by hand when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
    const router = crash({ element: <Boom /> });
    const raw = await screen.findByText(/reading 'charAt'/, { selector: "pre" });
    expect(raw).not.toBeVisible();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Copy details" })); });
    expect(raw).toBeVisible();
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
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

  it("dates a herd that came live from the bridge by the last live read, once the link drops", () => {
    // Herdr down: the bridge still answers, so the snapshot is not a stale cache and carries no stamp.
    const herdrDown = { ...home(undefined), error: false, bridge: "disconnected" as const };
    expect(shownLastSeenAt(herdrDown, undefined, NOON)).toBe(NOON);
    // A live herd needs no date, and a page that never saw one live has nothing to date it by.
    expect(shownLastSeenAt({ ...herdrDown, bridge: "connected" }, undefined, NOON)).toBeUndefined();
    expect(shownLastSeenAt(herdrDown, undefined, undefined)).toBeUndefined();
    // The cached herd's own stamp still wins, and an undatable mirror still borrows nothing.
    expect(shownLastSeenAt(home(AFTERNOON), undefined, NOON)).toBe(AFTERNOON);
    expect(shownLastSeenAt(herdrDown, pane({ lastSeenAt: undefined }), NOON)).toBeUndefined();
  });

  it("falls back to the snapshot when the pane itself is live", () => {
    expect(shownLastSeenAt(home(AFTERNOON), pane({ error: false, lastSeenAt: NOON }))).toBe(
      AFTERNOON,
    );
  });
});
