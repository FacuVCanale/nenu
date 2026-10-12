import { timeAgo } from "@/lib/format";
import type { UpdateInfo } from "@/lib/types";

// What the Settings Updates card says, from the snapshot's `update`, whether this bundle is stale
// against the build the bridge serves, and the manual check's progress. One state at a time, with
// one action, so the card is the only place an update speaks (ADR 0027: no floating notice).
//
// Instructions are Herdr plugin actions: they run from any directory, because Herdr resolves the
// plugin's checkout.

export const RESTART_COMMAND = "herdr plugin action invoke restart --plugin herdr.collie";
export const MAJOR_COMMAND = "herdr plugin action invoke update-major --plugin herdr.collie";

export type UpdateCheck = "idle" | "checking" | "failed";

export type UpdateAction = { kind: "reload" } | { kind: "notes"; href: string } | { kind: "check" };

export interface UpdateStatus {
  /** The state in two or three words, or null when there is nothing to badge. */
  badge: string | null;
  tone: "neutral" | "new" | "error";
  /** The badge is the manual check running, so it carries a spinner. */
  working?: boolean;
  /** A few words beside the badge, under the version: when upstream was last checked. */
  meta?: string;
  /** The sentence the state needs said, for the card's footer. */
  detail?: string;
  /** A command the operator copies to the Mac. */
  command?: string;
  action: UpdateAction | null;
}

const CHECK: UpdateAction = { kind: "check" };

/**
 * Precedence: a stale interface first (this device fixes it with one tap), then a stale bridge
 * process (restarting is cheaper and more urgent than upgrading, and an upgrade restarts anyway),
 * then a routine release, then a major, the one thing the routine update will not take (ADR 0020).
 * A locally managed checkout never advertises the original project's releases.
 */
export function updateStatus(
  update: UpdateInfo | undefined,
  { staleInterface, check }: { staleInterface: boolean; check: UpdateCheck },
): UpdateStatus {
  if (staleInterface) {
    return { badge: "Interface update ready", tone: "new", detail: "The server has a newer interface than this page.", action: { kind: "reload" } };
  }
  if (update?.bridgeStale) {
    return { badge: "Restart needed", tone: "new", detail: "Server changes are waiting. Run this on your Mac to restart.", command: RESTART_COMMAND, action: null };
  }
  if (update?.releaseChannel === "local") {
    return { badge: null, tone: "neutral", detail: "Updates are managed on your Mac. Your browser refreshes when the interface is ready and your work is safe.", action: null };
  }
  if (update?.releaseAvailable && update.latest) {
    return { badge: `${update.latest} available`, tone: "new", detail: "The release notes list how to update.", action: notes(update.latestUrl) };
  }
  if (update?.majorAvailable) {
    return { badge: `Major ${update.majorAvailable} available`, tone: "new", detail: "A new major version. The routine update skips it; this command takes it.", command: MAJOR_COMMAND, action: notes(update.majorUrl) };
  }
  if (!update) return { ...checkBadge(check), detail: "Check whether a new version is available.", action: CHECK };
  // A running or failed check takes the line on its own, so the row keeps its height meanwhile.
  if (check !== "idle") return { ...checkBadge(check), action: CHECK };
  const meta = update.checkedAt ? `Checked ${timeAgo(update.checkedAt)}` : "Not checked yet";
  // A release flagged without a version to name is not "up to date" either.
  return { badge: update.releaseAvailable ? null : "Up to date", tone: "neutral", meta, action: CHECK };
}

function checkBadge(check: UpdateCheck): Pick<UpdateStatus, "badge" | "tone" | "working"> {
  if (check === "checking") return { badge: "Checking…", tone: "neutral", working: true };
  if (check === "failed") return { badge: "Couldn't check", tone: "error" };
  return { badge: null, tone: "neutral" };
}

function notes(href: string | null): UpdateAction | null {
  return href ? { kind: "notes", href } : null;
}
