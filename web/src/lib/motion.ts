import { useEffect } from "react";
import { matchRoutes, useLocation, type DataRouter, type RouterNavigateOptions, type To } from "react-router";

/**
 * How a page change moves, the way a phone's navigation does: a deeper page slides in from the right
 * over the one it leaves (push), the back control slides the page out to the right (pop), and any other
 * change (the tab bar's Home, a sibling pane, a pick in the sidebar) cross-fades in place. Reduced
 * motion, and a desk, where the sidebar must stay put beside the page, turn every change into the
 * cross-fade. index.css draws each one.
 */
export type Motion = "push" | "pop" | "fade";

/** How long the old page may stay frozen on screen while the next one loads. Past it the change goes
 *  through as it always did, unanimated; under NAV_BUSY_THRESHOLD_MS, so a slow link still shows the bar. */
export const MOTION_BUDGET_MS = 300;

/** Each route's place in the hierarchy, on its `handle` (router.tsx). A route without one sits at Home's level. */
export interface MotionHandle {
  depth?: number;
}

// The router whose navigations animate, for the settle check below. One per page.
let active: DataRouter | null = null;
// A motion the next navigation asked for by name (armMotion).
let armed: Motion | undefined;
// The transition waiting for its page, and the motion it is drawing.
let waiting: { from: string; release: () => void } | null = null;
let drawing: object | null = null;

/**
 * Animate the navigations this app starts. Only `router.navigate` is wrapped, and only `<Link>`,
 * `useNavigate` and our own code call it: a poll's revalidation, a loader's redirect and the browser's
 * Back never come through here, so they never start a transition. React Router's own `viewTransition`
 * flag stays unused, because it replays a transition on every revalidation after a Back
 * (.adr/0077-page-motion-runs-only-on-navigations-the-app-starts.md).
 */
export function animateNavigations(router: DataRouter): void {
  active = router;
  const navigate = router.navigate;
  router.navigate = ((to: To | number | null, opts?: RouterNavigateOptions) => {
    if (typeof to === "number") return navigate(to);
    const motion = motionFor(router, to, opts);
    return motion ? move(router, motion, () => navigate(to, opts)) : navigate(to, opts);
  }) as DataRouter["navigate"];
}

/** The very next navigation, started in this same task, moves this way: the back control's pop, a
 *  notification's push. Gone by the next microtask, so a click that ends up not navigating leaves nothing. */
export function armMotion(motion: Motion): void {
  armed = motion;
  queueMicrotask(() => {
    armed = undefined;
  });
}

/**
 * Tells a waiting transition its page has arrived. Called from the root layout, whose effect runs after
 * its children's: a `<Navigate>` redirect has started loading by then, so the transition waits for the
 * page it lands on instead of drawing the empty page in between.
 */
export function useMotionSettle(): void {
  const { key } = useLocation();
  useEffect(() => {
    if (waiting && waiting.from !== key && active?.state.navigation.state === "idle") waiting.release();
  }, [key]);
}

function motionFor(router: DataRouter, to: To | null, opts: RouterNavigateOptions | undefined): Motion | undefined {
  const asked = armed;
  armed = undefined;
  // A replace corrects where you are (a redirect, a closed pane, a tab switch inside a chat): no move.
  if (opts?.replace || typeof document.startViewTransition !== "function") return undefined;
  const here = router.state.location.pathname;
  const there = typeof to === "string" ? new URL(to, new URL(here, "http://nenu.invalid")).pathname : (to?.pathname ?? here);
  if (there === here) return undefined;
  if (window.matchMedia?.(STILL).matches) return "fade";
  return asked ?? (depth(router, there) > depth(router, here) ? "push" : "fade");
}

// Where a change only cross-fades: reduced motion, or a desk (workbench.css shows the sidebar from 1024 px).
// The whole page is one picture in a transition (WebKit draws no separately named part of it), so a
// slide there would drag the sidebar along.
const STILL = "(prefers-reduced-motion: reduce), (min-width: 1024px)";

function depth(router: DataRouter, pathname: string): number {
  const handle = matchRoutes(router.routes, pathname)?.at(-1)?.route.handle as MotionHandle | undefined;
  return handle?.depth ?? 0;
}

/**
 * Navigate inside a view transition. The navigation starts in the update callback, after the old page
 * is captured, so a page that loads instantly can never be captured as the old one. The old page stays
 * frozen until the new one commits, or MOTION_BUDGET_MS, whichever comes first. Resolves with the
 * navigation, as `router.navigate` does.
 */
function move(router: DataRouter, motion: Motion, go: () => Promise<void>): Promise<void> {
  waiting?.release(); // a newer change lets go of an older one at once
  let release!: () => void;
  const arrived = new Promise<void>((resolve) => { release = resolve; });
  const hold = { from: router.state.location.key, release: () => { if (waiting === hold) waiting = null; release(); } };
  waiting = hold;
  const root = document.documentElement;
  const token = {};
  drawing = token;
  root.dataset.motion = motion;
  return new Promise<void>((resolve, reject) => {
    const transition = document.startViewTransition(() => {
      go().then(resolve, reject);
      const budget = setTimeout(() => {
        transition.skipTransition();
        hold.release();
      }, MOTION_BUDGET_MS);
      return arrived.then(() => clearTimeout(budget));
    });
    transition.ready.catch(() => {}); // a skipped transition rejects `ready`; the navigation is unaffected
    void transition.finished.catch(() => {}).finally(() => {
      if (drawing !== token) return;
      drawing = null;
      delete root.dataset.motion;
    });
  });
}
