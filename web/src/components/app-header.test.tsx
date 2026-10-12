import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import type { ReactElement } from "react";

import { AppHeader, SettingsGear } from "./app-header";
import { CONNECTION_LOST_MS, TROUBLE_MS } from "@/hooks/use-connection-lost";
import { __resetConnectionHealth } from "@/lib/connection-health";
import { WorkbenchNavigationContext } from "@/lib/workbench-navigation";

// AppHeader mounts CollieHome (a button) and, via SettingsGear, useNavigate — so it needs a router.
function renderHeader(ui: ReactElement) {
  return render(ui, { wrapper: MemoryRouter });
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

describe("AppHeader — the one shared header shell", () => {
  beforeEach(() => __resetConnectionHealth());

  it("is calm in the PANE variant while live — breadcrumb + status badge, no pill, no wordmark", () => {
    // Connection copy lives in the top ConnectionBanner now; the header carries none. A healthy pane
    // header shows its own bits and a resting (static) Nenu mark.
    const { container } = render(
      <MemoryRouter initialEntries={["/pane/p1"]}>
        <WorkbenchNavigationContext value={{ open: false, onOpen: () => {} }}>
          <AppHeader bridge="connected" error={false} rightLead={<span>working</span>}>
            <span>webapp › main</span>
          </AppHeader>
        </WorkbenchNavigationContext>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull(); // no connection pill of any kind
    expect(container.querySelector(".dog-gallop")).toBeNull(); // mark at rest (static icon)
    expect(screen.getByText("webapp › main")).toBeInTheDocument(); // the breadcrumb slot
    expect(screen.getByText("working")).toBeInTheDocument(); // the agent status badge
    expect(screen.queryByText("Nenu")).toBeNull(); // no wordmark in a pane
  });

  it("is calm in the DASHBOARD variant while live — settings gear, resting mark", () => {
    const { container } = renderHeader(
      <AppHeader bridge="connected" error={false} rightTrail={<SettingsGear />} />,
    );
    expect(container.querySelector(".dog-gallop")).toBeNull(); // mark at rest while live
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("runs the caller's onHome when the mark is tapped outside the workbench", async () => {
    const onHome = vi.fn();
    renderHeader(<AppHeader bridge="connected" error={false} onHome={onHome} />);
    await userEvent.click(screen.getByRole("button", { name: "Nenu home" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("uses the shell drawer as the single mobile navigation control", async () => {
    const onOpen = vi.fn();
    renderHeader(
      <WorkbenchNavigationContext value={{ open: false, onOpen }}>
        <AppHeader bridge="connected" error={false}><span>Overview</span></AppHeader>
      </WorkbenchNavigationContext>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.queryByText("Nenu")).toBeNull();
    expect(document.querySelectorAll("header")).toHaveLength(1);
  });

  it("navigates to a session-scoped /settings via the shared gear", async () => {
    render(
      <MemoryRouter initialEntries={["/?s=collie-demo"]}>
        <AppHeader
          bridge="connected"
          error={false}
          rightTrail={<SettingsGear session="collie-demo" />}
        />
        <LocationProbe />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByTestId("loc").textContent).toBe("/settings?s=collie-demo");
  });

  it("the find-bar override takes over the whole row (mark and breadcrumb yield)", () => {
    // `error` → not live, so the mark would react — proving the override replaces the row entirely.
    renderHeader(
      <AppHeader
        bridge="connected"
        error
        onHome={() => {}}
        rightLead={<span>working</span>}
        override={<div>FINDBAR</div>}
      >
        <span>webapp › main</span>
      </AppHeader>,
    );
    // The override owns the row while searching — the normal content is replaced, not stacked.
    expect(screen.getByText("FINDBAR")).toBeInTheDocument();
    expect(screen.queryByText("webapp › main")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nenu home" })).toBeNull();
  });
});

// A phone has no browser back in an installed PWA, so every screen but Home leads with one, and Home
// keeps the mark. A chat passes its own back, and its title opens the navigation the mark used to.
describe("AppHeader — the phone's leading control", () => {
  function renderAt(path: string, ui: ReactElement) {
    const onOpen = vi.fn();
    render(
      <MemoryRouter initialEntries={[path]}>
        <WorkbenchNavigationContext value={{ open: false, onOpen }}>{ui}</WorkbenchNavigationContext>
        <LocationProbe />
      </MemoryRouter>,
    );
    return { onOpen };
  }

  it("leads a sub-page with a back to Home that keeps the session", async () => {
    renderAt("/settings?s=work", <AppHeader bridge="connected" error={false} title="Settings" />);
    const back = screen.getByRole("link", { name: "Back to Home" });
    expect(back).toHaveAttribute("href", "/?s=work");
    expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
    await userEvent.click(back);
    expect(screen.getByTestId("loc").textContent).toBe("/?s=work");
  });

  it("takes an explicit back with its destination and name", () => {
    renderAt("/project/awam/node/t-1", <AppHeader bridge="connected" error={false} title="Rediseño" back={{ to: "/project/awam", label: "AWAM" }} />);
    expect(screen.getByRole("link", { name: "Back to AWAM" })).toHaveAttribute("href", "/project/awam");
  });

  it("goes back through an older caller's onHome, which names its own destination", async () => {
    const onHome = vi.fn();
    renderAt("/pane/p1/history", <AppHeader bridge="connected" error={false} onHome={onHome}><span>History</span></AppHeader>);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("keeps the mark on Home, opening navigation, and leaves the bar without a title", async () => {
    const { onOpen } = renderAt("/", <AppHeader bridge="connected" error={false} title="Home" />);
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: /^Back/ })).toBeNull();
    expect(within(screen.getByRole("banner")).queryByText("Home")).toBeNull();
  });

  it("keeps the mark for a bare header on a chat route", () => {
    renderAt("/pane/p1", <AppHeader bridge="connected" error={false} onHome={() => {}}><span>Working Claude</span></AppHeader>);
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("leads with the back a caller passes, even where the mark would sit", () => {
    renderAt("/pane/p1", <AppHeader bridge="connected" error={false} back={{ label: "Home", to: "/" }}><span>Working Claude</span></AppHeader>);
    expect(screen.getByRole("link", { name: "Back to Home" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
  });

  it("runs a back that leaves to a parent the caller routes to itself", async () => {
    const onClick = vi.fn();
    renderAt("/pane/p1", <AppHeader bridge="connected" error={false} back={{ label: "Home", onClick }}><span>Working Claude</span></AppHeader>);
    await userEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("names a parent shown in place beside the chevron, and keeps that back on a desk", () => {
    renderAt("/pane/p1", <AppHeader bridge="connected" error={false} back={{ label: "Main", onClick: () => {}, inPlace: true }}><span>Explore</span></AppHeader>);
    const back = screen.getByRole("button", { name: "Back to Main" });
    expect(back).toHaveTextContent("Main");
    expect(back).not.toHaveClass("lg:hidden");
  });
});

describe("AppHeader — the bar title", () => {
  it("draws the title as the bar's headline, with an optional footnote under it", () => {
    render(<MemoryRouter initialEntries={["/settings"]}><AppHeader bridge="connected" error={false} title="Settings" subtitle="nenu › review" /></MemoryRouter>);
    expect(screen.getByText("Settings")).toHaveClass("text-headline");
    expect(screen.getByText("nenu › review")).toHaveClass("text-footnote");
  });

  it("is the screen's heading, so a route that hands its name over keeps it", () => {
    render(<MemoryRouter initialEntries={["/settings"]}><AppHeader bridge="connected" error={false} title="Settings" /></MemoryRouter>);
    expect(within(screen.getByRole("banner")).getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("hides a title the page is showing as its own heading", () => {
    const visible = { ignore: '[aria-hidden="true"], [aria-hidden="true"] *' };
    const { rerender } = render(<MemoryRouter initialEntries={["/project/awam"]}><AppHeader bridge="connected" error={false} title="AWAM" titleHidden /></MemoryRouter>);
    expect(screen.queryByText("AWAM", visible)).toBeNull();
    rerender(<MemoryRouter initialEntries={["/project/awam"]}><AppHeader bridge="connected" error={false} title="AWAM" /></MemoryRouter>);
    expect(screen.getByText("AWAM", visible)).toBeInTheDocument();
  });
});

// The header dog agrees with the ConnectionBanner by construction — it reads the SAME shared-clock
// signals: it gallops only once trouble is sustained (≥4s, the flicker fix), and rests muted once lost
// (≥15s). Fake timers drive the wall-clock hooks (Vitest advances Date.now with them).
describe("AppHeader — the dog keys on trouble/lost, not the first not-live frame", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetConnectionHealth(); // anchor == frozen clock, so the thresholds land exactly
  });
  afterEach(() => vi.useRealTimers());

  it("stays static through brief signal losses and becomes muted only for a sustained outage", () => {
    const { container } = renderHeader(<AppHeader bridge="connected" error onHome={() => {}} />);
    // A single not-live frame is NOT trouble yet: the mark stays the static, full-color icon.
    expect(container.querySelector(".dog-gallop")).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("src", "/nenu-mark.png");
    expect(container.querySelector("img")?.className ?? "").not.toMatch(/grayscale/);

    // Sustained trouble (4s) → the dog gallops (agreeing with the amber bar).
    act(() => vi.advanceTimersByTime(TROUBLE_MS));
    expect(container.querySelector(".dog-gallop")).toBeNull();

    // Escalated to lost (15s) → the gallop stops and the mark rests on the muted static icon.
    act(() => vi.advanceTimersByTime(CONNECTION_LOST_MS - TROUBLE_MS));
    expect(container.querySelector(".dog-gallop")).toBeNull();
    expect(container.querySelector("img")?.className ?? "").toMatch(/grayscale/);
  });
});
