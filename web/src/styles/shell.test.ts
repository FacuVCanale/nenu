import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { declarations } from "@/test/css-rules";

const css = readFileSync(resolve(import.meta.dirname, "shell.css"), "utf8");
const LAYER = "@layer components";

// The open tab reads by its ink and by its weight: its glyph draws at 1.75 over the bar's 1.5.
it("draws the open tab's glyph a step heavier than the rest of the tab bar", () => {
  for (const tab of ['.bottom-tab[aria-current="page"] svg', '.bottom-tab[aria-pressed="true"] svg']) {
    expect(declarations(css, tab, [LAYER])["stroke-width"]).toBe("1.75");
  }
});
