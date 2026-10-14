import { useState, type ReactNode } from "react";
import {
  Activity, ArrowLeft, BookText, Check, ChevronRight, CircleCheck, CircleDashed, CircleX, Eye, GitMerge, GitPullRequest,
  GitPullRequestClosed, GitPullRequestDraft, MessageSquare, MessageSquareWarning, type LucideIcon,
} from "lucide-react";

import { ActivityPanel } from "@/components/activity/activity-panel";
import { ProcessDetailView, type ProcessDetail } from "@/components/activity/processes";
import { DiffStat } from "@/components/diff-stat";
import { MergeDialog } from "@/components/merge-dialog";
import { ProjectTasks, canMerge, threadAge } from "@/components/project-tasks";
import { Button } from "@/components/ui/button";
import { useActivity, useActivityClock } from "@/hooks/use-activity";
import type { AgentView, ProjectThreadView, ProjectView } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PanelTab = "threads" | "prs" | "activity" | "memory";

/**
 * What a pull request waits on, what needs you first: the order of the open list. Words come only
 * from what Organizations reported; a PR it has read nothing about is just "Open".
 */
const PR_STATUS = {
  ready: { icon: GitMerge, tone: "text-status-done" },
  approved: { icon: CircleCheck, tone: "text-status-done" },
  review: { icon: Eye, tone: "text-primary" },
  passed: { icon: Check, tone: "text-status-done" },
  changes: { icon: MessageSquareWarning, tone: "text-status-blocked" },
  failing: { icon: CircleX, tone: "text-status-blocked" },
  running: { icon: CircleDashed, tone: "text-status-working" },
  open: { icon: GitPullRequest, tone: "text-muted-foreground" },
  draft: { icon: GitPullRequestDraft, tone: "text-muted-foreground" },
  merged: { icon: GitMerge, tone: "text-violet-400" },
  closed: { icon: GitPullRequestClosed, tone: "text-muted-foreground" },
  unread: { icon: GitPullRequest, tone: "text-muted-foreground" },
} satisfies Record<string, { icon: LucideIcon; tone: string }>;
type PrStatus = keyof typeof PR_STATUS;
const OPEN_ORDER = Object.keys(PR_STATUS) as PrStatus[];

function prStatus(thread: ProjectThreadView): { status: PrStatus; label: string } {
  const pr = thread.pr!;
  if (pr.state === "merged") return { status: "merged", label: "Merged" };
  if (pr.state === "closed") return { status: "closed", label: "Closed" };
  // Organizations stops reading a PR once its thread is resolved, so its state is as of then.
  if (thread.status === "resolved") return { status: "unread", label: `Last seen ${pr.state}` };
  if (pr.state === "draft") return { status: "draft", label: "Draft" };
  const checks = pr.checks;
  const total = checks ? checks.passed + checks.failed + checks.pending : 0;
  if (checks?.failed) return { status: "failing", label: `${checks.failed} ${checks.failed === 1 ? "check" : "checks"} failing` };
  if (pr.review === "changes_requested") return { status: "changes", label: "Changes requested" };
  if (checks?.pending) return { status: "running", label: `Checks running ${checks.passed}/${total}` };
  if (pr.mergeBlocker === null) return { status: "ready", label: "Ready to merge" };
  if (pr.review === "approved") return { status: "approved", label: "Approved" };
  if (pr.review === "review_required") return { status: "review", label: "Needs review" };
  return total ? { status: "passed", label: "Checks passed" } : { status: "open", label: "Open" };
}

/**
 * Threads with a pull request, split as the organization is: open PRs of open threads, what needs
 * you first, and a History of the merged, the closed and those of resolved threads, newest first.
 */
export function prLists(threads: readonly ProjectThreadView[]): { open: ProjectThreadView[]; history: ProjectThreadView[] } {
  const withPr = threads.filter((thread) => thread.pr);
  const current = (thread: ProjectThreadView) => thread.status !== "resolved" && (thread.pr!.state === "open" || thread.pr!.state === "draft");
  const rank = (thread: ProjectThreadView) => OPEN_ORDER.indexOf(prStatus(thread).status);
  const updated = (thread: ProjectThreadView) => Date.parse(thread.updated ?? "") || 0;
  return {
    open: withPr.filter(current).sort((a, b) => rank(a) - rank(b)),
    history: withPr.filter((thread) => !current(thread)).sort((a, b) => updated(b) - updated(a)),
  };
}

/** The pull requests of a set of threads; one Organizations can merge offers Merge, which asks first. */
export function PrList({ project, threads, session, readOnly, onOpenPane, onOpenNode, onChanged, now = Date.now() }: {
  project: ProjectView;
  threads: readonly ProjectThreadView[];
  session?: string;
  readOnly: boolean;
  onOpenPane: (paneId: string) => void;
  onOpenNode: (id: string) => void;
  onChanged: () => void;
  now?: number;
}) {
  const [merging, setMerging] = useState<ProjectThreadView | null>(null);
  const [historyShown, setHistoryShown] = useState(false);
  const { open, history } = prLists(threads);
  if (open.length === 0 && history.length === 0) return <p className="py-3 text-sm text-muted-foreground">No pull requests yet.</p>;
  const row = (thread: ProjectThreadView, past: boolean) => {
    const pr = thread.pr!;
    const { status, label } = prStatus(thread);
    const { icon: Icon, tone } = PR_STATUS[status];
    const age = threadAge(thread, now);
    // An open PR with a live pane opens its diff; a past one keeps its size as text in the row.
    const diffPane = past ? undefined : thread.paneId;
    return (
      <li key={thread.id} className="task-row">
        <button type="button" className="task-main" onClick={() => thread.paneId ? onOpenPane(thread.paneId) : onOpenNode(thread.id)}>
          <span data-pr-status={status} className="mt-0.5 flex shrink-0"><Icon aria-hidden className={cn("size-3.5", tone)} /></span>
          <span className="min-w-0 flex-1">
            <span className={cn("block break-words text-sm font-medium", past && "text-muted-foreground")}>{thread.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{pr.number !== undefined ? `PR #${pr.number}` : "PR"} · {label}</span>
          </span>
          {pr.diff ? !diffPane && <DiffStat diff={pr.diff} className="text-xs" /> : age && <span className="shrink-0 text-xs text-muted-foreground">{age}</span>}
        </button>
        {pr.diff && diffPane && <DiffStat diff={pr.diff} paneId={diffPane} pr={pr.number} session={session} url={pr.url} className="mr-1 mt-[9px] self-start px-1.5 text-xs" />}
        {/* Outline: a list of ready PRs would otherwise stack ink buttons; the dialog's Merge is the primary. */}
        {!past && !readOnly && canMerge(project, thread) && <Button type="button" variant="outline" size="sm" className="mr-1 self-center bg-transparent" aria-label={`Merge ${thread.title}`}
          onClick={() => setMerging(thread)}>Merge</Button>}
      </li>
    );
  };
  return <>
    {open.length > 0
      ? <ul className="task-list mb-2" aria-label="Open pull requests">{open.map((thread) => row(thread, false))}</ul>
      : <p className="mb-2 px-2 py-1 text-sm text-muted-foreground">No thread has an open pull request.</p>}
    {history.length > 0 && <>
      <button type="button" className="task-history-toggle" aria-expanded={historyShown} onClick={() => setHistoryShown(!historyShown)}>
        <ChevronRight aria-hidden className="size-3.5" />History · {history.length}
      </button>
      {historyShown && <ul className="task-list task-history mb-2" aria-label="History">{history.map((thread) => row(thread, true))}</ul>}
    </>}
    <MergeDialog project={project} thread={merging} session={session} onMerged={() => { setMerging(null); onChanged(); }} onCancel={() => setMerging(null)} />
  </>;
}

/**
 * A Claude pane's background work: the Activity list, and a workflow or a command's output opened in
 * its place with Back. Reads only while mounted, so a closed tab costs nothing.
 */
export function PaneActivity({ paneId, session, className }: { paneId: string; session?: string; className?: string }) {
  const activity = useActivity(paneId, session);
  const now = useActivityClock(activity.data);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  if (detail) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <button type="button" onClick={() => setDetail(null)} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 self-start rounded-md px-2 text-sm text-muted-foreground hover:text-foreground lg:min-h-8">
          <ArrowLeft aria-hidden="true" className="size-4" />Back
        </button>
        <ProcessDetailView paneId={paneId} session={session} activity={activity} detail={detail} now={now} onChange={setDetail} />
      </div>
    );
  }
  return (
    <ActivityPanel className={className} data={activity.data} stale={activity.stale} now={now} onRetry={activity.refresh}
      onOpenWorkflow={(runId, agentId) => setDetail({ kind: "workflow", runId, agentId: agentId ?? null })}
      onOpenTask={(taskId) => setDetail({ kind: "task", taskId, title: activity.data?.available ? activity.data.tasks.find((t) => t.id === taskId)?.title ?? "Output" : "Output" })} />
  );
}

const TABS: Array<[PanelTab, string, typeof MessageSquare]> = [
  ["threads", "Threads", MessageSquare],
  ["prs", "PRs", GitPullRequest],
  ["activity", "Activity", Activity],
  ["memory", "Memory", BookText],
];

/**
 * The project's side panel beside a coordinator or thread: its organization, their pull requests,
 * the coordinator session's background activity, and what every thread shares.
 */
export function ThreadsPanel({ project, threads, coordinator, title, subtitle, activityPaneId, panes, session, currentPaneId, readOnly, onOpenPane, onOpenNode, onChanged, action }: {
  project: ProjectView;
  threads: ProjectThreadView[];
  /** The coordinator under the project that runs them; the project's own when omitted. */
  coordinator?: ProjectThreadView;
  title: string;
  subtitle?: ReactNode;
  /** The Claude pane whose activity the Activity tab shows. */
  activityPaneId?: string;
  panes: readonly AgentView[];
  session?: string;
  currentPaneId?: string;
  readOnly: boolean;
  onOpenPane: (paneId: string) => void;
  onOpenNode: (id: string) => void;
  onChanged: () => void;
  action?: ReactNode;
}) {
  const [tab, setTab] = useState<PanelTab>("threads");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" aria-label="Project panel" className="flex min-h-13 shrink-0 items-center gap-1 border-b border-border/60 px-3">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className="panel-tab">
            <Icon aria-hidden className="size-3.5" />{label}
          </button>
        ))}
        <span className="flex-1" />
        {action}
      </div>
      <div role="tabpanel" aria-label={TABS.find(([key]) => key === tab)![1]} className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">
        {tab === "threads" && <ProjectTasks project={project} threads={threads} coordinator={coordinator} title={title} subtitle={subtitle} panes={panes} session={session}
          currentPaneId={currentPaneId} readOnly={readOnly} onOpenPane={onOpenPane} onOpenNode={onOpenNode} onChanged={onChanged} />}
        {tab === "prs" && <PrList project={project} threads={threads} session={session} readOnly={readOnly} onOpenPane={onOpenPane} onOpenNode={onOpenNode} onChanged={onChanged} />}
        {tab === "activity" && (activityPaneId
          ? <PaneActivity paneId={activityPaneId} session={session} />
          : <p className="text-sm text-muted-foreground">The coordinator is not running, so there is no activity to show.</p>)}
        {tab === "memory" && <ProjectMemory project={project} threads={threads} />}
      </div>
    </div>
  );
}

/** What Organizations hands every thread: the project's goal, and where the threads work. */
function ProjectMemory({ project, threads }: { project: ProjectView; threads: readonly ProjectThreadView[] }) {
  const branches = threads.filter((thread) => thread.branch && thread.status !== "resolved");
  return (
    <div className="flex flex-col gap-4 text-sm">
      <section className="rounded-xl border border-border p-3.5">
        <h3 className="text-[13px] font-medium">Shared with every thread</h3>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">{project.goal || "This project has no goal written down yet."}</p>
      </section>
      {branches.length > 0 && <section>
        <h3 className="mb-1.5 text-[13px] font-medium">Branches</h3>
        <ul className="flex flex-col gap-1">
          {branches.map((thread) => <li key={thread.id} className="flex items-baseline gap-2">
            <span className="shrink-0">{thread.title}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{thread.branch}</span>
          </li>)}
        </ul>
      </section>}
    </div>
  );
}
