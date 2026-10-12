import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cssRules, declarations } from "@/test/css-rules";

// Text sizes in the navigation, the shell's chrome and the composer. Their stylesheets and these
// components draw no fixed px size: it ignores the browser's text size, and a half pixel is a step
// the scale doesn't have. The components that are fully on the scale also draw none of Tailwind's
// stock sizes (text-sm is 14px, which the scale has no step for). The palette and the files sheet
// still draw text-sm and text-xs, so they are held to the px rule only.
// jsdom lays nothing out; the bench measures the rendered sizes (redesign-shots/labels-type-reach).

const src = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(src, path), "utf8");

const STYLESHEETS = ["styles/nav.css", "styles/shell.css", "styles/composer.css"];
const ON_SCALE = [
  "components/ui/section-label.tsx",
  "components/attachment-chips.tsx",
  "components/workspace-tree.tsx",
  "components/workbench-sidebar.tsx",
  "components/bottom-tab-bar.tsx",
];
const COMPONENTS = [...ON_SCALE, "components/command-palette.tsx", "components/chat-files-browser.tsx"];

describe("text sizes in the navigation, the shell and the composer", () => {
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

  it("draws none of Tailwind's stock text sizes in the components already on the scale", () => {
    const offenders = ON_SCALE.flatMap((file) => [...read(file).matchAll(/\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/g)].map((m) => `${file}: ${m[0]}`));
    expect(offenders).toEqual([]);
  });

  it("sets the tab bar's badge in the micro step, the one the direction keeps for badges", () => {
    expect(declarations(read("styles/shell.css"), ".bottom-tab-badge", ["@layer components"])["font-size"]).toBe("var(--text-micro)");
  });
});
