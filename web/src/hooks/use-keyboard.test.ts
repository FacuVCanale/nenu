import { describe, expect, it } from "vitest";

import { keyboardStep, type KeyboardState } from "./use-keyboard";

/** Feed visual-viewport samples through the machine, as the resize listener does. */
function run(samples: Array<{ height: number; width?: number }>, start: KeyboardState = { open: false, baseline: 800, width: 390 }) {
  const states: KeyboardState[] = [];
  let state = start;
  for (const sample of samples) {
    state = keyboardStep(state, { height: sample.height, width: sample.width ?? state.width });
    states.push(state);
  }
  return states;
}

describe("keyboardStep", () => {
  it("is closed when the height is unchanged", () => {
    expect(run([{ height: 800 }]).at(-1)!.open).toBe(false);
  });

  it("ignores small drops like the URL bar collapsing", () => {
    expect(run([{ height: 720 }]).at(-1)!.open).toBe(false); // -80px
  });

  it("opens once the height drops past 150px", () => {
    expect(run([{ height: 660 }]).map((s) => s.open)).toEqual([false]); // -140px: not yet
    expect(run([{ height: 480 }]).map((s) => s.open)).toEqual([true]); // -320px
  });

  it("stays open between 100 and 150px, so a suggestion bar or a URL bar does not flicker it", () => {
    // -336 (keyboard), -290 (suggestion bar folds), -120 (half way down): still the keyboard.
    expect(run([{ height: 464 }, { height: 510 }, { height: 680 }]).map((s) => s.open)).toEqual([true, true, true]);
  });

  it("closes only when the height comes back within 100px of the baseline", () => {
    expect(run([{ height: 464 }, { height: 705 }, { height: 800 }]).map((s) => s.open)).toEqual([true, false, false]);
  });

  it("does not open from the dead band when it was closed", () => {
    expect(run([{ height: 680 }, { height: 660 }]).map((s) => s.open)).toEqual([false, false]);
  });

  it("raises the baseline while closed, never while open", () => {
    const [closed, open, stillOpen] = run([{ height: 844 }, { height: 508 }, { height: 600 }]);
    expect(closed).toMatchObject({ open: false, baseline: 844 });
    expect(open).toMatchObject({ open: true, baseline: 844 });
    expect(stillOpen).toMatchObject({ open: true, baseline: 844 });
  });

  it("re-baselines on a width change, which is a rotation and not the keyboard", () => {
    const states = run([{ height: 464 }, { height: 390, width: 844 }, { height: 200, width: 844 }]);
    expect(states[1]).toEqual({ open: false, baseline: 390, width: 844 });
    expect(states[2]!.open).toBe(true);
  });
});
