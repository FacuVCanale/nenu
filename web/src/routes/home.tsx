import { useContext, useState } from "react";
import { Link, useRouteLoaderData } from "react-router";
import { ArrowUp, Check, ChevronDown, Loader2 } from "lucide-react";

import { ColumnPage } from "@/components/column-page";
import { Button } from "@/components/ui/button";
import { HomeHeading, RecentChats, RunningWorkCard } from "@/components/home-panels";
import { NeedsYouList } from "@/components/needs-you-list";
import { lockReasonOf } from "@/components/question-card";
import { ReadyToReviewList, useHomeActivity } from "@/components/ready-to-review-list";
import { looseWorkspaces } from "@/components/workbench-sidebar";
import { useInteractions } from "@/hooks/use-interactions";
import { changeMessageQueue, fetchMessageQueue } from "@/lib/api";
import { greeting, homeHeadline, needsYouItems, recentChats, reviewQueue, runningWorkflows } from "@/lib/home-stats";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { panePath } from "@/lib/nav";
import { openNewAgent } from "@/lib/spawn";
import { turnRunning } from "@/lib/turn";
import { isReadOnly, type AgentView, type DeliveryMode, type ProjectView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { WorkbenchNavigationContext } from "@/lib/workbench-navigation";

// Home answers "what needs me now", top to bottom: one sentence, a composer that reaches a
// coordinator or starts a thread, what needs you (answered in place), the chats that moved last, what
// is ready to review and the workflows still running. Projects and workspaces live in the sidebar
// (Browse on a phone), so Home never repeats them. Figures come from the snapshot, the bridge's
// detected dialogs and the Claude sessions' background work; nothing here is stored history.
export function HomeRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const navigation = useContext(WorkbenchNavigationContext);
  const now = Date.now();
  const live = !data.error && data.bridge === "connected";
  const readOnly = isReadOnly(data.device);
  const interactions = useInteractions(data.session, live);
  const activity = useHomeActivity(live ? data.agents : [], data.session);

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
  const notice = data.error ? "Showing your last workspace snapshot. Reconnect to see current activity."
    : data.bridge !== "connected" ? "Waiting for your workspaces to connect."
    : data.agents.length ? null : "Describe a task to start your first agent. You pick the agent and folder next.";

  // On a phone the date sits right under the header, so the first screen holds more of the list.
  return <ColumnPage data={data} title="Home" bodyClassName="max-sm:pt-2">
    <div className="flex flex-col gap-6 lg:gap-7">
      <div className="flex flex-col gap-1">
        <p className="text-footnote text-muted-foreground">
          {new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}
          <span className="max-sm:hidden"> · {greeting(now).toLowerCase()}</span>
        </p>
        <h1 className="text-large-title text-balance">{live ? headline.title : "What should we work on?"}</h1>
        {live && headline.detail && <p className="text-subhead text-muted-foreground tabular-nums">{headline.detail}</p>}
        {notice && <p className="mt-1 text-subhead text-pretty text-muted-foreground">{notice}</p>}
      </div>
      <HomeComposer data={data} projects={data.projects ?? []} disabled={!navigation?.onNewChat} />
      {calm
        ? <p className="flex items-center gap-2 text-[13px] text-muted-foreground"><Check aria-hidden className="size-3.5 text-status-done" />Nothing needs you right now</p>
        : <NeedsYouList agents={data.agents} projects={data.projects} session={data.session} items={needs} receipts={receipts}
          interactions={interactions} lockReason={lockReasonOf({ ...data, readOnly })} />}
      <RecentChats chats={recent} working={counts.working} session={data.session} now={now} />
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

type Sent = { tone: "ok" | "error"; text: string; paneId?: string };

/**
 * Type here and pick where it goes. A project sends to its live coordinator through the shared
 * queue; while the coordinator is mid-turn you choose to steer it now or queue for after the turn
 * (the bridge maps each to the CLI's own key). A workspace or "New workspace" opens the new-chat
 * sheet with the message filled in, to pick agent and folder.
 */
function HomeComposer({ data, projects, disabled }: { data: HomeData; projects: readonly ProjectView[]; disabled: boolean }) {
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
  const placeholder = target.kind === "project" ? `Ask ${target.project.name}'s coordinator…` : "Describe a task…";

  async function send(mode: DeliveryMode) {
    if (target.kind !== "project") return;
    const text = message.trim();
    const paneId = target.coordinator.paneId;
    setAsking(false);
    setBusy(true);
    setSent(null);
    try {
      const page = await fetchMessageQueue(paneId, data.session);
      if (!page.available) throw new Error("This coordinator can't take messages from here. Open it to reply.");
      const id = crypto.randomUUID();
      const next = await changeMessageQueue(paneId, { scope: page.scope, action: "add", id, text, deliveryMode: mode }, data.session);
      const row = next.available ? next.messages.find((m) => m.id === id) : undefined;
      setMessage("");
      setSent(row?.state === "paused"
        ? { tone: "error", text: `Held: ${row.error ?? "the coordinator could not take it yet"}.`, paneId }
        : { tone: "ok", text: row ? `Queued for ${target.project.name}'s coordinator.` : `Sent to ${target.project.name}'s coordinator.`, paneId });
    } catch (err) {
      setSent({ tone: "error", text: err instanceof Error && err.message ? err.message : "Could not send. Try again.", paneId });
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const text = message.trim();
    if (target.kind === "new") openNewAgent(text ? { kind: "workspace", message: text } : { kind: "workspace" });
    else if (target.kind === "workspace") openNewAgent({ kind: "tab", workspaceId: target.workspaceId, ...(text ? { message: text } : {}) });
    else if (!text) return;
    else if (turnRunning(target.coordinator, "")) return setAsking(true);
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
          <label className="relative inline-flex h-9 min-w-0 items-center gap-1 rounded-md bg-muted px-2.5 text-footnote focus-within:ring-2 focus-within:ring-ring coarse:h-11">
            <span className="shrink-0 text-muted-foreground">{target.kind === "project" ? "To:" : "In:"}</span>
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
          <Button type="submit" size="icon" disabled={locked || (target.kind === "project" && !message.trim())} aria-label={target.kind === "project" ? "Send" : "Start"}
            aria-busy={busy || undefined} className="rounded-md">
            {busy ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ArrowUp aria-hidden />}
          </Button>
        </div>
      </form>
      {asking && target.kind === "project" && (
        <div role="group" aria-label="The coordinator is working" className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted-foreground">The coordinator is working.</span>
          <button type="button" onClick={() => void send("asap")} className="inline-flex min-h-9 items-center rounded-lg bg-foreground px-3 font-medium text-background max-sm:min-h-10">Send now</button>
          <button type="button" onClick={() => void send("afterTurn")} className="inline-flex min-h-9 items-center rounded-lg border border-border bg-secondary px-3 font-medium max-sm:min-h-10">Queue for later</button>
          <button type="button" onClick={() => setAsking(false)} className="inline-flex min-h-9 items-center px-2 text-muted-foreground max-sm:min-h-10">Cancel</button>
        </div>
      )}
      {sent && (
        <p role="status" className={cn("flex flex-wrap items-center gap-x-2 text-[13px]", sent.tone === "error" ? "text-destructive" : "text-muted-foreground")}>
          {sent.text}
          {sent.paneId && <Link to={panePath(sent.paneId, data.session)} className="font-medium text-foreground underline-offset-2 hover:underline">Open</Link>}
        </p>
      )}
    </div>
  );
}
