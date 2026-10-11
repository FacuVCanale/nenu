import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { adapterFor } from "./index";

// Stop presses Escape only while the CLI's own screen says a turn runs (ADR 0065). These are live
// captures: Claude 2.1.296 and Codex 0.160.1 / 0.162.1 in a disposable Herdr session.

const capture = (agent: "claude" | "codex", name: string) =>
  readFileSync(join(import.meta.dirname, agent, "fixtures", `${name}.txt`), "utf8");
const read = (agent: "claude" | "codex", name: string) => adapterFor(agent)!.interrupt!.read(capture(agent, name));

describe("Claude's running turn", () => {
  it.each(["interrupt-working-tool-v2296", "interrupt-working-text-v2296", "hook-holding-v2296"])("%s runs, with nothing queued", (name) => {
    expect(read("claude", name)).toEqual({ running: true, queued: null });
  });

  it("a message in Claude's own queue is sent the moment Escape lands", () => {
    expect(read("claude", "working-queued-v2296")).toEqual({ running: true, queued: "sends" });
  });

  it("a draft in the box hides the hint, so nothing says a turn runs", () => {
    expect(read("claude", "working-draft-typed-v2296").running).toBe(false);
    expect(read("claude", "working-queued-recalled-v2296").running).toBe(false);
  });

  it.each(["interrupt-after-v2296", "interrupt-after-draft-v2296", "interrupt-rewind-v2296", "permission-bash-v2296", "plan-approval-v2296"])(
    "%s runs no turn Escape may stop",
    (name) => {
      expect(read("claude", name).running).toBe(false);
    },
  );
});

describe("Codex's running turn", () => {
  it("runs while the painted Working cue is up", () => {
    expect(read("codex", "interrupt-working-v0162")).toEqual({ running: true, queued: null });
    expect(read("codex", "interrupt-steer-absorbed-v0162")).toEqual({ running: true, queued: null });
    // 0.162.1 names a long command's wait instead of "Working", with the same paint.
    expect(read("codex", "interrupt-waiting-background-v0162")).toEqual({ running: true, queued: null });
  });

  it("a pending steer is sent by Escape; queued follow-ups go back to the composer", () => {
    expect(read("codex", "busy-after-enter-v0160")).toEqual({ running: true, queued: "sends" });
    expect(read("codex", "busy-after-tab-v0160")).toEqual({ running: true, queued: "returns" });
    expect(read("codex", "interrupt-tab-queued-v0162")).toEqual({ running: true, queued: "returns" });
  });

  it.each(["interrupt-after-v0162", "interrupt-after-tab-queued-v0162", "interrupt-rewind-v0162", "approval-exec-v0160"])("%s runs no turn", (name) => {
    expect(read("codex", name).running).toBe(false);
  });
});

it("offers Stop only for the CLIs whose interrupt key was measured", () => {
  expect(adapterFor("claude")?.interrupt?.keys).toEqual(["Escape"]);
  expect(adapterFor("codex")?.interrupt?.keys).toEqual(["Escape"]);
  for (const agent of ["omp", "pi", "grok", "agy", "opencode"]) expect(adapterFor(agent)?.interrupt).toBeUndefined();
});
