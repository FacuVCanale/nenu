import type { TurnInterrupt } from "../web/src/lib/harness/types.ts";
import type { InterruptResponse } from "./types.ts";

// Stop (ADR 0066). Claude 2.1.296 and Codex 0.162.1 both open their rewind on a second Escape at an
// idle screen (measured), so the key goes out once per Stop and only while the screen says a turn
// runs, re-read inside the pane's write lock.

/** Long enough to cover the repaint after Escape (~300 ms measured, ~600 ms for Herdr's status). */
export const STOP_COOLDOWN_MS = 2_000;
/** How long a Stop tapped right after Send waits for the turn to visibly start. */
export const TURN_START_WAIT_MS = 4_000;
const POLL_MS = 150;

/** When each pane's last Escape went out. A Stop inside the cooldown presses nothing. */
export class InterruptLedger {
  private last = new Map<string, number>();
  constructor(private now: () => number = Date.now, private cooldownMs = STOP_COOLDOWN_MS) {}
  recent(key: string): boolean {
    const at = this.last.get(key);
    return at !== undefined && this.now() - at < this.cooldownMs;
  }
  mark(key: string): void {
    const now = this.now();
    for (const [other, at] of this.last) if (now - at >= this.cooldownMs) this.last.delete(other);
    this.last.set(key, now);
  }
}

export interface InterruptDeps {
  read(): Promise<string>;
  /** Runs `operation` while it owns the pane's writes (PaneWrites), or says another write does. */
  exclusive<V>(operation: () => Promise<V>): Promise<{ busy: true } | { busy: false; value: V }>;
  press(keys: string[]): Promise<void>;
  /** After the key went out, still holding the pane: park Nenu's queue. Answers how many rows. */
  stopped(): Promise<number>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface InterruptRequest {
  /** The agent's name as the operator reads it ("Claude"). */
  name: string;
  /** Acknowledges that Escape sends what the CLI's own queue holds. */
  confirm: boolean;
  ledger: InterruptLedger;
  /** The pane's key in the ledger. */
  pane: string;
  waitMs?: number;
}

export async function interruptTurn(deps: InterruptDeps, interrupt: TurnInterrupt, request: InterruptRequest): Promise<InterruptResponse> {
  const { name, confirm, ledger, pane } = request;
  const deadline = deps.now() + (request.waitMs ?? TURN_START_WAIT_MS);
  const confirmRequired: InterruptResponse = {
    ok: false,
    code: "confirm_required",
    error: `${name} sends its queued message as soon as it stops. Tap Stop again to stop anyway.`,
  };
  const cooldown: InterruptResponse = { ok: true, pressed: false, queued: null, held: 0 };
  try {
    for (;;) {
      if (ledger.recent(pane)) return cooldown;
      const seen = interrupt.read(await deps.read());
      if (seen.running) {
        // Null when the turn ended between the two reads: look again until the deadline.
        const run = await deps.exclusive(async (): Promise<InterruptResponse | null> => {
          // Another Stop may have pressed while this one waited, and the screen not yet repainted.
          if (ledger.recent(pane)) return cooldown;
          const now = interrupt.read(await deps.read());
          if (!now.running) return null;
          if (now.queued === "sends" && !confirm) return confirmRequired;
          await deps.press(interrupt.keys);
          ledger.mark(pane);
          // The key is out: a failed hold must not report the Stop as failed.
          return { ok: true, pressed: true, queued: now.queued, held: await deps.stopped().catch(() => 0) };
        });
        if (!run.busy && run.value) return run.value;
      }
      if (deps.now() >= deadline) {
        return seen.running
          ? { ok: false, code: "busy", error: "A saved message is still being typed. Try Stop again." }
          : { ok: false, code: "not_running", error: `${name} isn't running a turn Nenu can stop.` };
      }
      await deps.sleep(POLL_MS);
    }
  } catch (err) {
    return { ok: false, code: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
