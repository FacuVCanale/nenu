import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_NOTIFY_PREFS, NotifyPrefsStore, coerceNotifyPrefs } from "./notify-prefs.ts";
import { loadConfig } from "./config.ts";

// Notify-type prefs own which agent statuses push. The coercion is pure; the merge + disk round-trip
// is verified through a throwaway temp state dir (mirrors snooze.test.ts / push.test.ts).

const dirs: string[] = [];
async function tempCfg() {
  const stateDir = await mkdtemp(join(tmpdir(), "collie-notify-prefs-"));
  dirs.push(stateDir);
  return { ...loadConfig(), stateDir };
}

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("coerceNotifyPrefs", () => {
  const off = { blocked: true, done: false, threads: false, coordinators: false, subagents: false, updates: true };
  test("fills missing / non-boolean keys from defaults", () => {
    expect(coerceNotifyPrefs(undefined)).toEqual(off);
    expect(coerceNotifyPrefs(null)).toEqual(off);
    expect(coerceNotifyPrefs({})).toEqual(off);
    expect(coerceNotifyPrefs({ blocked: false })).toEqual({ ...off, blocked: false });
    // `updates` is a first-class key: an explicit false sticks, non-booleans fall back to the default.
    expect(coerceNotifyPrefs({ updates: false })).toEqual({ ...off, updates: false });
    expect(coerceNotifyPrefs({ blocked: "yes", done: 1, updates: 0, subagents: "on" })).toEqual(off);
  });

  test("a file from before the split keeps its Finished choice for threads and coordinators, not subagents", () => {
    expect(coerceNotifyPrefs({ done: true })).toEqual({ ...off, done: true, threads: true, coordinators: true });
    expect(coerceNotifyPrefs({ done: true, threads: false })).toEqual({ ...off, done: true, threads: false, coordinators: true });
  });
});

describe("NotifyPrefsStore.wants", () => {
  test("each kind of alert answers to its own switch, and subagent work only to Subagents", async () => {
    const store = new NotifyPrefsStore(await tempCfg());
    await store.set({ done: false, threads: true, coordinators: false, subagents: false });
    const done = { status: "done" as const, background: false, name: "x", where: "y" };
    expect(store.wants({ ...done, kind: "agent" })).toBe(false);
    expect(store.wants({ ...done, kind: "thread" })).toBe(true);
    expect(store.wants({ ...done, kind: "coordinator" })).toBe(false);
    expect(store.wants({ ...done, kind: "thread", background: true })).toBe(false);
    await store.set({ subagents: true });
    expect(store.wants({ ...done, kind: "agent", background: true })).toBe(true);
    expect(store.wants({ ...done, kind: "agent", status: "blocked" })).toBe(true);
  });

  test("a finished turn may notify while any finished kind is on", async () => {
    const store = new NotifyPrefsStore(await tempCfg());
    expect(store.maybe("done")).toBe(false);
    await store.set({ subagents: true });
    expect(store.maybe("done")).toBe(true);
    expect(store.maybe("working")).toBe(false);
  });
});

describe("NotifyPrefsStore", () => {
  test("defaults to blocked-on / done-off when nothing is saved", async () => {
    const store = new NotifyPrefsStore(await tempCfg());
    await store.load();
    expect(store.current()).toEqual(DEFAULT_NOTIFY_PREFS);
  });

  test("set merges a partial patch, persists, and returns the updated prefs", async () => {
    const cfg = await tempCfg();
    const store = new NotifyPrefsStore(cfg);
    const updated = await store.set({ done: true, updates: false });
    expect(updated).toEqual({ blocked: true, done: true, threads: false, coordinators: false, subagents: false, updates: false });

    // Round-trips through disk: a fresh store reloads the same values (survives a restart).
    const reloaded = new NotifyPrefsStore(cfg);
    await reloaded.load();
    expect(reloaded.current()).toEqual({ blocked: true, done: true, threads: false, coordinators: false, subagents: false, updates: false });
  });

  test("current() returns a copy — callers can't mutate the store's state", async () => {
    const store = new NotifyPrefsStore(await tempCfg());
    await store.load();
    const snap = store.current();
    snap.blocked = false;
    expect(store.current()).toEqual(DEFAULT_NOTIFY_PREFS);
  });

  test("persists with owner-only (0600) permissions", async () => {
    const cfg = await tempCfg();
    const store = new NotifyPrefsStore(cfg);
    await store.set({ blocked: false });
    const mode = (await stat(join(cfg.stateDir, "notify-prefs.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("a partial saved file fills the missing key from defaults", async () => {
    const cfg = await tempCfg();
    await writeFile(join(cfg.stateDir, "notify-prefs.json"), JSON.stringify({ blocked: false }));
    const store = new NotifyPrefsStore(cfg);
    await store.load();
    expect(store.current()).toEqual({ blocked: false, done: false, threads: false, coordinators: false, subagents: false, updates: true });
  });

  test("load tolerates a missing file (keeps defaults)", async () => {
    const store = new NotifyPrefsStore(await tempCfg());
    await store.load();
    expect(store.current()).toEqual(DEFAULT_NOTIFY_PREFS);
  });
});
