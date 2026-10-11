import { hasCodexInterruptCue } from "../web/src/lib/harness/codex/interrupt.ts";
import type { AgentView, DeliveryMode, QueueWaitReason } from "./types.ts";
import type { HerdrClient } from "./herdr-client.ts";
import { adapterFor } from "../web/src/lib/harness/index.ts";
import { parseAnsi } from "../web/src/lib/ansi.ts";
import { splitLines } from "../web/src/lib/blocks.ts";
import { hasNativeNextTurnQueue } from "./queue-native.ts";

/** Ready to type now, and whether a turn is running (it picks Codex's next-turn key). */
export type Readiness = { ready: true; busy: boolean } | { ready: false; reason: QueueWaitReason };

/**
 * Whether a row in `mode` may be typed into the pane now (ADR 0056). Every mode needs the input box
 * on screen, free of dialogs and of a draft the operator is typing at the terminal; that is read
 * from the screen whatever Herdr's status says, except a dialog the CLI's own state reports. Only `afterTurn` also waits for the turn to end,
 * unless the CLI keeps a next-turn queue of its own.
 */
export async function queueReadiness(
  pane: Pick<AgentView, "paneId" | "agent" | "status" | "turn">,
  herdr: Pick<HerdrClient, "readPane">,
  mode: DeliveryMode,
): Promise<Readiness> {
  const adapter = adapterFor(pane.agent);
  if (!adapter?.composerReady) return { ready: false, reason: "disconnected" };
  if (!["idle", "done", "working", "blocked"].includes(pane.status)) return { ready: false, reason: "disconnected" };
  const holdsForTurn = mode === "afterTurn" && !hasNativeNextTurnQueue(pane.agent);
  if (holdsForTurn && pane.status === "working") return { ready: false, reason: "working" };
  // A dialog the CLI itself reports (Claude's `waiting`) owns the keyboard whatever the screen shows.
  if (pane.turn?.waiting) return { ready: false, reason: "dialog" };
  const { text } = await herdr.readPane(pane.paneId, "visible", 100, "ansi");
  // Codex reports `blocked` while it repaints a running turn. Its rollout says whether a turn is open
  // (ADR 0067); the painted interrupt cue only when no rollout is known for the pane.
  const busy = pane.status === "working" || (pane.turn ? pane.turn.running : pane.agent === "codex" && hasCodexInterruptCue(text));
  if (holdsForTurn && busy) return { ready: false, reason: "working" };
  const lines = splitLines(parseAnsi(text));
  if (!adapter.composerReady(lines)) return { ready: false, reason: "dialog" };
  if (adapter.extractInputDraft(lines)?.trim()) return { ready: false, reason: "draft" };
  return { ready: true, busy };
}
