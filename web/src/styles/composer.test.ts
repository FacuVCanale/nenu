import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { declarations } from "@/test/css-rules";

// The composer's layout contracts that fail silently: jsdom lays nothing out, so these read the
// declared values and the bench measures the rendered result (redesign-shots/labels-type-reach).

const css = readFileSync(resolve(import.meta.dirname, "composer.css"), "utf8");

describe("the composer", () => {
  it("sits on the page gutter at every width, the column the header, the prose and the cards share", () => {
    expect(declarations(css, ".workbench-composer").width).toBe("calc(100% - 2 * var(--page-gutter))");
    expect(declarations(css, ".workbench-composer", ["@media (min-width: 1024px)"]).width).toBeUndefined();
  });

  // Measured on the bench: the model chip's 44px reach rose 4px into the box and took the bottom of
  // the +'s, which then reached 40px. Below the meta row there is only the home indicator's inset.
  it("grows the meta row's touch targets down, away from the + above them", () => {
    expect(declarations(css, ".composer-meta .hit-area::before", ["@media (pointer: coarse)"])).toMatchObject({ top: "-4px", transform: "translateX(-50%)" });
  });
});
