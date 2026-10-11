import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { InterruptLedger, interruptTurn, type InterruptDeps } from "./interrupt.ts";
import { PaneWrites } from "./pane-writes.ts";
import { interruptPane } from "./routes/reply.ts";
import type { HerdrClient } from "./herdr-client.ts";
import type { StateEngine } from "./state-engine.ts";
import type { AgentView, InterruptResponse, TurnState } from "./types.ts";
import type { AuditEntry } from "./audit.ts";
import { adapterFor } from "../web/src/lib/harness/index.ts";

// Live captures (web/src/lib/harness/*/fixtures): Claude 2.1.296 and Codex 0.162.1.
const capture = (agent: string, name: string) =>
  readFileSync(join(import.meta.dirname, "..", "web", "src", "lib", "harness", agent, "fixtures", `${name}.txt`), "utf8");
const CLAUDE_WORKING = capture("claude", "interrupt-working-tool-v2296");
const CLAUDE_IDLE = capture("claude", "interrupt-after-v2296");
const CLAUDE_QUEUED = capture("claude", "working-queued-v2296");
const CLAUDE_DIALOG = capture("claude", "permission-bash-v2296");
const CODEX_WORKING = capture("codex", "interrupt-working-v0162");
const claude = adapterFor("claude")!.interrupt!;

/** A pane whose screen is `screens[i]` on the i-th read (the last one repeats), on a fake clock. */
function harness(screens: string[], opts: { busyFor?: number } = {}) {
  let reads = 0;
  let clock = 0;
  let busy = opts.busyFor ?? 0;
  const pressed: string[][] = [];
  let held = 0;
  const deps: InterruptDeps = {
    read: async () => screens[Math.min(reads++, screens.length - 1)]!,
    exclusive: async (operation) => (busy-- > 0 ? { busy: true } : { busy: false, value: await operation() }),
    press: async (keys) => void pressed.push(keys),
    stopped: async () => ++held,
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
  };
  return { deps, pressed, held: () => held, clock: () => clock, ledger: new InterruptLedger(() => clock) };
}
const request = (ledger: InterruptLedger, confirm = false) => ({ name: "Claude", confirm, ledger, pane: "w1:p1" });

describe("one Stop", () => {
  test("presses Escape once on a running turn and parks Nenu's queue", async () => {
    const h = harness([CLAUDE_WORKING]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toEqual({ ok: true, pressed: true, queued: null, held: 1 });
    expect(h.pressed).toEqual([["Escape"]]);
  });

  test("a second Stop before the screen repaints presses nothing (no rewind)", async () => {
    const h = harness([CLAUDE_WORKING]);
    await interruptTurn(h.deps, claude, request(h.ledger));
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toEqual({ ok: true, pressed: false, queued: null, held: 0 });
    expect(h.pressed).toEqual([["Escape"]]);
    expect(h.held()).toBe(1);
  });

  test("a stale tap at an idle screen or a dialog presses nothing", async () => {
    for (const screen of [CLAUDE_IDLE, CLAUDE_DIALOG]) {
      const h = harness([screen]);
      const outcome = await interruptTurn(h.deps, claude, request(h.ledger));
      expect(outcome).toMatchObject({ ok: false, code: "not_running" });
      expect(h.pressed).toEqual([]);
      expect(h.held()).toBe(0);
    }
  });

  test("tapped right after Send, it waits for the turn to start, then presses", async () => {
    const h = harness([CLAUDE_IDLE, CLAUDE_IDLE, CLAUDE_WORKING]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: true, pressed: true });
    expect(h.pressed).toEqual([["Escape"]]);
    expect(h.clock()).toBe(300);
  });

  test("a turn that ends between the look and the lock is not pressed", async () => {
    const h = harness([CLAUDE_WORKING, CLAUDE_IDLE]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: false, code: "not_running" });
    expect(h.pressed).toEqual([]);
  });

  test("Claude's own queue would send at once: the first tap asks, the confirmed one presses", async () => {
    const h = harness([CLAUDE_QUEUED]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: false, code: "confirm_required" });
    expect(h.pressed).toEqual([]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger, true))).toEqual({ ok: true, pressed: true, queued: "sends", held: 1 });
    expect(h.pressed).toEqual([["Escape"]]);
  });

  test("waits out a saved message being typed, and gives up past the deadline", async () => {
    const waited = harness([CLAUDE_WORKING], { busyFor: 3 });
    expect(await interruptTurn(waited.deps, claude, request(waited.ledger))).toMatchObject({ ok: true, pressed: true });
    const stuck = harness([CLAUDE_WORKING], { busyFor: 1_000 });
    expect(await interruptTurn(stuck.deps, claude, request(stuck.ledger))).toMatchObject({ ok: false, code: "busy" });
    expect(stuck.pressed).toEqual([]);
  });

  test("a failed key press is reported and starts no cooldown", async () => {
    const h = harness([CLAUDE_WORKING]);
    const failing = { ...h.deps, press: async () => { throw new Error("socket closed"); } };
    expect(await interruptTurn(failing, claude, request(h.ledger))).toEqual({ ok: false, code: "failed", error: "socket closed" });
    expect(h.ledger.recent("w1:p1")).toBe(false);
    expect(h.held()).toBe(0);
  });
});

describe("with the CLI's own state (ADR 0067)", () => {
  /** `harness`, plus a structured state that is `states[i]` on the i-th look. */
  function stated(screens: string[], states: (TurnState | undefined)[]) {
    const h = harness(screens);
    let looks = 0;
    let screenReads = 0;
    const deps: InterruptDeps = {
      ...h.deps,
      read: async () => { screenReads++; return h.deps.read(); },
      state: async () => states[Math.min(looks++, states.length - 1)],
    };
    return { ...h, deps, screenReads: () => screenReads };
  }
  const running: TurnState = { running: true, queued: null, source: "claude-session" };
  const idle: TurnState = { running: false, source: "claude-session" };

  test("a custom statusline hides Claude's hint: the session file still says busy, so Stop presses", async () => {
    // The screen without "esc to interrupt" is exactly what a custom statusLine leaves (docs, measured).
    const h = stated([CLAUDE_IDLE], [running, running, idle]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toEqual({ ok: true, pressed: true, queued: null, held: 1, confirmed: true });
    expect(h.pressed).toEqual([["Escape"]]);
    // Claude's queue came from the transcript, so the screen was never read.
    expect(h.screenReads()).toBe(0);
  });

  test("the state wins over a stale screen that still paints the hint", async () => {
    const h = stated([CLAUDE_WORKING], [idle]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: false, code: "not_running" });
    expect(h.pressed).toEqual([]);
  });

  test("a dialog is refused at once and never pressed", async () => {
    const h = stated([CLAUDE_DIALOG], [{ running: false, waiting: "permission prompt", source: "claude-session" }]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toEqual({ ok: false, code: "not_running", error: "Claude is waiting for you (permission prompt). Answer it; Stop never presses Escape on a dialog." });
    expect(h.pressed).toEqual([]);
    expect(h.clock()).toBe(0);
  });

  test("background work alone is not stopped: Escape would do nothing", async () => {
    const h = stated([CLAUDE_IDLE], [{ running: false, background: true, source: "claude-session" }]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: false, code: "not_running", error: expect.stringContaining("background work") });
    expect(h.pressed).toEqual([]);
  });

  test("the transcript's queue asks first, like the screen's placeholder did", async () => {
    const h = stated([CLAUDE_IDLE], [{ ...running, queued: "sends" }]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: false, code: "confirm_required" });
    expect(h.pressed).toEqual([]);
  });

  test("Codex: the rollout says a turn runs, the screen still names its queue", async () => {
    const codex = adapterFor("codex")!.interrupt!;
    const h = stated([CODEX_WORKING], [{ running: true, source: "codex-rollout" }, { running: true, source: "codex-rollout" }, { running: false, source: "codex-rollout" }]);
    expect(await interruptTurn(h.deps, codex, { ...request(h.ledger), name: "Codex" })).toEqual({ ok: true, pressed: true, queued: null, held: 1, confirmed: true });
    expect(h.screenReads()).toBe(2);
  });

  test("a turn that keeps running after the press is reported unconfirmed", async () => {
    const h = stated([CLAUDE_IDLE], [running]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toMatchObject({ ok: true, pressed: true, confirmed: false });
    expect(h.pressed).toEqual([["Escape"]]);
  });

  test("no structured source: the screen decides, as before", async () => {
    const h = stated([CLAUDE_WORKING], [undefined]);
    expect(await interruptTurn(h.deps, claude, request(h.ledger))).toEqual({ ok: true, pressed: true, queued: null, held: 1 });
  });
});

describe("POST /api/pane/:id/interrupt", () => {
  function route(agent: string, screen: string, status: AgentView["status"] = "working", states?: (TurnState | undefined)[]) {
    const pressed: string[][] = [];
    const audits: AuditEntry[] = [];
    const holds: string[] = [];
    const herdr = {
      readPane: async () => ({ text: screen, revision: 1, truncated: false }),
      sendPaneKeys: async (_pane: string, keys: string[]) => void pressed.push(keys),
    } as unknown as HerdrClient;
    const pane = { paneId: "w1:p1", agent, status } as AgentView;
    const engine = { current: () => ({ agents: [pane] }) } as unknown as StateEngine;
    const input = new PaneWrites();
    const ledger = new InterruptLedger();
    let looks = 0;
    const agentStates = states ? { fresh: async () => states[Math.min(looks++, states.length - 1)] } : undefined;
    const call = (body = "{}") =>
      interruptPane(
        { rt: { herdr, engine, name: "default" }, input, queue: { holdAfterStop: async (_s, paneId) => (holds.push(paneId), 1) }, audit: { record: (entry) => void audits.push(entry) }, agentStates },
        "w1:p1",
        new Request("http://localhost/api/pane/w1%3Ap1/interrupt", { method: "POST", body }),
        "phone",
        ledger,
      ).then((response) => response.json() as Promise<InterruptResponse>);
    return { call, pressed, audits, holds, input };
  }

  test("stops a working Codex and audits the key", async () => {
    const r = route("codex", CODEX_WORKING);
    expect(await r.call()).toEqual({ ok: true, pressed: true, queued: null, held: 1 });
    expect(r.pressed).toEqual([["Escape"]]);
    expect(r.holds).toEqual(["w1:p1"]);
    expect(r.audits).toEqual([{ action: "agent.interrupt", paneId: "w1:p1", session: "default", device: "phone", detail: { keys: ["Escape"], sent: true } }]);
  });

  test("two Stops at once press Escape once", async () => {
    const r = route("claude", CLAUDE_WORKING);
    const outcomes = await Promise.all([r.call(), r.call()]);
    expect(outcomes.map((outcome) => outcome.ok && outcome.pressed).sort()).toEqual([false, true]);
    expect(r.pressed).toEqual([["Escape"]]);
  });

  test("passes the operator's confirmation through", async () => {
    const r = route("claude", CLAUDE_QUEUED);
    expect(await r.call()).toMatchObject({ ok: false, code: "confirm_required" });
    expect(await r.call(JSON.stringify({ confirm: true }))).toMatchObject({ ok: true, pressed: true, queued: "sends" });
  });

  test("Claude with a custom statusline: the session file decides and the button's source presses", async () => {
    const running: TurnState = { running: true, queued: null, source: "claude-session" };
    const r = route("claude", CLAUDE_IDLE, "working", [running, running, { running: false, source: "claude-session" }]);
    expect(await r.call()).toEqual({ ok: true, pressed: true, queued: null, held: 1, confirmed: true });
    expect(r.pressed).toEqual([["Escape"]]);
  });

  test("an agent without a measured interrupt key gets no Stop", async () => {
    for (const agent of ["pi", "opencode", "shell"]) {
      const r = route(agent, CLAUDE_WORKING);
      expect(await r.call()).toMatchObject({ ok: false, code: "unsupported" });
      expect(r.pressed).toEqual([]);
    }
  });
});
