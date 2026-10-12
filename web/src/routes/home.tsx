import { useContext, useEffect, useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { ArrowUp, Check, ChevronDown, Loader2 } from "lucide-react";

import { ColumnPage } from "@/components/column-page";
import { Button } from "@/components/ui/button";
import { BusySendSheet, HomeHeading, HomeStarters, HomeUnreachable, RecentChats, RunningWorkCard, SendNotice } from "@/components/home-panels";
import { openNewDialog } from "@/components/new-agent-sheet";
import { NeedsYouList } from "@/components/needs-you-list";
import { lockReasonOf } from "@/components/question-card";
import { ReadyToReviewList, useHomeActivity } from "@/components/ready-to-review-list";
import { looseWorkspaces } from "@/components/workbench-sidebar";
import { useConnectionLost } from "@/hooks/use-connection-lost";
import { busyChoiceFor } from "@/hooks/use-message-queue";
import { useInteractions } from "@/hooks/use-interactions";
import { changeMessageQueue, fetchMessageQueue } from "@/lib/api";
import { isConnecting } from "@/lib/connection";
import { useConnectionHealth } from "@/lib/connection-health";
import { clockTime } from "@/lib/format";
import { greeting, homeHeadline, needsYouItems, recentChats, reviewQueue, runningWorkflows } from "@/lib/home-stats";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { openNewAgent } from "@/lib/spawn";
import { turnRunning } from "@/lib/turn";
import { isReadOnly, type AgentView, type DeliveryMode, type ProjectView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WorkbenchNavigationContext } from "@/lib/workbench-navigation";

/** Why Home cannot vouch for the herd on screen, once that is worth saying. */
type Outage = "nenu" | "herdr" | "refused";
const OUTAGE_TITLE: Record<Outage, string> = { nenu: "Can't reach Nenu", herdr: "Can't reach Herdr", refused: "Access refused" };

// Whether Home has drawn a live herd since the page opened. Until then the shared connection anchor
// (lib/connection-health.ts) only marks when the page loaded, so it cannot date the herd on screen.
let sawLive = false;

// Home answers "what needs me now", top to bottom: one sentence, a composer that reaches a
// coordinator or starts a thread, what needs you (answered in place), the chats that moved last, what
// is ready to review and the workflows still running. Projects and workspaces live in the sidebar
// (Browse on a phone), so Home never repeats them. Figures come from the snapshot, the bridge's
// detected dialogs and the Claude sessions' background work; nothing here is stored history.
//
// When the link fails, a brief failure changes nothing on screen (the quiet retry). A sustained one
// names what is unreachable, Nenu or Herdr, dates the herd it last saw and greys those lists out; a
// refusal says so at once. A first load that never reached Nenu has no herd to show, so the whole
// body says that instead.
export function HomeRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigation = useContext(WorkbenchNavigationContext);
  const now = Date.now();
  const live = !data.error && data.bridge === "connected";
  const readOnly = isReadOnly(data.device);
  const interactions = useInteractions(data.session, live);
  const activity = useHomeActivity(live ? data.agents : [], data.session);
  const lost = useConnectionLost(isConnecting(data));
  const anchor = useConnectionHealth();
  useEffect(() => { if (live) sawLive = true; }, [live]);

  const outage: Outage | null = data.authError ? "refused" : !lost ? null : data.error ? "nenu" : "herdr";
  // `bridge` is only unknown when no snapshot was ever read: there is no herd to grey out.
  if (data.bridge === undefined) {
    return <ColumnPage data={data} title="Home"><HomeUnreachable refused={outage === "refused"} lost={lost} /></ColumnPage>;
  }

  const byPane = new Map(data.agents.map((agent) => [agent.paneId, agent]));
  const needs = needsYouItems(data.agents, interactions.interactions);
  const receipts = interactions.receipts.filter((receipt) => byPane.has(receipt.paneId));
  // A pane Needs you holds (asking, or just answered) stays out of Recent.
  const recent = recentChats(data.agents, data.projects, new Set([...needs, ...receipts].map((item) => item.paneId)));
  // "Nothing needs you" only from a live herd whose dialogs were read; anything older cannot vouch for it.
  const calm = live && interactions.loaded && !interactions.stale && data.agents.length > 0 && !needs.length && !receipts.length;
  const reviews = reviewQueue(data.projects, data.pullRequests);
  const running = runningWorkflows(activity);
  const counts = { needs: needs.length, review: reviews.length, working: data.agents.filter((a) => a.status === "working").length };
  const headline = homeHeadline(counts, data.agents.length);
  // The cached herd carries its own date; Herdr's outage is dated by the last live read, once there was one.
  const syncedAt = data.lastSeenAt ?? (sawLive ? anchor : undefined);
  const title = outage ? OUTAGE_TITLE[outage] : headline.title;
  const detail = outage ? (syncedAt === undefined ? "Showing the last herd Nenu saw" : `Last synced ${clockTime(syncedAt)}`) : headline.detail;

  // On a phone the date sits right under the header, so the first screen holds more of the list.
  return <ColumnPage data={data} title="Home" bodyClassName="max-sm:pt-2">
    <div className="flex flex-col gap-6 lg:gap-7">
      <div className="flex flex-col gap-1">
        <p className="text-footnote text-muted-foreground">
          {new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
          <span className="max-sm:hidden"> · {greeting(now).toLowerCase()}</span>
        </p>
        <h1 className="text-large-title text-balance">{title}</h1>
        {detail && <p className="text-subhead text-muted-foreground tabular-nums">{detail}</p>}
      </div>
      <HomeComposer data={data} projects={data.projects ?? []} disabled={!navigation?.onNewChat} outage={outage} />
      {live && !data.agents.length && <HomeStarters disabled={!navigation?.onNewChat} onFolder={() => openNewAgent({ kind: "workspace" })} onMore={() => openNewDialog()} />}
      {/* The herd as last seen: greyed so nothing reads live, text kept at full contrast. */}
      <div data-stale={outage ? "" : undefined} className={cn("flex flex-col gap-6 lg:gap-7", outage && "text-muted-foreground grayscale")}>
        {calm
          ? <p className="flex items-center gap-2 text-footnote text-muted-foreground"><Check aria-hidden className="size-3.5 text-status-done" />Nothing needs you right now</p>
          : <NeedsYouList agents={data.agents} projects={data.projects} session={data.session} items={needs} receipts={receipts}
            interactions={interactions} lockReason={lockReasonOf({ ...data, readOnly })} />}
        <RecentChats chats={recent} working={outage ? 0 : counts.working} session={data.session} now={now} />
        <ReadyToReviewList entries={reviews} session={data.session} />
        {running.length > 0 && (
          <section aria-labelledby="home-running" className="flex flex-col gap-2.5">
            <HomeHeading id="home-running" label="Running in background" count={running.length} />
            <div className="grid gap-3 sm:grid-cols-2">
              {running.map(({ paneId, workflow }) => <RunningWorkCard key={`${paneId}:${workflow.runId}`} paneId={paneId} workflow={workflow} agent={byPane.get(paneId)} session={data.session} now={now} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  </ColumnPage>;
}

/** Where the composer sends: a project's coordinator, a new thread in a workspace, or a new workspace. */
type Target = { kind: "new" } | { kind: "workspace"; workspaceId: string; label: string } | { kind: "project"; project: ProjectView; coordinator: AgentView };

const TARGET_KEY = "nenu:home-target:v1";
const valueOf = (target: Target) => target.kind === "new" ? "new" : target.kind === "workspace" ? `workspace:${target.workspaceId}` : `project:${target.project.slug}`;

function readTarget(): string | null {
  try {
    return localStorage.getItem(TARGET_KEY);
  } catch {
    return null;
  }
}
function rememberTarget(value: string): void {
  try {
    localStorage.setItem(TARGET_KEY, value);
  } catch {
    /* Private mode or a full quota: the choice just isn't remembered. */
  }
}

/** What became of the last send: a quiet line when it went, a card naming the cause and the way on when it did not. */
type Sent = { tone: "ok"; text: string; paneId: string } | { tone: "error"; title: string; detail: string; paneId: string };

/** A reason from the bridge as a sentence: capitalised and ending in a stop. */
const sentence = (text: string) => {
  const trimmed = text.trim();
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
};

/** A send the bridge refused before anything was queued: the coordinator's queue is not reachable from here. */
class Unavailable extends Error {}

/**
 * Type here and pick where it goes. A project sends to its live coordinator through the shared
 * queue; while the coordinator is mid-turn an action sheet asks, at every send, whether it reads the
 * message now or after this turn, when its CLI has both measured (ADR 0056; the bridge maps each to
 * the CLI's own key). A send that
 * fails keeps the draft and says why, with the coordinator one tap away. A workspace or "New
 * workspace" opens the new-chat sheet with the message filled in, to pick agent and folder.
 */
function HomeComposer({ data, projects, disabled, outage }: { data: HomeData; projects: readonly ProjectView[]; disabled: boolean; outage: Outage | null }) {
  const [message, setMessage] = useState("");
  const [choice, setChoice] = useState<string | null>(readTarget);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  const byPane = new Map(data.agents.map((agent) => [agent.paneId, agent]));
  const targets: Target[] = [
    ...projects.flatMap((project): Target[] => {
      const coordinator = project.coordinator && byPane.get(project.coordinator.paneId);
      return coordinator ? [{ kind: "project", project, coordinator }] : [];
    }),
    { kind: "new" },
    ...looseWorkspaces(data).workspaces.map((workspace): Target => ({ kind: "workspace", workspaceId: workspace.workspaceId, label: workspace.label })),
  ];
  const target = targets.find((candidate) => valueOf(candidate) === choice) ?? targets[0]!;
  const label = target.kind === "project" ? target.project.name : target.kind === "workspace" ? target.label : "New workspace";
  const action = target.kind === "project" ? `reach ${target.project.name}'s coordinator` : "start an agent";
  const busyChoice = target.kind === "project" ? busyChoiceFor(target.coordinator.agent) : null;
  const placeholder = outage === "refused" ? `Sign in again to ${action}` : outage ? `Reconnect to ${action}`
    : target.kind === "project" ? `Ask ${target.project.name}'s coordinator…` : "Describe a task…";

  async function send(mode: DeliveryMode) {
    if (target.kind !== "project") return;
    const text = message.trim();
    const paneId = target.coordinator.paneId;
    const name = `${target.project.name}'s coordinator`;
    setAsking(false);
    setBusy(true);
    setSent(null);
    try {
      const page = await fetchMessageQueue(paneId, data.session);
      if (!page.available) throw new Unavailable();
      const id = crypto.randomUUID();
      const next = await changeMessageQueue(paneId, { scope: page.scope, action: "add", id, text, deliveryMode: mode }, data.session);
      const row = next.available ? next.messages.find((m) => m.id === id) : undefined;
      setMessage("");
      setSent(row?.state === "paused"
        ? { tone: "error", title: `Held for ${name}`, detail: `${sentence(row.error ?? "It could not take the message yet")} It waits in the coordinator's queue.`, paneId }
        : { tone: "ok", text: row ? `Queued for ${name}.` : `Sent to ${name}.`, paneId });
    } catch (err) {
      setSent(err instanceof Unavailable
        ? { tone: "error", title: `${name} can't take messages from Home`, detail: "Your message is still in the box. Open the coordinator to send it from its chat.", paneId }
        : { tone: "error", title: `Couldn't send to ${name}`, detail: `${sentence(err instanceof Error && err.message ? err.message : "Check the connection and try again")} Your message is still in the box.`, paneId });
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const text = message.trim();
    if (target.kind === "new") openNewAgent(text ? { kind: "workspace", message: text } : { kind: "workspace" });
    else if (target.kind === "workspace") openNewAgent({ kind: "tab", workspaceId: target.workspaceId, ...(text ? { message: text } : {}) });
    else if (!text) return;
    // A turn running asks when to read it, if the CLI's two behaviours were measured (ADR 0056);
    // otherwise the row waits for the turn to end, as the queue always did.
    else if (turnRunning(target.coordinator, "")) return busyChoice ? setAsking(true) : void send("afterTurn");
    else return void send("asap");
    setMessage("");
  }

  const locked = disabled || busy;
  return (
    <div className="flex flex-col gap-2">
      <form className="flex flex-col rounded-xl border border-input bg-card focus-within:border-ring/70"
        onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <textarea value={message} rows={1} disabled={locked} placeholder={placeholder} enterKeyHint={target.kind === "project" ? "send" : "go"}
          aria-label={target.kind === "project" ? `Message for ${target.project.name}'s coordinator` : "Task for a new agent"}
          onChange={(event) => { setMessage(event.target.value); setAsking(false); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!locked) submit();
            }
          }}
          className="field-sizing-content max-h-48 min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-body outline-none placeholder:text-muted-foreground disabled:placeholder:text-disabled-foreground" />
        <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
          <label className={cn("relative inline-flex h-9 min-w-0 items-center gap-1 rounded-md bg-muted px-2.5 text-footnote focus-within:ring-2 focus-within:ring-ring coarse:h-11",
            locked && "text-disabled-foreground")}>
            <span className={cn("shrink-0", !locked && "text-muted-foreground")}>{target.kind === "project" ? "To:" : "In:"}</span>
            <span className="max-w-[16rem] truncate font-medium">{label}</span>
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <select aria-label="Send to" value={valueOf(target)} disabled={locked}
              onChange={(event) => { setChoice(event.target.value); rememberTarget(event.target.value); setAsking(false); setSent(null); }}
              className="absolute inset-0 cursor-pointer opacity-0">
              {targets.some((t) => t.kind === "project") && <optgroup label="Project coordinators">
                {targets.filter((t) => t.kind === "project").map((t) => <option key={valueOf(t)} value={valueOf(t)}>{t.project.name}</option>)}
              </optgroup>}
              <option value="new">New workspace</option>
              {targets.some((t) => t.kind === "workspace") && <optgroup label="New thread in">
                {targets.filter((t) => t.kind === "workspace").map((t) => <option key={valueOf(t)} value={valueOf(t)}>{t.label}</option>)}
              </optgroup>}
            </select>
          </label>
          <span className="flex-1" />
          {/* Ink once there is something to send; until then Start still opens the sheet, quietly. */}
          <Button type="submit" size="icon" variant={message.trim() ? "default" : "secondary"} disabled={locked || (target.kind === "project" && !message.trim())}
            aria-label={target.kind === "project" ? "Send" : "Start"} aria-busy={busy || undefined} className="rounded-md">
            {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ArrowUp aria-hidden />}
          </Button>
        </div>
      </form>
      {target.kind === "project" && busyChoice && (
        <BusySendSheet open={asking} name={`${target.project.name}'s coordinator`} choice={busyChoice}
          onPick={(mode) => void send(mode)} onCancel={() => setAsking(false)} />
      )}
      {sent?.tone === "ok" && (
        <p role="status" className="flex items-center gap-2 text-footnote text-muted-foreground">
          <Check aria-hidden className="size-3.5 shrink-0 text-status-done" />
          {sent.text}
          <Link to={panePath(sent.paneId, data.session)} className="inline-flex items-center font-medium text-foreground underline-offset-2 hover:underline coarse:min-h-11">Open</Link>
        </p>
      )}
      {sent?.tone === "error" && <SendNotice title={sent.title} detail={sent.detail} to={panePath(sent.paneId, data.session)} />}
    </div>
  );
}
