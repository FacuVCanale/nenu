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
  it("take 32px each, so both bands together leave the thread more room than one did with the pane row", () => {
    expect(declarations(css, ".strip", [LAYER, COARSE]).height).toBe("32px");
    expect(declarations(css, ".strip-chip", [LAYER, COARSE]).height).toBe("32px");
  });

  it("give every chip a 44px reach that hangs off its band", () => {
    for (const name of ["tabs", "panes"] as const) {
      const reach = band(name, [LAYER, COARSE]);
      expect(32 + px(reach["--reach-up"]) + px(reach["--reach-down"]), name).toBe(44);
    }
    const chipReach = cssRules(css).find((rule) => rule.selectors.includes(".strip-chip::after"));
    expect(chipReach?.decls).toMatchObject({ top: "calc(-1 * var(--reach-up))", bottom: "calc(-1 * var(--reach-down))" });
  });

  it("never reach over another control: the pane row reaches down only, the tab row no further up than the header's slack", () => {
    // The header's 44px buttons sit 2px clear of its 48px bottom edge.
    expect(px(band("panes", [LAYER, COARSE])["--reach-up"])).toBe(0);
    expect(px(band("tabs", [LAYER, COARSE])["--reach-up"])).toBeLessThanOrEqual(2);
    // The tab row's downward reach goes under the pane row, never over its pills.
    expect(Number(band("panes")["z-index"])).toBeGreaterThan(Number(band("tabs")["z-index"]));
  });
});
