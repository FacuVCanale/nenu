import type { TurnInterrupt, TurnReading } from "../web/src/lib/harness/types.ts";
import type { InterruptResponse, TurnState } from "./types.ts";

// Stop (ADR 0066, amended by 0067). Claude 2.1.296 and Codex 0.162.1 both open their rewind on a
// second Escape at an idle screen (measured), so the key goes out once per Stop and only while a turn
// runs, re-read inside the pane's write lock. "A turn runs" is the CLI's own state when the bridge
// has it (Claude's session file, Codex's rollout); the screen's interrupt hint only when it has not.

/** Long enough to cover the repaint after Escape (~300 ms measured, ~600 ms for Herdr's status). */
export const STOP_COOLDOWN_MS = 2_000;
/** How long a Stop tapped right after Send waits for the turn to visibly start. */
export const TURN_START_WAIT_MS = 4_000;
const POLL_MS = 150;
/** How long a press waits for the CLI's own state to show the turn ended (measured 12-148 ms). */
export const CONFIRM_MS = 1_500;

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
  /** The CLI's own state, read fresh; undefined when no structured source knows the pane. */
  state?(): Promise<TurnState | undefined>;
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

/** One look at the pane: the structured state when there is one, the screen for what it lacks. */
interface Look extends TurnReading {
  state?: TurnState;
}

async function look(deps: InterruptDeps, interrupt: TurnInterrupt): Promise<Look> {
  const state = await deps.state?.().catch(() => undefined);
  // The screen still answers what no file says: Codex's steer and follow-up queue.
  if (state && (!state.running || state.queued !== undefined)) return { running: state.running, queued: state.queued ?? null, state };
  const screen = interrupt.read(await deps.read());
  return state ? { running: state.running, queued: screen.queued, state } : screen;
}

/** Why there is no turn to stop, as precisely as the pane's state says. */
function refusal(name: string, state: TurnState | undefined): InterruptResponse {
  const error = state?.waiting
    ? `${name} is waiting for you (${state.waiting}). Answer it; Stop never presses Escape on a dialog.`
    : state?.background
      ? `${name}'s turn is over; background work is still running, and Escape does not stop it.`
      : `${name} isn't running a turn Nenu can stop.`;
  return { ok: false, code: "not_running", error };
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
      const seen = await look(deps, interrupt);
      if (seen.running) {
        // Null when the turn ended between the two looks: look again until the deadline.
        const run = await deps.exclusive(async (): Promise<InterruptResponse | null> => {
          // Another Stop may have pressed while this one waited, and the state not yet caught up.
          if (ledger.recent(pane)) return cooldown;
          const now = await look(deps, interrupt);
          if (!now.running) return null;
          if (now.queued === "sends" && !confirm) return confirmRequired;
          await deps.press(interrupt.keys);
          ledger.mark(pane);
          // The key is out: a failed hold must not report the Stop as failed.
          return { ok: true, pressed: true, queued: now.queued, held: await deps.stopped().catch(() => 0) };
        });
        if (!run.busy && run.value) {
          const outcome = run.value;
          if (!outcome.ok || !outcome.pressed || !seen.state || !deps.state) return outcome;
          return { ...outcome, confirmed: await confirmStopped(deps) };
        }
      } else if (seen.state?.waiting) {
        // A dialog does not turn into a running turn by itself; answer now instead of waiting.
        return refusal(name, seen.state);
      }
      if (deps.now() >= deadline) {
        return seen.running
          ? { ok: false, code: "busy", error: "A saved message is still being typed. Try Stop again." }
          : refusal(name, seen.state);
      }
      await deps.sleep(POLL_MS);
    }
  } catch (err) {
    return { ok: false, code: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** After the press, outside the lock: the CLI's own state shows the turn over (idle, aborted). */
async function confirmStopped(deps: InterruptDeps): Promise<boolean> {
  const until = deps.now() + CONFIRM_MS;
  for (;;) {
    const state = await deps.state?.().catch(() => undefined);
    if (state && !state.running) return true;
    if (deps.now() >= until) return false;
    await deps.sleep(100);
  }
}
