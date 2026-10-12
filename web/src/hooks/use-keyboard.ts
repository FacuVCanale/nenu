import { useEffect, useState } from "react";

// Detect whether the on-screen keyboard is open by watching the visual viewport height.
//
// The viewport meta uses `interactive-widget=resizes-content`, so when the soft keyboard opens BOTH
// the layout and visual viewport shrink together — which means the usual trick of comparing
// `window.innerHeight` to `visualViewport.height` reads ~0 and can't see the keyboard. What DOES
// still change is the absolute height: it drops by the keyboard's height. So we remember the tallest
// height seen while closed (the baseline) and call the keyboard "open" once the current height falls
// well below it.
//
// Why this exists: a textarea keeps DOM focus when Android collapses the keyboard (no `blur` fires),
// so focus alone can't tell us the keyboard closed — but the viewport resize always does.

// Two thresholds, so a height that hovers near one of them cannot flip the layout back and forth:
// it opens past 150px (more than the URL bar's ~60–100px, less than any keyboard's ~250px+) and
// closes only once the height is back within 100px. A suggestion bar folding or the URL bar showing
// while the keyboard is up stays inside the band.
const OPEN_DROP_PX = 150;
const CLOSE_DROP_PX = 100;

export interface KeyboardState {
  open: boolean;
  /** The tallest height seen while closed. */
  baseline: number;
  width: number;
}

/** One visual-viewport sample through the machine (pure, so the band is testable). */
export function keyboardStep(state: KeyboardState, sample: { height: number; width: number }): KeyboardState {
  // A width change is an orientation/layout change, not the keyboard: re-baseline, so a portrait
  // baseline doesn't read as "open" in landscape.
  if (sample.width !== state.width) return { open: false, baseline: sample.height, width: sample.width };
  const baseline = state.open ? state.baseline : Math.max(state.baseline, sample.height);
  const drop = baseline - sample.height;
  const open = state.open ? drop >= CLOSE_DROP_PX : drop > OPEN_DROP_PX;
  return { open, baseline, width: state.width };
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let state: KeyboardState = { open: false, baseline: vv.height, width: vv.width };
    const update = () => {
      state = keyboardStep(state, { height: vv.height, width: vv.width });
      setOpen(state.open);
    };
    update();
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);
  return open;
}
