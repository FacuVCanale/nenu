import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, type RouteObject } from "react-router";

import { AppHeader } from "@/components/app-header";
import { animateNavigations, MOTION_BUDGET_MS, useMotionSettle } from "@/lib/motion";

function Root() {
  useMotionSettle();
  return <Outlet />;
}

function Pane() {
  return <AppHeader bridge="connected" error={false} title="Pane" back={{ label: "Home", to: "/" }} />;
}

let slowPage: Promise<null> = Promise.resolve(null);

const routes: RouteObject[] = [{
  path: "/",
  element: <Root />,
  children: [
    { index: true, handle: { depth: 0 }, element: <p>Home</p> },
    { path: "settings", handle: { depth: 1 }, element: <p>Settings</p> },
    { path: "slow", handle: { depth: 1 }, loader: () => slowPage, element: <p>Slow</p> },
    { path: "pane/:paneId", handle: { depth: 3 }, element: <Pane /> },
  ],
}];

async function open(at: string) {
  const router = createMemoryRouter(routes, { initialEntries: [at] });
  animateNavigations(router);
  render(<RouterProvider router={router} />);
  await screen.findByText(/Home|Settings|Pane/);
  return router;
}

/** A stand-in for the browser's view transitions: records the motion each one started with. */
function fakeTransitions() {
  const motions: Array<string | undefined> = [];
  let skipped = 0;
  document.startViewTransition = ((update?: ViewTransitionUpdateCallback) => {
    motions.push(document.documentElement.dataset.motion);
    const done = Promise.resolve().then(() => update?.());
    const settled = done.then(() => undefined);
    return { finished: settled, ready: settled, updateCallbackDone: settled, skipTransition: () => { skipped++; }, types: new Set() };
  }) as typeof document.startViewTransition;
  return { motions, skipped: () => skipped };
}

function prefersReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion: reduce"),
    media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const matchMedia = window.matchMedia;
afterEach(() => {
  Reflect.deleteProperty(document, "startViewTransition");
  delete document.documentElement.dataset.motion;
  window.matchMedia = matchMedia;
  slowPage = Promise.resolve(null);
});

describe("page motion", () => {
  it("slides a deeper page in as a push, changing the page inside the transition", async () => {
    const vt = fakeTransitions();
    const router = await open("/");
    await act(() => router.navigate("/pane/a"));
    expect(vt.motions).toEqual(["push"]);
    expect(await screen.findByText("Pane")).toBeInTheDocument();
  });

  it("slides the page out as a pop when the header's back control is the way out", async () => {
    const vt = fakeTransitions();
    await open("/pane/a");
    await userEvent.click(screen.getByRole("link", { name: "Back to Home" }));
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(vt.motions).toEqual(["pop"]);
  });

  it("fades a move up or sideways that no back control asked for (the tab bar's Home, a sibling pane)", async () => {
    const vt = fakeTransitions();
    const router = await open("/settings");
    await act(() => router.navigate("/"));
    await act(() => router.navigate("/pane/a"));
    await act(() => router.navigate("/pane/b"));
    expect(vt.motions).toEqual(["fade", "push", "fade"]);
  });

  it("never moves sideways under reduced motion: every change is a fade", async () => {
    prefersReducedMotion(true);
    const vt = fakeTransitions();
    const router = await open("/");
    await act(() => router.navigate("/pane/a"));
    await userEvent.click(screen.getByRole("link", { name: "Back to Home" }));
    await screen.findByText("Home");
    expect(vt.motions).toEqual(["fade", "fade"]);
  });

  it("starts no transition for a poll, a replace, a search change or the browser's Back", async () => {
    const vt = fakeTransitions();
    const router = await open("/");
    await act(() => router.navigate("/pane/a"));
    await act(() => router.navigate(-1));
    await act(() => router.navigate(1));
    for (let i = 0; i < 5; i++) await act(() => router.revalidate());
    await act(() => router.navigate("/pane/b", { replace: true }));
    await act(() => router.navigate("/pane/b?view=terminal"));
    expect(vt.motions).toEqual(["push"]);
    expect(router.state.location.pathname).toBe("/pane/b");
  });

  it("navigates exactly as before where the browser has no view transitions", async () => {
    const router = await open("/");
    await act(() => router.navigate("/pane/a"));
    expect(await screen.findByText("Pane")).toBeInTheDocument();
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it("lets go of the old frame once a slow page outlasts the budget, and the page still arrives", async () => {
    const vt = fakeTransitions();
    let land!: (value: null) => void;
    slowPage = new Promise((resolve) => { land = resolve; });
    const router = await open("/");
    void router.navigate("/slow");
    await act(() => new Promise((resolve) => setTimeout(resolve, MOTION_BUDGET_MS + 60)));
    expect(vt.skipped()).toBe(1);
    await act(async () => land(null));
    expect(await screen.findByText("Slow")).toBeInTheDocument();
  });
});
