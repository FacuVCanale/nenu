// Relative imports: the bridge's queue reads this same rule (bridge/queue-readiness.ts).
import { hasCodexInterruptCue } from "./harness/codex/interrupt";
import type { AgentView } from "./types";

// Whether a turn runs, for everything that acts on it (ADR 0067): Stop, Send's "now or after this
// turn", and when the queue delivers. The CLI's own state, attached by the bridge as `turn`, decides
// when it is there; it is the same entry Stop re-reads before pressing. Without it the old signals
// stay the fallback: Herdr's status, and Codex's painted interrupt cue.

type Pane = Pick<AgentView, "agent" | "status" | "turn"> | null | undefined;

/** A turn runs: what shows Stop, and what makes Send offer "now" or "after this turn". Background
 *  work alone is not one: Claude starts a new turn on Enter then, as it does when idle (measured). */
export function turnRunning(agent: Pane, screen: string): boolean {
  if (agent?.turn) return agent.turn.running;
  return agent?.status === "working" || (agent?.agent === "codex" && hasCodexInterruptCue(screen));
}

/** The agent is busy, turn or not: what shows Working… in the conversation. */
export function agentBusy(agent: Pane, screen: string): boolean {
  return agent?.status === "working" || turnRunning(agent, screen);
}
