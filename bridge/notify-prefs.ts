import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { AlertDetail } from "./alert-detail.ts";
import type { AgentStatus } from "./types.ts";

// Which agent lifecycle events are worth a push. A companion to Snooze (the do-not-disturb deadline):
// where Snooze mutes everything for a while, this decides which *kinds* of alert ever fire. By default
// only "agent needs your input" (blocked) pushes; every "finished" kind is off — most people don't
// want a buzz for every completed task, least of all for each subagent result. Bridge-wide (not per-device), like Snooze, because a push fans out to
// every subscribed device. Persisted to the state dir so a preference survives the `systemctl restart`
// that backend changes require. Missing file / missing keys fall back to defaults.

/** Notification type preferences: which kinds of alert actually push. */
export interface NotifyPrefs {
  /** Push when any agent becomes blocked (waiting on your input). Default on. */
  blocked: boolean;
  /** Push when a loose agent (no project's thread or coordinator) finishes a turn you started. Default off. */
  done: boolean;
  /** Push when one of a project's threads finishes a turn. Default off; a file from before the split
   *  keeps its `done` choice. */
  threads: boolean;
  /** Push when a project's coordinator finishes a turn. Same default as `threads`. */
  coordinators: boolean;
  /** Push when a turn a subagent's or background task's result started finishes. Default off: one
   *  delegation wakes its parent once per result, which is the noise this switch exists to silence. */
  subagents: boolean;
  /** Push when a newer Nenu release is available. Default on — the off-switch for update alerts,
   *  which otherwise bypass snooze (an update isn't quiet-hours material). Not an agent alert, so it
   *  never flows through {@link NotifyPrefsStore.wants}; the update monitor reads it directly. */
  updates: boolean;
}

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { blocked: true, done: false, threads: false, coordinators: false, subagents: false, updates: true };

export const NOTIFY_PREF_KEYS = ["blocked", "done", "threads", "coordinators", "subagents", "updates"] as const;

/**
 * Coerce an untrusted parsed value into a {@link NotifyPrefs}, filling any missing or non-boolean key
 * from the defaults. Before the split one `done` switch covered threads and coordinators too, so a
 * file that set it and predates their keys keeps that choice for them. Pure + exported so the
 * file-shape handling is unit-testable.
 */
export function coerceNotifyPrefs(raw: unknown): NotifyPrefs {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const inherited = typeof o.done === "boolean" ? o.done : undefined;
  const pick = (key: (typeof NOTIFY_PREF_KEYS)[number], fallback = DEFAULT_NOTIFY_PREFS[key]) => (typeof o[key] === "boolean" ? (o[key] as boolean) : fallback);
  return {
    blocked: pick("blocked"),
    done: pick("done"),
    threads: pick("threads", inherited ?? DEFAULT_NOTIFY_PREFS.threads),
    coordinators: pick("coordinators", inherited ?? DEFAULT_NOTIFY_PREFS.coordinators),
    subagents: pick("subagents"),
    updates: pick("updates"),
  };
}

export class NotifyPrefsStore {
  private prefs: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS };
  private readonly file: string;

  constructor(private readonly cfg: Config) {
    this.file = join(cfg.stateDir, "notify-prefs.json");
  }

  async load(): Promise<void> {
    try {
      this.prefs = coerceNotifyPrefs(await Bun.file(this.file).json());
    } catch {
      /* none saved yet — keep defaults */
    }
  }

  /** A copy of the current prefs (never the internal object, so callers can't mutate our state). */
  current(): NotifyPrefs {
    return { ...this.prefs };
  }

  /** Whether a transition into `status` could notify at all: the coordinator debounces only these. */
  maybe(status: AgentStatus): boolean {
    if (status === "blocked") return this.prefs.blocked;
    if (status === "done") return this.prefs.done || this.prefs.threads || this.prefs.coordinators || this.prefs.subagents;
    return false;
  }

  /** Whether this alert, once the bridge knows who it is and what started its turn, should push. */
  wants(alert: Pick<AlertDetail, "status" | "kind" | "background">): boolean {
    if (alert.status === "blocked") return this.prefs.blocked;
    if (alert.background) return this.prefs.subagents;
    return alert.kind === "thread" ? this.prefs.threads : alert.kind === "coordinator" ? this.prefs.coordinators : this.prefs.done;
  }

  /** Merge a partial patch (only booleans are applied), persist, and return the updated prefs. */
  async set(patch: Partial<NotifyPrefs>): Promise<NotifyPrefs> {
    for (const key of NOTIFY_PREF_KEYS) if (typeof patch[key] === "boolean") this.prefs[key] = patch[key];
    await this.save();
    return this.current();
  }

  /** Atomic, owner-only write: fresh temp file (mode 0600) then rename over the target. */
  private async save(): Promise<void> {
    await mkdir(this.cfg.stateDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.prefs, null, 2), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}
