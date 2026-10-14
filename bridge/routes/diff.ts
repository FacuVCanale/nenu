import { paneDiff } from "../pane-diff.ts";
import type { PaneAction } from "./context.ts";
import { json, jsonError } from "./http.ts";

// `/api/pane/:id/diff?pr=<number>` — what pull request `pr` changes, read from this pane's folder.
// The number is only a lookup in the PRs GitHub reported for that folder's repo; the folder, the
// branches and git's arguments all come from the bridge (pane-diff.ts). Read-level, like the
// pane's files: it shows what is under the pane's folder.
export const diffPaneActions: Record<string, PaneAction> = {
  diff: {
    level: "read",
    marksSeen: false,
    async handle({ pullRequests }, { req, url, rt, paneId }) {
      const number = Number(url.searchParams.get("pr"));
      if (!Number.isSafeInteger(number) || number <= 0) return jsonError("pr must be a pull request number.", 400, null);
      const current = rt.engine.current();
      const cwd = [...current.agents, ...current.shellPanes].find((entry) => entry.paneId === paneId)?.cwd;
      const found = cwd ? pullRequests.locate(cwd, number) : undefined;
      const target = found && { number, head: found.pr.branch, base: found.pr.base, checkedOut: found.checkedOut };
      return json(await paneDiff(cwd, target), req.headers.get("accept-encoding"));
    },
  },
};
