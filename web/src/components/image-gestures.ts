// The image viewer's gesture math, kept pure so each decision is testable without a browser. A view
// is the picture's transform: translate(x, y) scale(scale), measured from the stage's centre.

export interface View { scale: number; x: number; y: number }
export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Sample { t: number; x: number; y: number }

export const IDENTITY: View = { scale: 1, x: 0, y: 0 };
export const MAX_ZOOM = 4;
export const DOUBLE_TAP_ZOOM = 2.5;
/** Travel before a touch stops being a tap and picks a direction. */
export const SLOP = 10;

// `|| 0` folds -0 into 0, so a view at rest compares equal to IDENTITY.
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value)) || 0;

/** Past an edge the picture follows less the further it goes, instead of stopping dead. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (!overshoot || dimension <= 0) return 0;
  const distance = Math.abs(overshoot);
  return Math.sign(overshoot) * (distance * dimension * constant) / (dimension + constant * distance);
}

/** How far a release at `velocity` (px/s) carries before friction stops it, as a scroll view decelerates. */
export function project(velocity: number, rate = 0.99): number {
  return (velocity / 1000) * rate / (1 - rate);
}

/** How far the picture may move from centre at `scale` before an edge of it comes into view. */
function reach(content: number, scale: number, stage: number): number {
  return Math.max(0, (content * scale - stage) / 2);
}

/** The nearest view at rest: scale within its limits and no gap between the picture and the edge. */
export function clampView(view: View, content: Size, stage: Size): View {
  const scale = clamp(view.scale, 1, MAX_ZOOM);
  const x = reach(content.width, scale, stage.width), y = reach(content.height, scale, stage.height);
  return { scale, x: clamp(view.x, -x, x), y: clamp(view.y, -y, y) };
}

/** A view under the finger: past each limit it gives way less and less, so a release can settle back. */
export function resist(view: View, content: Size, stage: Size): View {
  const rest = clampView(view, content, stage);
  const scale = rest.scale + rubberband(view.scale - rest.scale, rest.scale);
  const limits = clampView({ ...view, scale }, content, stage);
  return {
    scale,
    x: limits.x + rubberband(view.x - limits.x, stage.width),
    y: limits.y + rubberband(view.y - limits.y, stage.height),
  };
}

/** Scale to `scale` about `at`, so the point of the picture under it stays under it. */
export function zoomAt(view: View, scale: number, at: Point): View {
  const k = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}

/**
 * What a one-finger drag means once it leaves the slop, or null while it may still be a tap. A
 * zoomed picture pans; a whole one goes down to close (up only gives way) or across to the next.
 */
export function dragIntent(dx: number, dy: number, zoomed: boolean): "pan" | "dismiss" | "page" | null {
  if (Math.hypot(dx, dy) < SLOP) return null;
  if (zoomed) return "pan";
  return Math.abs(dy) > Math.abs(dx) ? "dismiss" : "page";
}

/** A pull closes when it is headed down and will carry far enough; a finger heading back up keeps it. */
export function shouldDismiss(dy: number, vy: number, height: number): boolean {
  if (vy < -100) return false;
  return dy + project(Math.max(0, vy)) > height * 0.22;
}

/** The page a sideways release lands on: past halfway, or flicked there, and only onto a picture. */
export function pageStep(dx: number, vx: number, width: number, canPrevious: boolean, canNext: boolean): -1 | 0 | 1 {
  const travel = dx + project(vx);
  if (travel < -width / 2 && canNext) return 1;
  if (travel > width / 2 && canPrevious) return -1;
  return 0;
}

/** Pointer speed in px/s over the last tenth of a second; zero when the samples span no time. */
export function velocity(samples: readonly Sample[]): Point {
  const last = samples.at(-1);
  if (!last) return { x: 0, y: 0 };
  const first = samples.find((sample) => last.t - sample.t <= 100) ?? last;
  const dt = last.t - first.t;
  if (dt < 8) return { x: 0, y: 0 };
  return { x: ((last.x - first.x) / dt) * 1000, y: ((last.y - first.y) / dt) * 1000 };
}
