import { describeAlert, type AlertDetail, type NotifiableStatus } from "./alert-detail.ts";
import { pushActions } from "./interactions.ts";
import type { PushMessage } from "./push.ts";
import type { AgentStatus, AgentView, Interaction } from "./types.ts";

// A notification shouldn't be fire-and-forget. This coordinator gives every blocked/done alert a
// lifecycle and collapses the herd into a single, always-accurate notification:
//
//   • Debounce + cancel — an agent that blocks and unblocks within the window (you handled it at your
//     desk) never reaches your phone. Herdr exposes no "user present" signal (only a `focused` pane,
//     no activity timestamp), so we infer presence: a quickly-resolved transition is an at-desk one.
//   • Coalesce — instead of N stacked notifications, we keep ONE summary of everything currently
//     outstanding: the named agent when exactly one needs you, or "N agents need you" for several.
//     Each change re-renders that single summary; when the last one resolves, we clear it.
//   • Retract — clearing the last outstanding agent (at the PC, or its pane closing) removes the
//     summary. Clearing one of several sends nothing: a phone re-alerts on every replacement, so a
//     shrinking digest buzzed once per handled agent. The next new alert re-renders the herd as it is.
//   • Name — each alert says who it is to the operator (a project's thread or coordinator, else the
//     pane's own label), what started its turn, and the first line of what it answered
//     (alert-detail.ts). A turn a subagent's result started answers to its own switch.
//
// Pure and clock-injected so `bun test` drives it without real timers: the bridge passes
// setTimeout/clearTimeout (see server.ts); tests pass a fake clock they fire on demand.


/** The timer primitive the coordinator schedules against — real setTimeout in the bridge, fake in tests. */
export interface NotifyClock<H> {
  schedule(fn: () => void, delayMs: number): H;
  cancel(handle: H): void;
}

/** The current state of the herd's single notification, derived from everything outstanding. */
export interface HerdSummary {
  /** Headline: "t-0093 Mi Cúcula pedidos finished" for one, or "3 agents need you" for several. */
  title: string;
  /** Sub-line: what it answered and where for one outstanding alert, or who for a digest. */
  body: string;
  /** Deep-link target when exactly one alert is outstanding; undefined for a multi-agent digest. */
  paneId?: string;
  /** Re-alert (buzz) the device — true when a new alert arrived, false on a silent retraction update. */
  renotify: boolean;
}

export interface NotifySink {
  /** Render (or replace) the herd's single notification. */
  render(summary: HerdSummary): void;
  /** Close the herd notification — nothing is outstanding any more. */
  clear(): void;
}

/** Just the transport the sink needs — "deliver this message to the devices". */
export interface PushSender {
  send(msg: PushMessage): unknown;
}
/** Just the quiet-hours check the sink needs — "are we muted right now?". */
export interface MuteGate {
  isMuted(): boolean;
}

/**
 * Build the {@link NotifySink} the coordinator drives. One session's whole herd shares one
 * notification slot (`herdTag`), so a render replaces rather than stacks; an active snooze mutes both
 * render and clear (nothing is shown, so there's nothing to close). `sessionName` (the registry name)
 * is stamped into the push payload so the service worker can deep-link to the right session — omit it
 * (undefined) for the primary, keeping its payload byte-identical to the single-session case. Kept
 * here, decoupled from `Push`/`Snooze`, so the gating + summary→message mapping is unit-testable.
 */
export function makeNotifySink(
  push: PushSender,
  mute: MuteGate,
  herdTag: string,
  sessionName?: string,
): NotifySink {
  return {
    render: (s) => {
      if (mute.isMuted()) return;
      const msg: PushMessage = { title: s.title, body: s.body, tag: herdTag, paneId: s.paneId, renotify: s.renotify };
      if (sessionName !== undefined) msg.session = sessionName;
      void push.send(msg);
    },
    clear: () => {
      if (mute.isMuted()) return;
      void push.send({ type: "clear", tag: herdTag });
    },
  };
}

/** The dialog a push carries: enough for the service worker to answer it without opening Nenu. */
export interface PushInteraction {
  signature: string;
  /** One-tap answers; empty when the dialog must be answered in the app. */
  actions: Array<{ optionIndex: number; title: string }>;
}

/** Longest body the alert shows; a detail that does not fit is never answerable from the notification. */
const ALERT_BODY_MAX = 300;

/**
 * A single-pane alert rewritten around its detected dialog: the question (and the command or file it
 * is about) becomes the body. Answer actions ride along only when the whole detail fits in the body,
 * so a permission is never approved from a notification that cut its command off.
 */
export function interactionAlert(msg: PushMessage, interaction: Interaction): PushMessage {
  const detail = interaction.kind === "permission" ? interaction.context : undefined;
  const body = detail ? `${interaction.question}\n${detail}` : interaction.question;
  const fits = body.length <= ALERT_BODY_MAX;
  return {
    ...msg,
    body: fits ? body : `${body.slice(0, ALERT_BODY_MAX - 1)}…`,
    interaction: { signature: interaction.signature, actions: fits ? pushActions(interaction) : [] },
  };
}

/** Which alerts push: `maybe` before the debounce (by status), `wants` once the alert is described. */
export interface NotifyPolicy {
  maybe(status: AgentStatus): boolean;
  wants(alert: AlertDetail): boolean;
}

/** Who an alert is about; may answer later (it reads the pane's journal). */
export type DescribeAlert = (agent: AgentView, status: NotifiableStatus) => AlertDetail | Promise<AlertDetail>;

/** Late-bound {@link DescribeAlert}: coordinators exist before the server's projects and journals do. */
export class AlertDescriber {
  private impl: ((session: string, agent: AgentView, status: NotifiableStatus) => Promise<AlertDetail>) | null = null;
  use(impl: (session: string, agent: AgentView, status: NotifiableStatus) => Promise<AlertDetail>): void {
    this.impl = impl;
  }
  for(session: string): DescribeAlert {
    return (agent, status) => this.impl?.(session, agent, status) ?? describeAlert(agent, status);
  }
}

/** An alert still in its debounce window (`handle`), or past it and being described (`handle` null). */
interface Pending<H> {
  handle: H | null;
  status: NotifiableStatus;
}

export class NotificationCoordinator<H = unknown> {
  /** paneId → alert that hasn't entered the summary yet. */
  private readonly pending = new Map<string, Pending<H>>();
  /** paneId → alert that has fired and is reflected in the current summary (insertion-ordered). */
  private readonly outstanding = new Map<string, AlertDetail>();
  /** Whether the herd slot shows something a clear would close. */
  private shown = false;

  constructor(
    private readonly clock: NotifyClock<H>,
    private readonly sink: NotifySink,
    private readonly delayMs: number,
    // Read live from the prefs store so a runtime change is honoured. A status no kind would push
    // behaves exactly like a non-notifiable one (idle/working).
    private readonly policy: NotifyPolicy,
    private readonly describe: DescribeAlert = describeAlert,
  ) {}

  /** Wire to `StateEngine.onTransition`. */
  onTransition(agent: AgentView, _from: AgentStatus, to: AgentStatus): void {
    const id = agent.paneId;
    if (!this.policy.maybe(to)) {
      // Resolved to a non-notifiable (or preference-disabled) state: drop a still-pending alert,
      // retract a delivered one.
      this.resolve(id);
      return;
    }
    // (Re)arm the debounce. A blocked→done flip lands here too, so only the latest verb survives.
    this.cancelPending(id);
    const status = to as NotifiableStatus;
    const entry: Pending<H> = { handle: null, status };
    entry.handle = this.clock.schedule(() => {
      entry.handle = null;
      this.admitWhenDescribed(id, entry, this.describe(agent, status), agent);
    }, this.delayMs);
    this.pending.set(id, entry);
  }

  /** Enter the summary once the alert is described, unless it resolved or re-armed meanwhile. */
  private admitWhenDescribed(id: string, entry: Pending<H>, detail: AlertDetail | Promise<AlertDetail>, agent: AgentView): void {
    const admit = (alert: AlertDetail) => {
      if (this.pending.get(id) !== entry) return;
      this.pending.delete(id);
      if (!this.policy.wants(alert)) return;
      this.outstanding.set(id, alert);
      this.emit(true);
    };
    if (detail instanceof Promise) detail.then(admit, () => admit(describeAlert(agent, entry.status)));
    else admit(detail);
  }

  /** Wire to `StateEngine.onRemove` — a vanished pane is implicitly resolved. */
  onRemove(paneId: string): void {
    this.resolve(paneId);
  }

  /**
   * Re-evaluate every pending + outstanding alert against the current prefs after they change,
   * dropping any whose kind is now disabled: cancel a still-debouncing timer, retract a delivered
   * alert. Retractions re-emit the shrunk summary (or a clear) once, silently. Call after the prefs
   * store is updated (see the /api/notifications/prefs route).
   */
  applyPrefs(): void {
    // Drop pending alerts no kind of their status would push — nothing was shown yet. One that may
    // still push is re-checked against `wants` when it is described.
    for (const [id, p] of [...this.pending]) {
      if (!this.policy.maybe(p.status)) this.cancelPending(id);
    }
    // Retract delivered alerts of a now-disabled kind. Only an emptied herd sends anything (a clear).
    for (const [id, a] of [...this.outstanding]) {
      if (!this.policy.wants(a)) this.outstanding.delete(id);
    }
    if (this.outstanding.size === 0) this.sinkClearIfShown();
  }

  /**
   * Tear down this session's notifications: cancel every pending timer and retract everything
   * outstanding, closing the herd slot. Called when a session is disposed (its socket vanished) so
   * its alerts never linger on the lock screen with no live session behind them.
   */
  clearAll(): void {
    for (const id of [...this.pending.keys()]) this.cancelPending(id);
    this.outstanding.clear();
    this.sinkClearIfShown();
  }

  private resolve(id: string): void {
    this.cancelPending(id);
    if (this.outstanding.delete(id) && this.outstanding.size === 0) this.sinkClearIfShown();
  }

  private sinkClearIfShown(): void {
    if (!this.shown) return;
    this.shown = false;
    this.sink.clear();
  }

  /** Render the single herd summary from whatever's outstanding. */
  private emit(renotify: boolean): void {
    this.shown = true;
    this.sink.render(this.summarize(renotify));
  }

  private summarize(renotify: boolean): HerdSummary {
    const entries = [...this.outstanding.entries()];
    if (entries.length === 1) {
      const [paneId, a] = entries[0]!;
      const verb = a.status === "blocked" ? "needs you" : a.background ? "got a subagent's result" : "finished";
      // One outstanding agent → deep-link straight to its pane on tap.
      return {
        title: `${a.name} ${verb}`,
        body: a.summary ? `${a.summary}\n${a.where}` : a.where,
        paneId,
        renotify,
      };
    }
    const alerts = entries.map(([, a]) => a);
    const n = alerts.length;
    const allBlocked = alerts.every((a) => a.status === "blocked");
    const allDone = alerts.every((a) => a.status === "done");
    const title = allBlocked
      ? `${n} agents need you`
      : allDone
        ? `${n} agents finished`
        : `${n} agents need attention`;
    return { title, body: alerts.map((a) => a.name).join(", "), renotify };
  }

  private cancelPending(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.handle !== null) this.clock.cancel(p.handle);
    this.pending.delete(id);
  }
}
