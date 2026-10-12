import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cssRules, declarations } from "@/test/css-rules";

// The navigation, the shell's chrome and the composer take every text size from the type scale: a
// fixed px size ignores the browser's text size, and a half pixel is a step the scale doesn't have.
// jsdom lays nothing out; the bench measures the rendered sizes (redesign-shots/labels-type-reach).

const src = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(src, path), "utf8");

const STYLESHEETS = ["styles/nav.css", "styles/shell.css", "styles/composer.css"];
const COMPONENTS = [
  "components/ui/section-label.tsx",
  "components/command-palette.tsx",
  "components/chat-files-browser.tsx",
  "components/attachment-chips.tsx",
  "components/workspace-tree.tsx",
  "components/workbench-sidebar.tsx",
  "components/bottom-tab-bar.tsx",
];

describe("type in the navigation, the shell and the composer", () => {
  it("takes every font size in their stylesheets from the scale", () => {
    const offenders = STYLESHEETS.flatMap((file) =>
      cssRules(read(file))
        .filter((rule) => rule.decls["font-size"] && !/^(var\(--text-[a-z-]+\)|inherit)$/.test(rule.decls["font-size"]))
        .map((rule) => `${file}: ${rule.selectors.join(", ")} { font-size: ${rule.decls["font-size"]} }`),
    );
    expect(offenders).toEqual([]);
  });

  it("draws no arbitrary px text size in their components", () => {
    const offenders = COMPONENTS.flatMap((file) => [...read(file).matchAll(/\btext-\[[\d.]+px\]/g)].map((m) => `${file}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  it("sets the tab bar's badge in the micro step, the one the direction keeps for badges", () => {
    expect(declarations(read("styles/shell.css"), ".bottom-tab-badge", ["@layer components"])["font-size"]).toBe("var(--text-micro)");
  });
});
