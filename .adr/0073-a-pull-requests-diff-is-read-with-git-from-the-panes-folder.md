# 0073. A pull request's diff is read with git from the pane's folder, and drawn by Nenu

- **Status:** Accepted (2026-10-14).
- **Trail:** `bridge/pane-diff.ts` · `bridge/routes/diff.ts` · `bridge/pull-requests.ts` (`locate`) ·
  `web/src/components/diff-stat.tsx` · `web/src/components/diff-viewer.tsx`

## Context

Nenu showed a pull request's size, "+N −M", and nothing behind it. Two roads were proposed for the
diff itself: `gh pr diff <n>`, and porting T3 Code's diff panel, since Nenu's workbench is adapted
from T3 Code.

Measured on 2026-10-14 against three open pull requests of a private repository, read-only, on the operator's Mac:

| | `gh pr diff` | `git diff` from the pane's folder |
| --- | --- | --- |
| PR A, 422 files | refused: GitHub returns HTTP 406 past 300 files | 296–521 ms, totals equal to GitHub's |
| PR B, 191 files | 1.46 s, 615 KB | 195–480 ms, totals equal to GitHub's |
| PR C, 57 files | 1.33 s, 139 KB | 162–371 ms, totals equal to GitHub's |

GitHub's limit refused two of the four PRs on the operator's screen. `gh` also needs the network and
an authenticated CLI on the host, and sees only what was pushed, not what the agent is still
writing.

T3 Code draws diffs with `@pierre/diffs` (6.7 MB unpacked), which brings Shiki for highlighting
and a worker pool. Nenu's own viewer is 2.0 kB gzip, loaded on the first tap, and added 459 B gzip to
the initial bundle.

## Decision

1. **git, from the pane's folder.** The client names a pane and a PR number. The bridge finds that PR
   among those GitHub reported for the folder's repo, and builds every git argument itself from the
   PR's base and head branches. On the PR's branch it diffs the working tree against the merge base,
   uncommitted edits included. Elsewhere in the same repo it diffs the pushed branch. git runs
   without writing (`GIT_OPTIONAL_LOCKS=0`), without configured diff programs, limited to the folder
   (`--relative`), and bounded (files, bytes, lines a file, time), saying what each bound cut.
2. **Nenu draws it.** Lines are text nodes in a lazy chunk, with no highlighting.

## Consequences

- A merged or closed PR, a PR GitHub has not reported for the folder's repo (not the operator's, or
  `gh` failing), and a PR whose branch was never fetched here show a reason and a GitHub link instead
  of a diff.
- Totals can differ from GitHub's "+N −M" by the uncommitted edits, and by a stale `origin/<base>`:
  the bridge never fetches.
- Revisit `gh pr diff` only as a fallback for PRs with no local repo, and with GitHub's 300-file
  limit handled. Revisit highlighting only with a measured size, loaded no earlier than the viewer.

## Amendment (2026-10-14): a session's scopes

The desk's session panel shows a pane's changes with or without a pull request. The client may name
a scope instead of a number: `branch` (the working tree against where the checked-out branch left
its base) or `uncommitted` (the working tree against the last commit). The base is the one the
branch's PR names, else `origin/HEAD`, else main or master, each checked as a branch name before it
becomes a ref. Both scopes also name the files git does not track yet, without lines. Same rules as
above: fixed argv, the folder's real path, `--relative`, no writes, the same bounds
(`bridge/pane-diff.ts` `sessionDiff`).
