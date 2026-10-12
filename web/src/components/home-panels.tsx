import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigation, useRevalidator } from "react-router";
import { AlertCircle, ChevronRight, FolderPlus, Loader2, LockKeyhole, Sparkles, Wifi, WifiOff, Workflow, type LucideIcon } from "lucide-react";

import { AgentBar, StateDot } from "@/components/activity/activity-parts";
import { StatusDot } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BottomSheet } from "@/components/ui/sheet";
import { busyChoiceFor } from "@/hooks/use-message-queue";
import { agentElapsed, allAgents, formatDuration, workflowElapsed, type ActivityWorkflow } from "@/lib/activity";
import { timeAgo, timeAgoShort } from "@/lib/format";
import type { RecentChat } from "@/lib/home-stats";
import { panePath } from "@/lib/nav";
import { PROXY_AUTH_PATH } from "@/lib/sw-routes";
import { STATUS_LABEL, type AgentStatus, type AgentView, type DeliveryMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How long a tap's navigation may run before its row says it is opening, so a fast read never flashes. */
export const OPENING_MS = 120;

/**
 * The path a navigation is loading (no query), once it has run for OPENING_MS; null otherwise. The
 * pane route waits for its read, so over a slow link the tapped row is the only place to say so.
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

/** How many chats Recent lists before "Show all". */
export const RECENT_ROWS = 6;

const STATUS_TEXT: Partial<Record<AgentStatus, string>> = { working: "text-status-working", done: "text-status-done" };

const sr = (text: string) => <span className="sr-only">{text}</span>;

/** Title, then state and place; the place gives up width before the tab, which tells rows apart. */
function RecentRow({ chat, session, now, opening }: { chat: RecentChat; session?: string; now: number; opening: string | null }) {
  const { agent, title, place, tab, at, unseen } = chat;
  const status = STATUS_LABEL[agent.status];
  const to = panePath(agent.paneId, session);
  const busy = isOpening(opening, to);
  return (
    <li>
      <Link to={to} aria-busy={busy || undefined}
        className={cn("grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-2 hover:bg-[var(--workbench-row-hover)] sm:rounded-lg sm:px-3.5",
          busy && "bg-[var(--workbench-row-hover)]")}>
        <StatusDot status={agent.status} className="row-span-2 size-2" />
        <span className="col-start-2 flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-body", unseen && "font-semibold")}>{title}</span>
          {unseen && <>{sr(", ")}<span className="shrink-0 rounded-sm border border-status-done/50 px-1 text-micro text-status-done">New</span></>}
        </span>
        <span className="col-start-2 row-start-2 flex min-w-0 items-baseline gap-1 text-footnote text-muted-foreground">
          {sr(", ")}
          <span className={cn("shrink-0", STATUS_TEXT[agent.status])}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
          <span aria-hidden className="shrink-0">·</span>{sr(", ")}
          <span className={cn("truncate", tab ? "max-w-[45%] shrink" : "min-w-0 flex-1")}>{place}</span>
          {tab && <><span aria-hidden className="shrink-0">·</span>{sr(", ")}<span className="min-w-0 flex-1 truncate">{tab}</span></>}
        </span>
        {busy
          ? <OpeningSpinner className="col-start-3 row-span-2 row-start-1" />
          : at > 0 && <span className="col-start-3 row-span-2 row-start-1 text-footnote text-muted-foreground tabular-nums">
            {sr(", ")}<span aria-hidden>{timeAgoShort(at, now)}</span>{sr(timeAgo(at, now))}
          </span>}
      </Link>
    </li>
  );
}

/**
 * Home's "Recent": the chats that moved or were opened last, each one tap from its thread, with how
 * many agents are working right now. "New" marks one that finished since you last opened it.
 */
export function RecentChats({ chats, working, session, now }: { chats: readonly RecentChat[]; working: number; session?: string; now: number }) {
  const opening = useOpeningPath();
  if (!chats.length) return null;
  return (
    <section aria-labelledby="home-recent" className="flex flex-col gap-1.5">
      <HomeHeading id="home-recent" label="Recent"
        note={working > 0 && <><StatusDot status="working" className="size-1.5" />{working} working now</>} />
      <FoldedList items={chats} rows={RECENT_ROWS}>
        {(chat) => <RecentRow key={chat.agent.paneId} chat={chat} session={session} now={now} opening={opening} />}
      </FoldedList>
    </section>
  );
}

/** A workflow still running, with how far its agents got. */
export function RunningWorkCard({ paneId, workflow, agent, session, now }: { paneId: string; workflow: ActivityWorkflow; agent?: AgentView; session?: string; now: number }) {
  const opening = useOpeningPath();
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
export function BusySendSheet({ open, name, agent, onPick, onCancel }: {
  open: boolean;
  /** Who is working, as a sentence subject ("Hub's coordinator"). */
  name: string;
  agent: string | null | undefined;
  onPick: (mode: DeliveryMode) => void;
  onCancel: () => void;
}) {
  const choice = busyChoiceFor(agent);
  return (
    <BottomSheet open={open} onClose={onCancel} title={`${name} is working`} className="sm:mx-auto sm:my-auto sm:max-w-sm sm:rounded-2xl sm:border sm:pb-4">
      <p className="pb-3 text-footnote text-muted-foreground">When should it read this?</p>
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        <button type="button" className={SHEET_ROW} onClick={() => onPick(choice?.now ?? "asap")}>
          <span className="text-body font-medium">Send now</span>
          {choice && <span className="text-footnote text-pretty text-muted-foreground">{choice.nowHint}</span>}
        </button>
        <button type="button" className={SHEET_ROW} onClick={() => onPick("afterTurn")}>
          <span className="text-body font-medium">Send after this turn</span>
          {choice && <span className="text-footnote text-pretty text-muted-foreground">{choice.laterHint}</span>}
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

/**
 * Home before any snapshot ever arrived: no herd to show, so the page says what is happening. Quiet
 * while the first failures retry, then the host it cannot reach and a Retry; a refusal says so at once.
 */
export function HomeUnreachable({ refused, lost }: { refused: boolean; lost: boolean }) {
  const revalidator = useRevalidator();
  const host = window.location.host;
  if (refused) {
    return (
      <EmptyState icon={LockKeyhole} title="Access refused"
        action={<a href={PROXY_AUTH_PATH} className={buttonVariants({ variant: "secondary" })}>Sign in</a>}>
        Nenu answered and turned this device away. Sign in again to see your herd.
      </EmptyState>
    );
  }
  if (!lost) return <EmptyState icon={Wifi} title="Connecting to Nenu…">Looking for Nenu at {host}.</EmptyState>;
  const retrying = revalidator.state === "loading";
  return (
    <EmptyState icon={WifiOff} title={`Can't reach Nenu at ${host}`}
      action={<Button variant="secondary" onClick={() => void revalidator.revalidate()} aria-busy={retrying || undefined} disabled={retrying}>Retry</Button>}>
      Nenu keeps trying. Check Tailscale on this device.
    </EmptyState>
  );
}
