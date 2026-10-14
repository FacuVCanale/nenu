import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HerdrClient } from "./herdr-client.ts";
import { StateEngine } from "./state-engine.ts";
import { FakeHerdr } from "./test-support/fake-herdr.ts";

// The socket client and the poll loop against a Herdr double on a real Unix socket, under the two
// conditions a loaded host produces: the bridge's own event loop stops for a while (swap, GC, a long
// synchronous task), and Herdr itself answers slowly. Neither is Herdr being down.

let dir: string;
let fake: FakeHerdr;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Keep this process's event loop from running, as a page-in or a GC pause does. */
function block(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) { /* stalled */ }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nenu-herdr-client-"));
  fake = new FakeHerdr({ socketPath: join(dir, "herdr.sock") })
    .addWorkspace("w1", "demo")
    .addPane({ paneId: "w1:p1", workspaceId: "w1", tabId: "w1:t1", agent: "claude" });
  await fake.start();
});

afterEach(async () => {
  fake.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("HerdrClient timeouts", () => {
  test("a stall of the bridge's own event loop is not counted against Herdr", async () => {
    const client = new HerdrClient(fake.socketPath, 200, "bun");
    const reply = client.sessionSnapshot().then(() => "answered", (err: Error) => err.message);
    // The dial is out but its connect callback has not run: the stall outlasts the whole budget.
    block(700);
    expect(await reply).toBe("answered");
  });

  test("a Herdr that accepts the connection and never answers still times out", async () => {
    const silent = Bun.listen({ unix: join(dir, "silent.sock"), socket: { data() {} } });
    try {
      const client = new HerdrClient(join(dir, "silent.sock"), 200, "bun");
      const started = performance.now();
      await expect(client.sessionSnapshot()).rejects.toThrow("timed out after 200ms");
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      silent.stop(true);
    }
  });
});

describe("StateEngine over a slow or missing Herdr", () => {
  test("a Herdr that answers slowly stays connected", async () => {
    // Every reply takes longer than a one-shot request's budget, but well inside the poll's.
    fake.replyDelayMs = 300;
    const engine = new StateEngine(new HerdrClient(fake.socketPath, 100, "bun"), 50, Date.now, 2000);
    const seen = new Set<string>();
    engine.onUpdate((s) => seen.add(s.bridge));
    engine.start();
    try {
      await sleep(1500);
      expect(engine.current().bridge).toBe("connected");
      expect(engine.current().agents.map((a) => a.paneId)).toEqual(["w1:p1"]);
      expect(seen.has("disconnected")).toBe(false);
    } finally {
      engine.stop();
    }
  });

  test("a Herdr that is gone is reported disconnected", async () => {
    const engine = new StateEngine(new HerdrClient(fake.socketPath, 100, "bun"), 50, Date.now, 2000);
    engine.start();
    try {
      await sleep(200);
      expect(engine.current().bridge).toBe("connected");
      fake.stop(); // the server exits and takes its socket with it
      await sleep(2500);
      expect(engine.current().bridge).toBe("disconnected");
    } finally {
      engine.stop();
    }
  });
});
