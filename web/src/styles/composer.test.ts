import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { declarations } from "@/test/css-rules";

// The composer's layout contracts that fail silently: jsdom lays nothing out, so these read the
// declared values and the bench measures the rendered result (redesign-shots/labels-type-reach).

const css = readFileSync(resolve(import.meta.dirname, "composer.css"), "utf8");

describe("the composer", () => {
  // The box bleeds 8px into a phone's gutter, as the strips' pills do: its + and Send sit on the column
  // the prose starts on, and the draft keeps its width. Tried at the 16px gutter on the bench: the
  // draft lost 16px, and a four-line draft wrapped to five under the keyboard, taking 24px of thread.
  it("bleeds 8px into a phone's gutter so the draft keeps its width, and sits on the gutter on a desk", () => {
    expect(declarations(css, ".workbench-composer").width).toBe("calc(100% - 16px)");
    expect(declarations(css, ".workbench-composer", ["@media (min-width: 1024px)"]).width).toBe("calc(100% - 2 * var(--page-gutter))");
  });

  // Measured on the bench: the model chip's 44px reach rose 4px into the box and took the bottom of
  // the +'s, which then reached 40px. Rising 4px still took 2px of it on a coarse tablet, where the +
  // sits 2px lower in its box (44x42 at 820px). Below the meta row there is only the home indicator's inset.
  it("grows the meta row's touch targets down, away from the + above them", () => {
    expect(declarations(css, ".composer-meta .hit-area::before", ["@media (pointer: coarse)"])).toMatchObject({ top: "-2px", transform: "translateX(-50%)" });
  });
});
