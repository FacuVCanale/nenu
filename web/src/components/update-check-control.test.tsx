import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/test/setup";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { checkForUpdate } from "@/lib/pwa";
import { __resetServerBuild, observeServerBuild } from "@/lib/server-build";
import type { UpdateInfo } from "@/lib/types";
import { UpdateCheckControl } from "./update-check-control";

vi.mock("@/lib/pwa", () => ({ checkForUpdate: vi.fn() }));
afterEach(() => __resetServerBuild());

// UpdateCheckControl reads the running version / last-checked from the root loader's `update`, and on
// tap forces an upstream check then revalidates the snapshot. Drive it through a memory router (for
// the loader data) plus MSW (for POST /api/update/check).

const upToDate: UpdateInfo = {
  current: "0.11.0",
  latest: "0.11.0",
  latestUrl: null,
  releaseAvailable: false,
  majorAvailable: null,
  majorUrl: null,
  bridgeStale: false,
  checkedAt: 1_700_000_000_000,
};

function homeData(update: UpdateInfo | undefined): HomeData {
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
    update,
    error: false,
    authError: false,
  };
}

/** `update` may be a function, read on every load, for a snapshot that changes under the card. */
function renderControl(update: UpdateInfo | undefined | (() => UpdateInfo | undefined), onLoad?: () => void) {
  const router = createMemoryRouter(
    [
      {
        id: ROOT_ROUTE_ID,
        path: "/",
        loader: () => {
          onLoad?.();
          return homeData(typeof update === "function" ? update() : update);
        },
        element: (
          <div data-testid="root">
            <UpdateCheckControl />
          </div>
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  server.use(http.post("/api/update/check", () => HttpResponse.json(upToDate)));
});

describe("UpdateCheckControl", () => {
  it("explains local updates without offering an unrelated release check", async () => {
    renderControl({ ...upToDate, releaseChannel: "local", checkedAt: null });
    expect(await screen.findByText(/updates are managed on your mac/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /check now/i })).toBeNull();
    expect(screen.queryByText(/up to date/i)).toBeNull();
  });
  it("shows the running version and 'Up to date' when nothing is pending", async () => {
    renderControl(upToDate);
    expect(await screen.findByText(/nenu 0\.11\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
  });

  it("forces a check and revalidates the snapshot on tap", async () => {
    let posted = false;
    server.use(
      http.post("/api/update/check", () => {
        posted = true;
        // checkedAt ADVANCES past the prior state → a genuine successful check → revalidate.
        return HttpResponse.json({ ...upToDate, checkedAt: 1_700_000_000_500 });
      }),
    );
    let loads = 0;
    const user = userEvent.setup();
    renderControl(upToDate, () => {
      loads += 1;
    });
    const btn = await screen.findByRole("button", { name: /check now/i });
    const before = loads; // loader ran once for the initial render

    await user.click(btn);

    await waitFor(() => expect(posted).toBe(true));
    await waitFor(() => expect(loads).toBeGreaterThan(before)); // revalidation re-ran the loader
    expect(btn).not.toBeDisabled();
  });

  it("surfaces a check failure and re-enables the button", async () => {
    server.use(http.post("/api/update/check", () => new HttpResponse(null, { status: 500 })));
    const user = userEvent.setup();
    renderControl(upToDate);
    const btn = await screen.findByRole("button", { name: /check now/i });

    await user.click(btn);

    expect(await screen.findByText(/couldn't check/i)).toBeInTheDocument();
    expect(btn).not.toBeDisabled();
  });

  it("treats a 200 whose checkedAt didn't advance as a silent failure (no false 'Up to date')", async () => {
    // The bridge is fail-soft: a GitHub error keeps prior state and STILL returns 200 with the same
    // checkedAt. The button must surface that, not read it as an authoritative "checked, all good".
    server.use(http.post("/api/update/check", () => HttpResponse.json(upToDate))); // same checkedAt as prior
    let loads = 0;
    const user = userEvent.setup();
    renderControl(upToDate, () => {
      loads += 1;
    });
    const btn = await screen.findByRole("button", { name: /check now/i });
    const before = loads;

    await user.click(btn);

    expect(await screen.findByText(/couldn't check/i)).toBeInTheDocument();
    expect(loads).toBe(before); // did NOT revalidate on a non-advancing check
    expect(btn).not.toBeDisabled();
  });

  it("prompts to check when the bridge reports no update info", async () => {
    renderControl(undefined);
    expect(await screen.findByText(/whether a new version is available/i)).toBeInTheDocument();
    expect(screen.queryByText(/up to date/i)).toBeNull();
  });
});

// Every actionable state lives in this card, with a badge and one action (SYS-08, ADR 0027: no
// floating notice anywhere else).
describe("UpdateCheckControl — the card owns every update state", () => {
  const card = async () => screen.findByRole("region", { name: "Updates" });

  it("names an available release and links its notes", async () => {
    const url = "https://github.com/AltanS/collie/releases/tag/v0.12.0";
    renderControl({ ...upToDate, releaseAvailable: true, latest: "0.12.0", latestUrl: url });
    const updates = await card();
    expect(within(updates).getByText("0.12.0 available")).toBeInTheDocument();
    expect(within(updates).getByRole("link", { name: /release notes/i })).toHaveAttribute("href", url);
    expect(within(updates).queryByRole("button", { name: /check now/i })).toBeNull();
  });

  it("asks for a restart with the command to copy", async () => {
    const user = userEvent.setup();
    renderControl({ ...upToDate, bridgeStale: true });
    const updates = await card();
    expect(within(updates).getByText("Restart needed")).toBeInTheDocument();
    expect(within(updates).getByText("herdr plugin action invoke restart --plugin herdr.collie")).toBeInTheDocument();

    await user.click(within(updates).getByRole("button", { name: "Copy command" }));

    expect(await navigator.clipboard.readText()).toBe("herdr plugin action invoke restart --plugin herdr.collie");
    expect(within(updates).getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("names a major with its consent command and its notes", async () => {
    const url = "https://github.com/AltanS/collie/releases/tag/v1.0.0";
    renderControl({ ...upToDate, majorAvailable: "1.0.0", majorUrl: url });
    const updates = await card();
    expect(within(updates).getByText("Major 1.0.0 available")).toBeInTheDocument();
    expect(within(updates).getByText("herdr plugin action invoke update-major --plugin herdr.collie")).toBeInTheDocument();
    expect(within(updates).getByRole("link", { name: /release notes/i })).toHaveAttribute("href", url);
  });

  it("offers to reload a stale interface, and keeps the page when that fails", async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(false);
    const user = userEvent.setup();
    renderControl(upToDate);
    const updates = await card();
    act(() => observeServerBuild("0.99.0+new.1")); // the bridge serves another build than this bundle

    expect(within(updates).getByText("Interface update ready")).toBeInTheDocument();
    // The footer is a live region before the failure, so the failure is read out when it lands.
    const footer = within(updates).getByText("The server has a newer interface than this page.");
    expect(footer).toHaveAttribute("aria-live", "polite");
    await user.click(within(updates).getByRole("button", { name: "Reload interface" }));

    expect(checkForUpdate).toHaveBeenCalled();
    await waitFor(() => expect(footer).toHaveTextContent("Your session is unchanged"));
    expect(footer.isConnected).toBe(true);
    expect(within(updates).getByRole("button", { name: "Reload interface" })).toBeEnabled();
  });

  it("reads the check's outcome from a live region that was there before it changed", async () => {
    server.use(http.post("/api/update/check", () => new HttpResponse(null, { status: 500 })));
    const user = userEvent.setup();
    renderControl(upToDate);
    const updates = await card();
    const live = within(updates).getByRole("status");
    expect(live).toHaveTextContent("Up to date");

    await user.click(within(updates).getByRole("button", { name: /check now/i }));

    await waitFor(() => expect(live).toHaveTextContent("Couldn't check"));
    expect(live.isConnected).toBe(true);
  });

  it("lets a later check by the bridge clear a failed one", async () => {
    server.use(http.post("/api/update/check", () => new HttpResponse(null, { status: 500 })));
    let update = upToDate;
    const user = userEvent.setup();
    const { router } = renderControl(() => update);
    const updates = await card();

    await user.click(within(updates).getByRole("button", { name: /check now/i }));
    expect(await within(updates).findByText("Couldn't check")).toBeInTheDocument();

    // The bridge's own periodic check lands on a later poll.
    update = { ...upToDate, checkedAt: upToDate.checkedAt! + 60_000 };
    await act(() => router.revalidate());

    expect(await within(updates).findByText("Up to date")).toBeInTheDocument();
    expect(within(updates).queryByText("Couldn't check")).toBeNull();
  });

  it("shows a check in flight in the badge, on a button that keeps its place", async () => {
    let finish!: () => void;
    server.use(http.post("/api/update/check", () => new Promise<Response>((resolve) => { finish = () => resolve(HttpResponse.json({ ...upToDate, checkedAt: 1_700_000_000_500 })); })));
    const user = userEvent.setup();
    renderControl(upToDate);
    const updates = await card();

    await user.click(within(updates).getByRole("button", { name: /check now/i }));

    expect(within(updates).getByText("Checking…")).toBeInTheDocument();
    expect(within(updates).getByRole("button", { name: /check now/i })).toHaveAttribute("aria-busy", "true");
    finish();
    await waitFor(() => expect(within(updates).queryByText("Checking…")).toBeNull());
  });
});

