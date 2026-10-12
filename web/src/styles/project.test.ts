import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cssRules } from "@/test/css-rules";

// The project area's contracts that fail silently: jsdom lays nothing out and matches no :hover or
// :focus-visible, so these read the declared rules and the bench measures the rendered result
// (redesign-shots/project, scene R).

const css = readFileSync(resolve(import.meta.dirname, "project.css"), "utf8");

describe("a row's actions", () => {
  // The words sit over the row's age on the row's own fill (background: inherit). Shown on a bare
  // row, "Close" and "35m" print over each other: the native dialog hands focus back to Close after
  // a Cancel by mouse, without :focus-visible, so the row stays unlit while :focus-within held them.
  it("show only on a row that has its fill", () => {
    const shown = cssRules(css).flatMap((rule) => rule.decls.opacity === "1"
      ? rule.selectors.filter((selector) => selector.split(" ").at(-1)!.startsWith(".task-actions")).map((selector) => ({ selector, atRules: rule.atRules }))
      : []);
    expect(shown.length).toBeGreaterThan(0);
    for (const { selector, atRules } of shown) {
      const row = /^(\.task-row\S*) \.task-actions$/.exec(selector)?.[1];
      expect(row, `${selector} shows the actions without naming the row's state`).toBeDefined();
      const lit = cssRules(css).some((rule) => rule.selectors.includes(row!) && rule.decls.background !== undefined && rule.atRules.join() === atRules.join());
      expect(lit, `${row} shows the actions but gives the row no fill`).toBe(true);
    }
  });
});
