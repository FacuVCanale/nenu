// A file path as a row shows it. Tool rows and the file preview used to print the absolute path and
// cut it at the end, which hid the one useful part, the file's name.
import { shortCwd } from "./format";

export interface DisplayPath {
  /** The folders, with a trailing slash, or "" for a file at the root of what is shown. */
  dir: string;
  /** The file's name. Never shortened: render it unshrinkable and let `dir` take any ellipsis. */
  base: string;
}

/**
 * `path` relative to `cwd` when it sits under it (home collapsed to `~` otherwise), split into folders
 * and name. When the whole is longer than `max` characters the folders give up whole leading segments
 * (`…/hooks/`); the name is kept even when it alone is longer.
 */
export function displayPath(path: string, cwd = "", max = 48): DisplayPath {
  const clean = path.replace(/\/+$/, "");
  const root = cwd.replace(/\/+$/, "");
  const rel = root && clean.startsWith(`${root}/`) ? clean.slice(root.length + 1) : clean;
  const cut = rel.lastIndexOf("/");
  const base = rel.slice(cut + 1);
  if (cut < 0) return { dir: "", base };
  const dir = shortCwd(rel.slice(0, cut) || "/", Math.max(0, max - base.length - 1));
  return { dir: dir === "/" ? dir : `${dir}/`, base };
}
