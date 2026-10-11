import { hasCodexInterruptCue } from "@/lib/harness/codex/interrupt";
import type { AgentView } from "@/lib/types";

// Whether a turn runs, for the controls that act on it (ADR 0067). The CLI's own state, attached by
// the bridge as `turn`, decides when it is there; it is the same entry Stop re-reads before pressing.
// Without it the old signals stay the fallback: Herdr's status, and Codex's painted interrupt cue.

type Pane = Pick<AgentView, "agent" | "status" | "turn"> | null | undefined;

/** A turn the interrupt key reaches: what shows Stop. */
export function turnRunning(agent: Pane, screen: string): boolean {
  if (agent?.turn) return agent.turn.running;
  return agent?.status === "working" || (agent?.agent === "codex" && hasCodexInterruptCue(screen));
}

/** The agent is busy, turn or not: what makes Send offer "now" or "after this turn". */
export function agentBusy(agent: Pane, screen: string): boolean {
  return agent?.status === "working" || turnRunning(agent, screen);
}

/** Why Stop is not offered while the agent still looks busy: only background work runs, which the
 *  interrupt key does not reach. Null when there is nothing to explain. A dialog has its own card. */
export function turnNote(agent: Pane): string | null {
  const turn = agent?.turn;
  return turn && !turn.running && turn.background ? "Background work is running. Stop doesn't reach it." : null;
}
