import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { agentBusy, turnRunning } from "./turn";

const codexBusy = readFileSync(join(__dirname, "..", "fixtures", "panes", "codex--v0159-busy.txt"), "utf8");

describe("turnRunning", () => {
  it("follows the CLI's own state when the bridge attached one", () => {
    // Herdr says working, but the main turn is over and only background work runs: no Stop.
    expect(turnRunning({ agent: "claude", status: "working", turn: { running: false, background: true, source: "claude-session" } }, "")).toBe(false);
    // Herdr has not caught up yet, the session file already says busy.
    expect(turnRunning({ agent: "claude", status: "idle", turn: { running: true, source: "claude-session" } }, "")).toBe(true);
  });

  it("falls back to Herdr's status and Codex's painted cue", () => {
    expect(turnRunning({ agent: "claude", status: "working" }, "")).toBe(true);
    expect(turnRunning({ agent: "codex", status: "blocked" }, codexBusy)).toBe(true);
    expect(turnRunning({ agent: "codex", status: "blocked", turn: { running: false, source: "codex-rollout" } }, codexBusy)).toBe(false);
    expect(turnRunning(undefined, "")).toBe(false);
  });
});

describe("agentBusy", () => {
  it("stays busy while Herdr reports work, turn or not", () => {
    expect(agentBusy({ agent: "claude", status: "working", turn: { running: false, background: true, source: "claude-session" } }, "")).toBe(true);
    expect(agentBusy({ agent: "codex", status: "idle", turn: { running: true, source: "codex-rollout" } }, "")).toBe(true);
    expect(agentBusy({ agent: "codex", status: "idle", turn: { running: false, source: "codex-rollout" } }, "")).toBe(false);
  });
});
