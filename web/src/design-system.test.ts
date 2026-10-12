import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { META_COLOR } from "./hooks/use-theme";
import { TYPE_SCALE } from "./lib/utils";

// The design tokens' contracts that fail silently: a text tone mixed with transparent (it measured
// 3.16:1 in light), a browser chrome colour that drifts from the page, type sizes that ignore the
// browser's text size, and the loading strip drawn under the iPhone's status bar. The bench measures
// the rendered result; these keep the source from sliding back.

const src = import.meta.dirname;
const read = (path: string) => readFileSync(resolve(src, path), "utf8");
const indexCss = read("index.css");

function filesEndingIn(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesEndingIn(path, ext);
    return entry.name.endsWith(ext) && !entry.name.includes(".test.") ? [path] : [];
  });
}
const stylesheets = (dir: string) => filesEndingIn(dir, ".css");

/** `--name: light-dark(<light>, <dark>)` from index.css, as the two hex halves. */
function themed(name: string): [string, string] {
  const match = indexCss.match(new RegExp(`--${name}:\\s*light-dark\\((#[0-9a-f]{3,6}),\\s*(#[0-9a-f]{3,6})\\)`, "i"));
  if (!match) throw new Error(`--${name} is not a light-dark() pair of hex colours`);
  return [match[1]!.toLowerCase(), match[2]!.toLowerCase()];
}

function luminance(hex: string): number {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("text colour", () => {
  it("never takes a tone from alpha in a stylesheet", () => {
    const offenders = stylesheets(src).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:^|[;{\s])color:\s*([^;}]*)/g)]
        .filter((m) => /color-mix\(.*transparent/.test(m[1]!))
        .map((m) => `${relative(src, file)}: color: ${m[1]!.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it("has a solid tertiary tone that clears 4.5:1 on the page, a card and the sidebar in both themes", () => {
    const subtle = themed("subtle-foreground");
    for (const ground of ["background", "card", "workbench-sidebar"]) {
      const halves = themed(ground);
      halves.forEach((bg, i) => expect(contrast(subtle[i]!, bg), `${ground} ${i ? "dark" : "light"}`).toBeGreaterThanOrEqual(4.5));
    }
  });
});

describe("type scale", () => {
  it("defines every step in rem, so the browser's text size scales it", () => {
    // The same list teaches cn() the scale (lib/utils.ts), so a step added here merges too.
    for (const step of TYPE_SCALE) {
      expect(indexCss, step).toMatch(new RegExp(`--text-${step}:\\s*[\\d.]+rem;`));
    }
  });

  it("gives a coarse pointer its own variant", () => {
    expect(indexCss).toMatch(/@custom-variant coarse \(@media \(pointer: coarse\)\);/);
  });
});

describe("chrome", () => {
  it("paints the browser bar and the boot splash with the page's own background", () => {
    const [light, dark] = themed("background");
    const html = read("../index.html");
    expect(html).toContain(`<meta name="theme-color" content="${light}" media="(prefers-color-scheme: light)" />`);
    expect(html).toContain(`<meta name="theme-color" content="${dark}" media="(prefers-color-scheme: dark)" />`);
    expect(html).toMatch(new RegExp(`\\.boot-splash \\{[^}]*background: light-dark\\(${light}, ${dark}\\)`));
  });

  it("keeps the browser bar on the page's background after load, when useTheme rewrites the metas", () => {
    const [light, dark] = themed("background");
    expect(META_COLOR).toEqual({ light, dark });
  });

  it("gives every header the status bar's surface, mixed from the page background", () => {
    expect(indexCss).toMatch(/--chrome:\s*color-mix\(in oklab, var\(--background\)/);
    expect(read("workbench.css")).toMatch(/^\.workbench-app-header \{[^}]*background: var\(--chrome\)/m);
  });

  it("starts the loading strip under the status bar, not behind it", () => {
    expect(indexCss).toMatch(/\.busy-bar \{[^}]*top: calc\(var\(--app-viewport-top, 0px\) \+ env\(safe-area-inset-top, 0px\)\)/);
  });

  it("keeps one focus ring: a 2px outline 2px out", () => {
    expect(indexCss).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--ring\);\s*outline-offset: 2px;/);
  });

  it("never lets a control that styles its own focus drop the ring without drawing one", () => {
    // The shared ring lives in @layer base, so a focus-visible:outline-none utility beats it. A
    // control that restyles its focus (a tint, a border) and drops the outline must draw a ring, or a
    // keyboard user tabbing to it sees nothing: the busy-send rows' tint measured 1.09:1 on the card.
    const offenders = filesEndingIn(src, ".tsx").flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/"([^"\n]*)"|`([^`]*)`/g)]
        .map((m) => m[1] ?? m[2]!)
        .filter((classes) => /\boutline-none\b/.test(classes) && /\bfocus-visible:(?!outline)/.test(classes) && !/\bfocus-visible:ring/.test(classes))
        .map((classes) => `${relative(src, file)}: ${classes}`),
    );
    expect(offenders).toEqual([]);
  });
});
