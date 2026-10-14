// What a pull request changes, read with git from the folder a pane sits in.
//
// The client names a pane and a PR number and nothing else. The folder is the pane's own, from
// Herdr's snapshot; the branches are the ones GitHub reported for that PR in that folder's repo
// (pull-requests.ts); every argument git gets is built here from those. git runs from the folder's
// real path and only reports what lies under it (`--relative`). It writes nothing
// (GIT_OPTIONAL_LOCKS=0 keeps it from refreshing the index) and runs no configured program: no
// external diff, no textconv, no fsmonitor. The read is bounded: bytes git may print, files listed,
// lines kept per file, and a timeout. What a bound cut is said in the answer, never silently dropped.
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { servicePath } from "./claude-sessions.ts";

export interface DiffLimits {
  /** Files listed; the totals still count every file. */
  files: number;
  /** Bytes of patch read before git is stopped; files past the cut keep their counts only. */
  bytes: number;
  /** Lines kept per file; a longer file keeps its counts only. */
  fileLines: number;
  timeoutMs: number;
}

/** GitHub's own web diff stops listing at 300 files; a phone reading more than a megabyte of patch is not reading it. */
export const DIFF_LIMITS: DiffLimits = { files: 300, bytes: 1_000_000, fileLines: 1_500, timeoutMs: 8_000 };
/** `--numstat -z` prints about 60 bytes a file: room for thousands, still bounded. */
const NUMSTAT_BYTES = 512 * 1024;

/** The PR as GitHub reported it, and the branch the pane's folder has checked out (empty when detached). */
export interface DiffTarget {
  number: number;
  head: string;
  base?: string;
  checkedOut: string;
}

/** One git command: fixed argv, no shell, stdout cut at `maxBytes` (`truncated`), killed after `timeoutMs` (code 124). */
export type GitRun = (argv: string[], opts: { cwd: string; timeoutMs: number; maxBytes: number }) => Promise<{ code: number; stdout: string; truncated: boolean }>;

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  /** Each line with its marker: " " context, "+" added, "-" removed, "\" a note such as "No newline at end of file". */
  lines: string[];
}

export interface DiffFile {
  path: string;
  /** The old path of a rename. */
  from?: string;
  status: "added" | "deleted" | "renamed" | "modified";
  additions: number;
  deletions: number;
  binary?: true;
  /** Absent when `omitted` says why the lines are not here. */
  hunks?: DiffHunk[];
  omitted?: "binary" | "large" | "budget";
}

export type PaneDiff =
  | {
    ok: true;
    pr: number;
    base: string;
    head: string;
    /** `worktree`: the pane is on the PR's branch, uncommitted edits included. `branch`: the PR's pushed branch. */
    source: "worktree" | "branch";
    files: DiffFile[];
    totals: { files: number; additions: number; deletions: number };
    truncated?: { files?: true; bytes?: true };
  }
  | { ok: false; reason: "no-folder" | "no-pr" | "no-base" | "head-missing" | "failed"; message: string };

const MESSAGES = {
  "no-folder": "This pane's folder is not available, so there is no worktree to read.",
  "no-pr": "Nenu has not read this pull request from GitHub in this pane's repository yet.",
  "no-base": "The pull request's base branch is not in this repository.",
  "head-missing": "This pane is not on the pull request's branch, and that branch has not been fetched here.",
  failed: "git could not read this diff.",
} as const;

const refuse = (reason: keyof typeof MESSAGES): PaneDiff => ({ ok: false, reason, message: MESSAGES[reason] });

/**
 * A branch name as GitHub reports it, checked before it becomes part of a ref: nothing git could take
 * for an option, a range or a revision expression. Anything else is refused, not escaped.
 */
function branchName(name: string | undefined): string | undefined {
  if (!name || name.length > 255 || !/^[A-Za-z0-9_][A-Za-z0-9._/+-]*$/.test(name)) return undefined;
  if (name.includes("..") || name.includes("//") || name.endsWith("/") || name.endsWith(".lock")) return undefined;
  return name;
}

/** The environment git runs in: none of the bridge's own GIT_* (a GIT_DIR would point it elsewhere), and no writes. */
function gitEnv(PATH: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  return { ...env, PATH, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
}

export function defaultGitRun(): GitRun {
  const PATH = servicePath();
  return async (argv, { cwd, timeoutMs, maxBytes }) => {
    const binary = Bun.which(argv[0]!, { PATH });
    if (!binary) return { code: 127, stdout: "", truncated: false };
    const child = Bun.spawn([binary, ...argv.slice(1)], { cwd, env: gitEnv(PATH), stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    const reader = child.stdout.getReader();
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        if (size + chunk.value.length > maxBytes) {
          chunks.push(chunk.value.subarray(0, maxBytes - size));
          truncated = true;
          child.kill();
          break;
        }
        chunks.push(chunk.value);
        size += chunk.value.length;
      }
    } finally {
      reader.releaseLock();
    }
    const code = await child.exited;
    clearTimeout(timer);
    const stdout = new TextDecoder().decode(Buffer.concat(chunks));
    return { code: truncated ? 0 : timedOut ? 124 : code, stdout, truncated };
  };
}

interface Stat { path: string; from?: string; additions: number; deletions: number; binary: boolean }

/** `--numstat -z`: `add\tdel\tpath\0`, or `add\tdel\t\0old\0new\0` for a rename; a binary file counts `-\t-`. */
export function parseNumstat(stdout: string): Stat[] {
  const tokens = stdout.split("\0");
  const stats: Stat[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(tokens[i]!);
    if (!match) continue;
    const binary = match[1] === "-";
    const counts = { additions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary };
    if (match[3]) stats.push({ path: match[3], ...counts });
    else if (i + 2 < tokens.length) {
      stats.push({ path: tokens[i + 2]!, from: tokens[i + 1]!, ...counts });
      i += 2;
    }
  }
  return stats;
}

interface Section { status?: DiffFile["status"]; hunks: DiffHunk[]; lines: number }

/** The patch, one section per `diff --git` header, in the order numstat lists the same files. */
export function parsePatch(stdout: string): Section[] {
  const sections: Section[] = [];
  let section: Section | undefined;
  let hunk: DiffHunk | undefined;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("diff --git ")) {
      section = { hunks: [], lines: 0 };
      sections.push(section);
      hunk = undefined;
      continue;
    }
    if (!section) continue;
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      hunk = { header: line, oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] };
      section.hunks.push(hunk);
    } else if (hunk) {
      // A blank context line can come without its space (diff.suppressBlankEmpty).
      if (line === "" || " +-\\".includes(line[0]!)) {
        hunk.lines.push(line || " ");
        section.lines++;
      }
    } else if (line.startsWith("new file mode")) section.status = "added";
    else if (line.startsWith("deleted file mode")) section.status = "deleted";
    else if (line.startsWith("rename from")) section.status = "renamed";
  }
  // The split leaves the newline that ends the patch as an empty last line.
  const last = hunk?.lines;
  if (last && last.at(-1) === " " && stdout.endsWith("\n")) {
    last.pop();
    section!.lines--;
  }
  return sections;
}

/**
 * The diff of PR `target` from the folder `cwd`. On the PR's branch it is the working tree against
 * where the branch left its base; elsewhere in the repo it is the pushed branch against the same.
 */
export async function paneDiff(
  cwd: string | undefined,
  target: DiffTarget | undefined,
  { run = defaultGitRun(), limits: overrides = {} }: { run?: GitRun; limits?: Partial<DiffLimits> } = {},
): Promise<PaneDiff> {
  const limits = { ...DIFF_LIMITS, ...overrides };
  if (!cwd || !isAbsolute(cwd)) return refuse("no-folder");
  let folder: string;
  try {
    folder = await realpath(cwd);
    if (!(await stat(folder)).isDirectory()) return refuse("no-folder");
  } catch {
    return refuse("no-folder");
  }
  if (!target) return refuse("no-pr");
  const base = branchName(target.base);
  if (!base) return refuse("no-base");
  const head = branchName(target.head);
  if (!head) return refuse("head-missing");

  const git = (args: string[], maxBytes = 64 * 1024) => run(["git", ...args], { cwd: folder, timeoutMs: limits.timeoutMs, maxBytes });
  const refs = await git(["for-each-ref", "--format=%(refname)", `refs/remotes/origin/${base}`, `refs/heads/${base}`, `refs/remotes/origin/${head}`]);
  if (refs.code !== 0) return refuse("failed");
  const present = new Set(refs.stdout.split("\n"));
  const baseRef = [`refs/remotes/origin/${base}`, `refs/heads/${base}`].find((ref) => present.has(ref));
  if (!baseRef) return refuse("no-base");
  const source = target.checkedOut === head ? "worktree" : "branch";
  const headRef = source === "worktree" ? "HEAD" : `refs/remotes/origin/${head}`;
  if (source === "branch" && !present.has(headRef)) return refuse("head-missing");

  const mergeBase = await git(["merge-base", baseRef, headRef]);
  const forkPoint = mergeBase.stdout.trim();
  if (mergeBase.code !== 0 || !/^[0-9a-f]{40,64}$/.test(forkPoint)) return refuse("failed");

  // The working tree when the pane is on the branch, the pushed branch otherwise.
  const range = source === "worktree" ? [forkPoint] : [forkPoint, headRef];
  const diff = ["-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--relative", "--find-renames"];
  const [numstat, patch] = await Promise.all([
    git([...diff, "--numstat", "-z", ...range, "--"], NUMSTAT_BYTES),
    git([...diff, ...range, "--"], limits.bytes),
  ]);
  if (numstat.code !== 0 || patch.code !== 0) return refuse("failed");

  const stats = parseNumstat(numstat.stdout);
  const sections = parsePatch(patch.stdout);
  // The last section a cut read may have lost its end: it counts as not read.
  const complete = patch.truncated ? sections.length - 1 : sections.length;
  const files = stats.slice(0, limits.files).map((entry, index): DiffFile => {
    const section = index < complete ? sections[index] : undefined;
    const status = section?.status ?? (entry.from ? "renamed" : "modified");
    const file: DiffFile = { path: entry.path, ...(entry.from ? { from: entry.from } : {}), status, additions: entry.additions, deletions: entry.deletions };
    if (entry.binary) return { ...file, binary: true, omitted: "binary" };
    if (!section) return { ...file, omitted: "budget" };
    if (section.lines > limits.fileLines) return { ...file, omitted: "large" };
    return { ...file, hunks: section.hunks };
  });
  const truncated = {
    ...(stats.length > limits.files || numstat.truncated ? { files: true as const } : {}),
    ...(patch.truncated ? { bytes: true as const } : {}),
  };
  return {
    ok: true,
    pr: target.number,
    base,
    head,
    source,
    files,
    totals: {
      files: stats.length,
      additions: stats.reduce((sum, entry) => sum + entry.additions, 0),
      deletions: stats.reduce((sum, entry) => sum + entry.deletions, 0),
    },
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };
}
