import type { BridgeStatus } from "./types";

export interface ConnState {
  /** Herdr link reported by the snapshot; undefined before the first successful poll. */
  bridge: BridgeStatus | undefined;
  /** The most recent snapshot fetch failed, including a request timeout. */
  error: boolean;
}

// Pending refreshes do not mean the connection failed. On a slow link they occur on every poll;
// treating them as outages repeatedly blocked Send and flashed Reconnecting/Connected.
// usePollBusy owns loading feedback. Failed/timed-out reads and Herdr's status own connectivity.
// navigator.onLine is intentionally excluded: phones can report offline while requests succeed.
export function isConnecting({ bridge, error }: ConnState): boolean {
  return error || bridge === undefined || bridge === "disconnected";
}

/** What is wrong with the link: Nenu turned this device away, Nenu does not answer, or Herdr does not. */
export type LinkProblem = "refused" | "nenu" | "herdr";

/** The problem a snapshot's state implies, or null while the link is live. */
export function linkProblemOf({ bridge, error, authError }: ConnState & { authError: boolean }): LinkProblem | null {
  if (authError) return "refused";
  if (error || bridge === undefined) return "nenu";
  return bridge === "disconnected" ? "herdr" : null;
}

const LINK_PHRASE: Record<LinkProblem, string> = { refused: "Access refused", nenu: "Can’t reach Nenu", herdr: "Herdr isn’t responding" };

/**
 * The one phrase for each problem. The banner is the surface that names it; anything else that has to
 * refer to it (History, the boot splash) quotes this, so a problem is never worded two ways. `host` is
 * for a page that never reached Nenu, where the address is the useful fact.
 */
export function linkPhrase(problem: LinkProblem, host?: string): string {
  return problem === "nenu" && host ? `${LINK_PHRASE.nenu} at ${host}` : LINK_PHRASE[problem];
}
