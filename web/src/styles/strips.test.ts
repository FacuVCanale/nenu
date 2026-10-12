import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cssRules, declarations } from "@/test/css-rules";

// The tab and pane strips' contracts that fail silently: jsdom lays nothing out, so these read the
// declared values and the bench measures the rendered result (redesign-shots/strips).

const css = readFileSync(resolve(import.meta.dirname, "strips.css"), "utf8");
const LAYER = "@layer components";
const COARSE = "@media (pointer: coarse)";
const px = (value: string | undefined) => Number(/^(-?[\d.]+)px$/.exec(value ?? "")?.[1] ?? Number.NaN);
const band = (name: "tabs" | "panes", at: string[] = [LAYER]) =>
  declarations(css, `.strip[data-workbench-navigation-band="${name}"]`, at);
const chipReach = () => cssRules(css).find((rule) => rule.selectors.includes(".strip-chip::after"))?.decls ?? {};

describe("strip chips", () => {
  it("mark the selected tab or pane with the neutral selection fill, never the accent", () => {
    expect(declarations(css, '.strip-chip[aria-current="true"]', [LAYER]).background).toBe("var(--workbench-row-selected)");
    expect(css).not.toMatch(/--primary/);
  });

  it("never grow past 60% of a phone or 240px on a desk, so one long name can't hide its siblings", () => {
    expect(declarations(css, ".strip-chip", [LAYER])["max-width"]).toBe("min(60vw, 240px)");
  });

  it("fade the edge a strip can still scroll toward", () => {
    expect(declarations(css, '.strip-scroller[data-overflow~="start"]', [LAYER])["--fade-start"]).toBe("24px");
    expect(declarations(css, '.strip-scroller[data-overflow~="end"]', [LAYER])["--fade-end"]).toBe("24px");
  });
});

describe("strips on a touch screen", () => {
  it("take 32px each, so both bands together leave the thread more room than the two old ones did", () => {
    expect(declarations(css, ".strip", [LAYER, COARSE]).height).toBe("32px");
  });

  it("give every chip a 44px reach that hangs below its band, from the chip's outer edge", () => {
    const chip = px(declarations(css, ".strip-chip", [LAYER]).height);
    // Two open chips stacked keep a gap between them.
    expect(chip).toBeLessThan(32);
    expect(chip + px(declarations(css, ".strip", [LAYER, COARSE])["--reach"])).toBe(44);
    // The pseudo-element sits in the chip's padding box, so the 1px border is added back.
    expect(chipReach()).toMatchObject({ inset: "-1px", bottom: "calc(-1px - var(--reach))" });
  });

  it("never reach over another control: up into the header, or over a pane pill from the tab row", () => {
    // Reaching up would gain nothing anyway: the header paints over its own bottom edge.
    expect(chipReach().top).toBeUndefined();
    // The tab row's reach goes under the pane row, never over its pills.
    expect(Number(band("panes")["z-index"])).toBeGreaterThan(Number(band("tabs")["z-index"]));
  });
});
