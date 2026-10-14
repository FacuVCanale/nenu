import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Two contracts the screen can't show in a test run. Every icon draws through components/ui/icon, so
// the set changes in one file; and nothing in Nenu animates forever: a state that lasts (working,
// busy, sending, loading) is a still glyph, and motion only answers a tap and ends. A spinner left on
// for a whole turn cost about 1 s of CPU every 30 s on the bench (2026-10-15 audit).

const src = import.meta.dirname;
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return sources(path);
  return /\.(tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
});
const files = sources(src).map((path) => ({ path: relative(src, path), text: readFileSync(path, "utf8") }));
const offenders = (pattern: RegExp) => files.filter((f) => pattern.test(f.text)).map((f) => f.path);

it("draws every icon through the facade, with no icon package behind it", () => {
  const pkg = ["lucide", "react"].join("-");
  expect(offenders(new RegExp(`from "${pkg}"`))).toEqual([]);
  const manifest = JSON.parse(readFileSync(join(src, "../package.json"), "utf8"));
  expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => /icon|lucide/.test(name))).toEqual([]);
});

it("runs no animation forever", () => {
  expect(offenders(/\binfinite\b/)).toEqual([]);
  expect(offenders(/\banimate-(spin|pulse|ping|bounce)\b/)).toEqual([]);
});
