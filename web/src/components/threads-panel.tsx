import { useEffect, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleCheck, CircleDashed, CircleX, Eye, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, ChatCircle, ChatCircleText, type IconComponent } from "@/components/ui/icon";

import { ActivityPanel } from "@/components/activity/activity-panel";
import { ProcessDetailView, type ProcessDetail } from "@/components/activity/processes";
import { DiffStat } from "@/components/diff-stat";
import { MergeDialog } from "@/components/merge-dialog";
import { errorMessage } from "@/components/node-start";
import { PR_ACTION_LABEL, prButton, threadAge } from "@/components/project-tasks";
import { Button } from "@/components/ui/button";
import { useActivity, useActivityClock } from "@/hooks/use-activity";
import { askOrgThreadPr, createOrgThreadPr } from "@/lib/api";
import { setStatus } from "@/lib/status";
import type { PrAction, ProjectThreadView, ProjectView } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * What a pull request waits on, what needs you first: the order of the open list. Words come only
 * from what Organizations reported; a PR it has read nothing about is just "Open".
 */
const PR_STATUS = {
  ready: { icon: GitMerge, tone: "text-status-done" },
  approved: { icon: CircleCheck, tone: "text-status-done" },
  review: { icon: Eye, tone: "text-primary" },
  passed: { icon: Check, tone: "text-status-done" },
  changes: { icon: ChatCircleText, tone: "text-status-blocked" },
  failing: { icon: CircleX, tone: "text-status-blocked" },
  running: { icon: CircleDashed, tone: "text-status-working" },
  unopened: { icon: GitBranch, tone: "text-muted-foreground" },
  open: { icon: GitPullRequest, tone: "text-muted-foreground" },
  draft: { icon: GitPullRequestDraft, tone: "text-muted-foreground" },
  merged: { icon: GitMerge, tone: "text-violet-400" },
  closed: { icon: GitPullRequestClosed, tone: "text-muted-foreground" },
  unread: { icon: GitPullRequest, tone: "text-muted-foreground" },
} satisfies Record<string, { icon: IconComponent; tone: string }>;
type PrStatus = keyof typeof PR_STATUS;
const OPEN_ORDER = Object.keys(PR_STATUS) as PrStatus[];

function prStatus(thread: ProjectThreadView): { status: PrStatus; label: string } {
  const pr = thread.pr;
  if (!pr) return { status: "unopened", label: "Branch pushed" };
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
 * Threads with a pull request, or a pushed branch Organizations can open one for, split as the
 * organization is: open PRs of open threads, what needs you first, and a History of the merged, the
 * closed and those of resolved threads, newest first.
 */
export function prLists(threads: readonly ProjectThreadView[]): { open: ProjectThreadView[]; history: ProjectThreadView[] } {
  const withPr = threads.filter((thread) => thread.pr || thread.prAction === "create-pr");
  const current = (thread: ProjectThreadView) => thread.status !== "resolved" && (!thread.pr || thread.pr.state === "open" || thread.pr.state === "draft");
  const rank = (thread: ProjectThreadView) => OPEN_ORDER.indexOf(prStatus(thread).status);
  const updated = (thread: ProjectThreadView) => Date.parse(thread.updated ?? "") || 0;
  return {
    open: withPr.filter(current).sort((a, b) => rank(a) - rank(b)),
    history: withPr.filter((thread) => !current(thread)).sort((a, b) => updated(b) - updated(a)),
  };
}

/** The pull requests of a set of threads, each with the one button Organizations names for it; Merge asks first. */
export function PrList({ project, threads, session, readOnly, onOpenPane, onOpenNode, onChanged, onOpenPr, grouped = false, now = Date.now() }: {
  project: ProjectView;
  threads: readonly ProjectThreadView[];
  session?: string;
  readOnly: boolean;
  onOpenPane: (paneId: string) => void;
  onOpenNode: (id: string) => void;
  onChanged: () => void;
  /** Given, a row opens its pull request (the desk's panel shows the diff) and its thread is a second action. */
  onOpenPr?: (thread: ProjectThreadView) => void;
  /** Split the open ones into Ready to merge and In flight. */
  grouped?: boolean;
  now?: number;
}) {
  const [merging, setMerging] = useState<ProjectThreadView | null>(null);
  const [historyShown, setHistoryShown] = useState(false);
  const { open, history } = prLists(threads);
  if (open.length === 0 && history.length === 0) return <p className="py-3 text-sm text-muted-foreground">No pull requests yet.</p>;
  const openThread = (thread: ProjectThreadView) => thread.paneId ? onOpenPane(thread.paneId) : onOpenNode(thread.id);
  const row = (thread: ProjectThreadView, past: boolean) => {
    const pr = thread.pr;
    const { status, label } = prStatus(thread);
    const { icon: Icon, tone } = PR_STATUS[status];
    const age = threadAge(thread, now);
    // An open PR with a live pane opens its diff from its size, unless the whole row already does.
    const diffPane = past || onOpenPr ? undefined : thread.paneId;
    // A branch without a PR has no diff to open: its row opens the thread.
    const opensPr = onOpenPr && pr;
    const action = !past && !readOnly ? prButton(project, thread) : undefined;
    return (
      <li key={thread.id} className="task-row">
        <button type="button" className="task-main" onClick={() => opensPr ? onOpenPr(thread) : openThread(thread)}>
          <span data-pr-status={status} className="mt-0.5 flex shrink-0"><Icon aria-hidden className={cn("size-3.5", tone)} /></span>
          <span className="min-w-0 flex-1">
            <span data-task-title className={cn("block break-words text-sm font-medium", past && "text-muted-foreground")}>{thread.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{!pr ? "No PR" : pr.number !== undefined ? `PR #${pr.number}` : "PR"} · {label}{!past && thread.autoMerge && " · Auto-merge"}</span>
          </span>
          {pr?.diff ? !diffPane && <DiffStat diff={pr.diff} className="text-xs" /> : age && <span className="shrink-0 text-xs text-muted-foreground">{age}</span>}
        </button>
        {pr?.diff && diffPane && <DiffStat diff={pr.diff} paneId={diffPane} pr={pr.number} session={session} url={pr.url} className="mr-1 mt-[9px] self-start px-1.5 text-xs" />}
        {opensPr && <button type="button" aria-label={`Open thread: ${thread.title}`} title="Open thread" onClick={() => openThread(thread)} className="task-fold">
          <ChatCircle aria-hidden className="size-3.5" />
        </button>}
        {/* Keyed by action: a press's answer never lands on the button of the next state. */}
        {action && <PrActionButton key={action} project={project} thread={thread} action={action} session={session} onMerge={setMerging} onChanged={onChanged} />}
      </li>
    );
  };
  const ready = grouped ? open.filter((thread) => prStatus(thread).status === "ready") : [];
  const section = (name: string, list: ProjectThreadView[]) => list.length > 0 && <section aria-label={name} className="mb-3">
    <h3 className="panel-group-heading">{name}<span className="tabular-nums">{list.length}</span></h3>
    <ul className="task-list">{list.map((thread) => row(thread, false))}</ul>
  </section>;
  return <>
    {open.length === 0 ? <p className="mb-2 px-2 py-1 text-sm text-muted-foreground">No thread has an open pull request.</p>
      : grouped ? <>{section("Ready to merge", ready)}{section("In flight", open.filter((thread) => !ready.includes(thread)))}</>
      : <ul className="task-list mb-2" aria-label="Open pull requests">{open.map((thread) => row(thread, false))}</ul>}
    {history.length > 0 && <>
      <button type="button" className="task-history-toggle" aria-expanded={historyShown} onClick={() => setHistoryShown(!historyShown)}>
        <ChevronRight aria-hidden className="size-3.5" />History · {history.length}
      </button>
      {historyShown && <ul className="task-list task-history mb-2" aria-label="History">{history.map((thread) => row(thread, true))}</ul>}
    </>}
    <MergeDialog project={project} thread={merging} session={session} onMerged={() => { setMerging(null); onChanged(); }} onCancel={() => setMerging(null)} />
  </>;
}

/** How long a press's answer stays on its button before the button is offered again. */
const ANSWER_MS = 3000;

/**
 * A PR's one button. Merge opens its confirmation; the others run at once, and the button says
 * Asking…, then Asked or Already asked for a moment. A refusal is Organizations' own words, under
 * which button of which thread it answers.
 */
function PrActionButton({ project, thread, action, session, onMerge, onChanged }: {
  project: ProjectView;
  thread: ProjectThreadView;
  action: PrAction;
  session?: string;
  onMerge: (thread: ProjectThreadView) => void;
  onChanged: () => void;
}) {
  const label = PR_ACTION_LABEL[action];
  const [answer, setAnswer] = useState<{ text: string; detail?: string } | "busy" | null>(null);
  useEffect(() => {
    if (answer === null || answer === "busy") return;
    const timer = setTimeout(() => setAnswer(null), ANSWER_MS);
    return () => clearTimeout(timer);
  }, [answer]);

  async function press() {
    if (action === "merge") return onMerge(thread);
    setAnswer("busy");
    try {
      if (action === "create-pr") {
        const { created } = await createOrgThreadPr({ project: project.slug, id: thread.id }, session);
        setStatus(`Opened PR #${created.pr.slice(created.pr.lastIndexOf("/") + 1)} for ${thread.title}`, "success");
        setAnswer({ text: "Opened" });
      } else {
        const { asked } = await askOrgThreadPr({ project: project.slug, id: thread.id, action }, session);
        setAnswer(asked.sent ? { text: "Asked" } : { text: "Already asked", detail: asked.reason });
      }
      onChanged();
    } catch (failure) {
      setStatus(errorMessage(failure), "error", undefined, { description: `${label} · ${thread.title}` });
      setAnswer(null);
    }
  }

  // Outline: a list of PRs would otherwise stack ink buttons; Merge's dialog holds the primary.
  return (
    <Button type="button" variant="outline" size="sm" className="mr-1 self-center bg-transparent" aria-label={`${label} ${thread.title}`}
      title={answer !== null && answer !== "busy" ? answer.detail : undefined} disabled={answer !== null} onClick={() => void press()}>
      {answer === null ? label : answer === "busy" ? (action === "create-pr" ? "Opening…" : "Asking…") : answer.text}
    </Button>
  );
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
