import { GLYPHS, GLYPH_NAMES, HUE_NAMES, fnv1a, projectMark } from "./project-glyph";

// The designboard's examples (Project icons): slug, FNV-1a of the slug, glyph and hue. A project's mark
// comes from its slug alone, so these hold on every device and after every reload.
const EXAMPLES = [
  ["acme-shop", "a388aa4a", "peak", "teal"],
  ["docs-site", "6d9561a6", "spark", "blue"],
  ["mobile-app", "fbfc5565", "smile", "green"],
  ["billing-api", "5623da51", "wave", "teal"],
  ["data-pipeline", "6e1b76f6", "arrow", "red"],
  ["onboarding", "2263ef18", "scatter", "violet"],
  ["design-system", "9e649ec7", "flag", "indigo"],
  ["analytics", "5c10448b", "window", "indigo"],
  ["support-bot", "1b7c78e4", "orbitcheck", "indigo"],
  ["admin-panel", "f19ba613", "diamond", "amber"],
  ["edge-cache", "3f7f3b37", "bolt", "slate"],
  ["blog", "60bcabf1", "wave", "blue"],
] as const;

describe("a project's mark", () => {
  it("is the glyph and hue its slug hashes to, the same as the design's examples", () => {
    for (const [slug, hash, glyph, hue] of EXAMPLES) {
      expect(fnv1a(slug).toString(16).padStart(8, "0"), slug).toBe(hash);
      expect(projectMark(slug), slug).toEqual({ glyph, hue });
    }
  });

  it("hashes the slug's UTF-8 bytes, so a slug outside ASCII keeps its mark too", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("diseño")).not.toBe(fnv1a("diseno"));
    expect(projectMark("diseño")).toEqual(projectMark("diseño"));
  });

  it("tells neighbours in a list apart: no two example projects share a glyph and a hue, and no two in a row share a glyph", () => {
    const marks = EXAMPLES.map(([slug]) => projectMark(slug));
    expect(new Set(marks.map(({ glyph, hue }) => `${glyph}:${hue}`)).size).toBe(marks.length);
    marks.slice(1).forEach((mark, i) => expect(mark.glyph, `${EXAMPLES[i]![0]} then ${EXAMPLES[i + 1]![0]}`).not.toBe(marks[i]!.glyph));
  });

  it("picks from 24 glyphs and 10 hues, and every glyph draws something", () => {
    expect(GLYPH_NAMES).toHaveLength(24);
    expect(HUE_NAMES).toHaveLength(10);
    for (const name of GLYPH_NAMES) expect(GLYPHS[name].stroke + GLYPHS[name].fill + (GLYPHS[name].dash ?? ""), name).toMatch(/^M/);
  });

  it("reaches every glyph and every hue across a herd of slugs", () => {
    const marks = Array.from({ length: 2000 }, (_, i) => projectMark(`project-${i}`));
    expect(new Set(marks.map((mark) => mark.glyph)).size).toBe(24);
    expect(new Set(marks.map((mark) => mark.hue)).size).toBe(10);
  });
});
