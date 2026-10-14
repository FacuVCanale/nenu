import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigation } from "react-router";
import { AlertCircle, ChevronRight, FolderPlus, Loader2, Sparkles, Workflow, type LucideIcon } from "lucide-react";

import { AgentBar, StateDot } from "@/components/activity/activity-parts";
import { AgentIcon } from "@/components/agent-icon";
import { DiffStat } from "@/components/diff-stat";
import { PaneMark } from "@/components/nav-rows";
import { buttonVariants } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/sheet";
import type { BusyChoice } from "@/hooks/use-message-queue";
import { agentElapsed, allAgents, formatDuration, workflowElapsed, type ActivityWorkflow } from "@/lib/activity";
import { timeAgo, timeAgoShort } from "@/lib/format";
import type { RecentChat, WorkspaceChats } from "@/lib/home-stats";
import { panePath, workspacePath } from "@/lib/nav";
import type { Herd } from "@/lib/spaces";
import { STATUS_LABEL, type AgentStatus, type AgentView, type DeliveryMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How long a tap's navigation may run before its row says it is opening, so a fast read never flashes. */
export const OPENING_MS = 120;

/**
 * The path a navigation is loading (no query), once it has run for OPENING_MS; null otherwise. The
 * pane route waits for its read, so over a slow link the tapped row is the only place to say so.
 * Home reads it once and hands it to every list.
 */
export function useOpeningPath(): string | null {
  const navigation = useNavigation();
  const loading = navigation.state === "loading" ? navigation.location.pathname : null;
  const [late, setLate] = useState<string | null>(null);
  useEffect(() => {
    // Forget a finished load, so tapping the same row again waits its own 120ms.
    if (!loading) return setLate(null);
    const timer = setTimeout(() => setLate(loading), OPENING_MS);
    return () => clearTimeout(timer);
  }, [loading]);
  return loading !== null && late === loading ? loading : null;
}

/** Whether `to` (a path with an optional query) is the one opening. */
export const isOpening = (opening: string | null, to: string) => opening !== null && opening === to.split("?")[0];

/** The 16px spinner an opening row shows in place of its trailing mark (static under reduced motion). */
export function OpeningSpinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none", className)} />;
}

/** A button's label that a spinner covers while its action runs, so the button keeps its width. */
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center">
      <span className={cn(busy && "opacity-0")}>{children}</span>
      {busy && <OpeningSpinner className="absolute text-current" />}
    </span>
  );
}

/**
 * Grows a block into the column and back out instead of landing in one frame and shoving what is
 * below: rows and opacity over 200ms, opacity alone under reduced motion. Closing keeps the last
 * content on screen until it has collapsed. Content present at mount is simply there.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const open = children !== null && children !== undefined && children !== false;
  const [last, setLast] = useState<ReactNode>(children);
  if (open && last !== children) setLast(children);
  return (
    <div aria-hidden={!open || undefined} inert={!open}
      onTransitionEnd={(event) => { if (!open && event.target === event.currentTarget) setLast(null); }}
      className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-opacity motion-reduce:duration-100",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
      <div className="min-h-0 overflow-hidden">{open ? children : last}</div>
    </div>
  );
}

/** A Home section's heading: its name, how many, and an optional note at the far end. */
export function HomeHeading({ id, label, count, note }: { id: string; label: string; count?: number; note?: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2 text-footnote font-medium text-muted-foreground">
      <span className="text-foreground">{label}</span>
      {count !== undefined && count > 0 && <span className="tabular-nums">{count}</span>}
      {note && <span className="ml-auto flex items-center gap-1.5 font-normal">{note}</span>}
    </h2>
  );
}

/** A Home list: its first `rows` items, and the rest behind "Show all". */
export function FoldedList<T>({ items, rows, children }: { items: readonly T[]; rows: number; children: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, rows);
  return <>
    <ul className="flex flex-col max-sm:divide-y max-sm:divide-border">{shown.map(children)}</ul>
    {items.length > shown.length && (
      <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-9 items-center self-start px-1 text-footnote font-medium text-muted-foreground hover:text-foreground coarse:min-h-11 sm:px-3.5">
        Show all {items.length}
      </button>
    )}
  </>;
}

/** How many sessions Recents lists before "Show all". */
export const RECENT_ROWS = 6;

const STATUS_TEXT: Partial<Record<AgentStatus, string>> = { working: "text-status-working", done: "text-status-done" };

const sr = (text: string) => <span className="sr-only">{text}</span>;

/** The state word a row leads its second line with, and its colour. */
function stateOf(chat: RecentChat): { word: string; tone?: string } {
  if (chat.agent.kind === "shell") return { word: "Shell" };
  if (chat.review) return { word: "Ready to review", tone: "text-primary" };
  const status = STATUS_LABEL[chat.agent.status];
  return { word: status.charAt(0).toUpperCase() + status.slice(1), tone: STATUS_TEXT[chat.agent.status] };
}

/**
 * Title, then state, place and what tells it apart (its PR, its role or its tab); the place gives up
 * width first. A desk adds the PR's size and the agent. `group` is the name the row sits under, which
 * it then leaves out.
 */
function SessionRow({ chat, session, now, opening, group }: { chat: RecentChat; session?: string; now: number; opening: string | null; group?: string }) {
  const { agent, title, detail, diff, at, unseen } = chat;
  const place = chat.place === group ? null : chat.place;
  const state = stateOf(chat);
  const to = panePath(agent.paneId, session);
  const busy = isOpening(opening, to);
  return (
    <li>
      <Link to={to} aria-busy={busy || undefined}
        className={cn("relative grid min-h-14 min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-2 hover:bg-[var(--workbench-row-hover)] sm:min-h-12 sm:rounded-lg sm:px-2.5",
          busy && "bg-[var(--workbench-row-hover)]")}>
        <span className="row-span-2 flex justify-center text-muted-foreground"><PaneMark pane={agent} /></span>
        <span className="col-start-2 flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-body sm:text-subhead", unseen && "font-semibold")}>{title}</span>
          {unseen && <>{sr(", ")}<span className="shrink-0 rounded-sm border border-status-done/50 px-1 text-micro text-status-done">New</span></>}
        </span>
        <span className="col-start-2 row-start-2 flex min-w-0 items-baseline gap-1 text-footnote text-muted-foreground">
          {sr(", ")}
          <span className={cn("shrink-0", state.tone)}>{state.word}</span>
          {place && <><span aria-hidden className="shrink-0">·</span>{sr(", ")}<span className={cn("truncate", detail ? "max-w-[45%] shrink" : "min-w-0 flex-1")}>{place}</span></>}
          {detail && <><span aria-hidden className="shrink-0">·</span>{sr(", ")}<span className="min-w-0 flex-1 truncate">{detail}</span></>}
        </span>
        <span className="col-start-3 row-span-2 row-start-1 flex items-center gap-3 text-footnote text-muted-foreground">
          {diff && <>{sr(", ")}<DiffStat diff={diff} className="text-caption max-sm:hidden" /></>}
          {agent.kind !== "shell" && <span aria-hidden className="max-sm:hidden"><AgentIcon agent={agent.agent} className="size-4" /></span>}
          {busy
            ? <OpeningSpinner />
            : at > 0 && <span className="min-w-8 text-right tabular-nums">{sr(", ")}<span aria-hidden>{timeAgoShort(at, now)}</span>{sr(timeAgo(at, now))}</span>}
        </span>
      </Link>
    </li>
  );
}

export type SessionList = "recents" | "workspaces";

const LISTS: ReadonlyArray<[SessionList, string]> = [["recents", "Recents"], ["workspaces", "Workspaces"]];
const LIST_KEY = "nenu:home-list:v1";

function readList(): SessionList {
  try {
    return localStorage.getItem(LIST_KEY) === "workspaces" ? "workspaces" : "recents";
  } catch {
    return "recents";
  }
}
function rememberList(list: SessionList): void {
  try {
    localStorage.setItem(LIST_KEY, list);
  } catch {
    /* Private mode or a full quota: the choice just isn't remembered. */
  }
}

/**
 * Home's one list of sessions under a control that reorders it: Recents, everything that moved last
 * first (what Needs you shows stays out), or Workspaces, every session under its Herdr workspace,
 * whose name opens the pane every way into it opens (ADR 0065). Both read the snapshot Home already
 * has; the choice is remembered on this device.
 */
export function HomeSessions({ recent, workspaces, herd, session, now, opening }: {
  recent: readonly RecentChat[];
  workspaces: readonly WorkspaceChats[];
  herd: Herd;
  session?: string;
  now: number;
  opening: string | null;
}) {
  const [list, setList] = useState<SessionList>(readList);
  if (!recent.length && !workspaces.length) return null;
  const row = (chat: RecentChat, group?: string) => <SessionRow key={chat.agent.paneId} chat={chat} session={session} now={now} opening={opening} group={group} />;
  return (
    <section aria-label="Sessions" className="flex flex-col gap-2">
      <div role="tablist" aria-label="Sessions" className="project-segmented mx-0 grid-cols-2 sm:w-60">
        {LISTS.map(([key, label]) => (
          <button key={key} id={`home-list-${key}`} type="button" role="tab" aria-selected={list === key} aria-controls="home-list"
            onClick={() => { setList(key); rememberList(key); }} className="project-segment">{label}</button>
        ))}
      </div>
      <div id="home-list" role="tabpanel" aria-labelledby={`home-list-${list}`} className="sm:-mx-2.5">
        {list === "recents"
          ? recent.length
            ? <FoldedList items={recent} rows={RECENT_ROWS}>{(chat) => row(chat)}</FoldedList>
            : <p className="px-1 py-3 text-footnote text-muted-foreground sm:px-2.5">Every session is in Needs you.</p>
          : <ul className="flex flex-col">
            {workspaces.map((group) => {
              const to = workspacePath(group.workspaceId, herd, session);
              return (
                <li key={group.workspaceId} className="flex flex-col pt-2 first:pt-0">
                  <h3 className="text-footnote font-medium text-muted-foreground">
                    <Link to={to} aria-busy={isOpening(opening, to) || undefined}
                      className="inline-flex min-h-9 items-center gap-1 px-1 hover:text-foreground coarse:min-h-11 sm:px-2.5">
                      {group.name}<ChevronRight aria-hidden className="size-3.5" />
                    </Link>
                  </h3>
                  <ul className="flex flex-col max-sm:divide-y max-sm:divide-border">{group.chats.map((chat) => row(chat, group.name))}</ul>
                </li>
              );
            })}
          </ul>}
      </div>
    </section>
  );
}

/** A workflow still running, with how far its agents got. */
export function RunningWorkCard({ paneId, workflow, agent, session, now, opening }: {
  paneId: string;
  workflow: ActivityWorkflow;
  agent?: AgentView;
  session?: string;
  now: number;
  opening: string | null;
}) {
  const agents = allAgents(workflow);
  const running = agents.filter((a) => a.state === "running").slice(0, 3);
  const elapsed = formatDuration(workflowElapsed(workflow, now));
  const to = panePath(paneId, session);
  const busy = isOpening(opening, to);
  return (
    <Link to={to} aria-busy={busy || undefined} className={cn("flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent", busy && "bg-accent")}>
      <span className="flex min-w-0 items-center gap-2.5">
        <Workflow aria-hidden className="size-4 shrink-0 text-status-working" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-subhead font-semibold">{workflow.name}</span>
          <span className="truncate text-footnote text-muted-foreground">{[agent?.workspaceLabel, elapsed].filter(Boolean).join(" · ")}</span>
        </span>
        {busy ? <OpeningSpinner /> : <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      </span>
      <AgentBar states={agents.map((a) => a.state)} />
      {running.length > 0 && (
        <span className="flex flex-col gap-1">
          {running.map((a) => (
            <span key={a.id} className="flex items-center gap-2 text-footnote">
              <StateDot state="running" />
              <span className="min-w-0 flex-1 truncate">{a.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{formatDuration(agentElapsed(a, now))}</span>
            </span>
          ))}
        </span>
      )}
      <span className="text-footnote text-muted-foreground tabular-nums">{workflow.doneCount} of {workflow.agentCount} agents done</span>
    </Link>
  );
}

const SHEET_ROW = "flex min-h-14 w-full flex-col items-start justify-center gap-0.5 px-4 py-1.5 text-left transition-colors hover:bg-accent active:bg-muted";

/**
 * The send-time choice for a busy coordinator, as an action sheet: asked at every send and never
 * remembered (ADR 0056). Each row says what the coordinator's CLI does with it, in the composer's words.
 */
export function BusySendSheet({ open, name, choice, onPick, onCancel }: {
  open: boolean;
  /** Who is working, as a sentence subject ("Hub's coordinator"). */
  name: string;
  /** What the coordinator's CLI does with each answer; only a CLI with both measured is asked. */
  choice: BusyChoice;
  onPick: (mode: DeliveryMode) => void;
  onCancel: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={onCancel} title={`${name} is working`} className="sm:mx-auto sm:my-auto sm:max-w-sm sm:rounded-2xl sm:border sm:pb-4">
      <p className="pb-3 text-footnote text-muted-foreground">When should it read this?</p>
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <button type="button" className={SHEET_ROW} onClick={() => onPick(choice.now)}>
          <span className="text-body font-medium">Send now</span>
          <span className="text-footnote text-pretty text-muted-foreground">{choice.nowHint}</span>
        </button>
        <button type="button" className={SHEET_ROW} onClick={() => onPick("afterTurn")}>
          <span className="text-body font-medium">Send after this turn</span>
          <span className="text-footnote text-pretty text-muted-foreground">{choice.laterHint}</span>
        </button>
      </div>
      <button type="button" onClick={onCancel}
        className="mt-2 flex min-h-14 w-full items-center justify-center rounded-xl border border-border bg-card text-body font-medium transition-colors hover:bg-accent active:bg-muted">
        Cancel
      </button>
    </BottomSheet>
  );
}

/** Why a send from Home did not go, and the one way on: the coordinator's own chat. */
export function SendNotice({ title, detail, to }: { title: string; detail: string; to: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-subhead font-medium text-pretty">{title}</p>
          <p className="text-footnote text-pretty text-muted-foreground">{detail}</p>
        </div>
        <Link to={to} className={buttonVariants({ variant: "secondary" })}>Open coordinator</Link>
      </div>
    </div>
  );
}

/** One way to start, as a 64px row: what it starts and the one line that tells it apart. */
function StarterRow({ icon: Icon, title, hint, disabled, onClick }: { icon: LucideIcon; title: string; hint: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent active:bg-muted disabled:pointer-events-none disabled:text-disabled-foreground">
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-medium">{title}</span>
        <span className="text-footnote text-pretty text-muted-foreground">{hint}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

/**
 * An empty herd's first screen: the two ways to start an agent from here, and where else they come
 * from. Each opens the same create surface the composer and the New button do.
 */
export function HomeStarters({ disabled, onFolder, onMore }: { disabled: boolean; onFolder: () => void; onMore: () => void }) {
  return (
    <section aria-label="Get started" className="flex flex-col gap-2">
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <StarterRow icon={FolderPlus} title="Start an agent in a folder" hint="Pick the agent, then the folder." disabled={disabled} onClick={onFolder} />
        <StarterRow icon={Sparkles} title="Start a project or a quick chat" hint="Many threads, or one question." disabled={disabled} onClick={onMore} />
      </div>
      <p className="text-footnote text-muted-foreground">Agents you start in Herdr show up here too.</p>
    </section>
  );
}

