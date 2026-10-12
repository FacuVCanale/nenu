import { describe, expect, it } from "vitest";

import type { UpdateInfo } from "@/lib/types";
import { MAJOR_COMMAND, RESTART_COMMAND, updateStatus } from "./update-status";

// The precedence is the load-bearing bit, so it's unit-tested pure. A stale interface comes first
// (this device can fix it with one tap), then a stale bridge PROCESS (restarting is cheaper and more
// urgent than upgrading, and an upgrade restarts anyway), then a routine release, then a major — the
// one thing the routine update won't take (ADR 0020).

const RELEASE_URL = "https://github.com/AltanS/collie/releases/tag/v0.10.3";
const MAJOR_URL = "https://github.com/AltanS/collie/releases/tag/v1.0.0";
const someUpdate = (over: Partial<UpdateInfo>): UpdateInfo => ({
  current: "0.9.0",
  latest: "0.10.3",
  latestUrl: RELEASE_URL,
  releaseAvailable: false,
  majorAvailable: null,
  majorUrl: null,
  bridgeStale: false,
  checkedAt: null,
  ...over,
});
const idle = { staleInterface: false, check: "idle" as const };

describe("updateStatus", () => {
  it("says up to date, and offers a check, when nothing is pending", () => {
    expect(updateStatus(someUpdate({}), idle)).toMatchObject({ badge: "Up to date", action: { kind: "check" } });
  });

  it("offers a check, with no badge, when the bridge reports no update info", () => {
    expect(updateStatus(undefined, idle)).toMatchObject({
      badge: null,
      detail: "Check whether a new version is available.",
      action: { kind: "check" },
    });
  });

  it("names the available release and links its notes, which carry the commands", () => {
    const status = updateStatus(someUpdate({ releaseAvailable: true, latest: "0.10.3" }), idle);
    expect(status).toMatchObject({ badge: "0.10.3 available", action: { kind: "notes", href: RELEASE_URL } });
    expect(status.command).toBeUndefined();
  });

  it("names the consent command for a major, and ranks it below a routine release", () => {
    expect(updateStatus(someUpdate({ majorAvailable: "1.0.0", majorUrl: MAJOR_URL }), idle)).toMatchObject({
      badge: "1.0.0 available",
      command: MAJOR_COMMAND,
      action: { kind: "notes", href: MAJOR_URL },
    });
    expect(
      updateStatus(someUpdate({ releaseAvailable: true, latest: "0.32.0", majorAvailable: "1.0.0", majorUrl: MAJOR_URL }), idle),
    ).toMatchObject({ badge: "0.32.0 available", action: { kind: "notes", href: RELEASE_URL } });
  });

  it("puts the bridge restart ahead of a release", () => {
    expect(updateStatus(someUpdate({ bridgeStale: true, releaseAvailable: true }), idle)).toMatchObject({
      badge: "Restart needed",
      command: RESTART_COMMAND,
    });
  });

  it("puts a stale interface ahead of everything, as the one fix this device makes itself", () => {
    expect(updateStatus(someUpdate({ bridgeStale: true, releaseAvailable: true }), { ...idle, staleInterface: true })).toMatchObject({
      badge: "Interface update ready",
      action: { kind: "reload" },
    });
    expect(updateStatus(undefined, { ...idle, staleInterface: true })).toMatchObject({ action: { kind: "reload" } });
  });

  it("never advertises inherited releases for a locally managed installation", () => {
    const local = updateStatus(someUpdate({ releaseChannel: "local", releaseAvailable: true, majorAvailable: "1.0.0" }), idle);
    expect(local).toMatchObject({ badge: null, action: null });
    expect(local.command).toBeUndefined();
    expect(local.detail).toMatch(/managed on your mac/i);
    // A stale process is still this machine's to restart.
    expect(updateStatus(someUpdate({ releaseChannel: "local", bridgeStale: true }), idle).command).toBe(RESTART_COMMAND);
  });

  it("does not call a flagged release with no version 'up to date'", () => {
    expect(updateStatus(someUpdate({ releaseAvailable: true, latest: null }), idle).badge).not.toBe("Up to date");
  });

  it("shows a check in flight and a failed check in the badge", () => {
    expect(updateStatus(someUpdate({}), { ...idle, check: "checking" })).toMatchObject({ badge: "Checking…", action: { kind: "check" } });
    expect(updateStatus(someUpdate({}), { ...idle, check: "failed" })).toMatchObject({
      badge: "Couldn't check",
      tone: "error",
      action: { kind: "check" },
    });
  });

  it("phrases every update instruction as a Herdr plugin action", () => {
    for (const command of [RESTART_COMMAND, MAJOR_COMMAND]) expect(command).toMatch(/^herdr plugin action invoke \S+ --plugin herdr\.collie$/);
  });
});
