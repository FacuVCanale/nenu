import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Ellipsis, ExternalLink, FolderTree, GitCompareArrows, GitPullRequest, Layers, PanelRightClose, RefreshCw, SquareTerminal, type IconComponent } from "@/components/ui/icon";

import { ArtifactsPanel } from "@/components/artifacts-panel";
import { useConversationScan } from "@/components/chat-files-browser";
import { DiffBody, useDiffRead } from "@/components/diff-viewer";
import { ciLabel, ciTone } from "@/components/pr-bar";
import { ProjectFilesBrowser } from "@/components/project-files-browser";
import { clampWidth, ICON_BUTTON, PANEL_WIDTH, type InspectorTab, type InspectorView, type SessionInspectorState, type SessionPr, type TerminalSlots } from "@/components/session-inspector";
import { fetchActivity, type ActivityArtifact } from "@/lib/activity";
import { fetchSessionDiff } from "@/lib/api";
import { chatFileReferences } from "@/lib/chat-files";
import { FilePreviewContext } from "@/lib/file-preview-context";
import type { DiffScope } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS: ReadonlyArray<readonly [InspectorTab, string, IconComponent]> = [
  ["changes", "Changes", GitCompareArrows],
  ["files", "Files", FolderTree],
  ["artifacts", "Artifacts", Layers],
  ["terminal", "Terminal", SquareTerminal],
];

/**
 * A session's panel on a desk, right of its chat: Changes, Files, Artifacts and Terminal for that
 * pane, each read only while it is on screen, and the project's own panel behind ⋯ when the pane has one.
 */
export default function SessionPanel({ inspector, paneId, session, artifacts, pr, project }: {
  inspector: SessionInspectorState;
  paneId: string;
  session?: string;
  /** The pane has a conversation whose files can be listed (an agent, not a shell). */
  artifacts: boolean;
  pr?: SessionPr;
  /** The project's panel (Threads, PRs, Activity, Memory), shown in place of the tabs from ⋯. */
  project?: ReactNode;
}) {
  const tabs = artifacts ? TABS : TABS.filter(([key]) => key !== "artifacts");
  const view: InspectorView = inspector.view === "project" ? (project ? "project" : "changes")
    : tabs.some(([key]) => key === inspector.view) ? inspector.view : "changes";
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? inspector.width;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: inspector.width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setDragWidth(clampWidth(drag.current.width + drag.current.x - event.clientX));
  };
  const onPointerUp = () => {
    if (drag.current && dragWidth !== null) inspector.setWidth(dragWidth);
    drag.current = null;
    setDragWidth(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowLeft" ? PANEL_WIDTH.step : event.key === "ArrowRight" ? -PANEL_WIDTH.step : 0;
    if (!delta) return;
    event.preventDefault();
    inspector.setWidth(inspector.width + delta);
  };

  return (
    <aside aria-label="Session panel" className="session-panel" style={{ width }}>
      <div role="separator" aria-orientation="vertical" aria-label="Resize session panel" tabIndex={0}
        aria-valuenow={width} aria-valuemin={PANEL_WIDTH.min} aria-valuemax={PANEL_WIDTH.max}
        className="session-panel-resize" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown} />
      <div className="flex min-h-13 shrink-0 items-center gap-1 border-b border-border/60 px-3">
        <div role="tablist" aria-label="Session" className="flex min-w-0 items-center gap-1">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => inspector.setView(key)} className="panel-tab">
              <Icon aria-hidden className="size-3.5" />{label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {project && <button type="button" aria-label="Project: Threads, PRs, Activity, Memory" title="Project: Threads, PRs, Activity, Memory"
          aria-pressed={view === "project"} onClick={() => inspector.setView(view === "project" ? inspector.tab : "project")} className={ICON_BUTTON}>
          <Ellipsis aria-hidden className="size-4" />
        </button>}
        <button ref={inspector.toggleRef} type="button" aria-label="Hide session panel" title="Hide session panel (⌘⌥B)" onClick={() => inspector.setOpen(false)} className={ICON_BUTTON}>
          <PanelRightClose aria-hidden className="size-4" />
        </button>
      </div>
      {view === "project" ? <div className="flex min-h-0 flex-1 flex-col">{project}</div> : (
        <div role="tabpanel" aria-label={TABS.find(([key]) => key === view)![1]} className={cn("min-h-0 flex-1", view === "terminal" ? "flex flex-col" : "overflow-y-auto")}>
          {view === "terminal" ? <Terminal publish={inspector.setTerminal} />
            : <TabBody key={`${paneId}\0${session ?? ""}`} tab={view} paneId={paneId} session={session} pr={pr} />}
        </div>
      )}
    </aside>
  );
}

/**
 * The Terminal tab is two empty places the chat draws into while the tab is on screen: the pane's
 * mirror, then Keys and Type into terminal (agent-chat.tsx and composer.tsx own all three).
 */
function Terminal({ publish }: { publish: (slots: TerminalSlots | null) => void }) {
  const mirror = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    publish({ mirror: mirror.current!, controls: controls.current! });
    return () => publish(null);
  }, [publish]);
  return <>
    <div ref={mirror} className="min-h-0 flex-1" />
    <div ref={controls} className="shrink-0 border-t border-border/60" />
  </>;
}

/** The body of the tab on screen; the panel remounts it for another pane. */
function TabBody({ tab, paneId, session, pr }: { tab: Exclude<InspectorTab, "terminal">; paneId: string; session?: string; pr?: SessionPr }) {
  const openFile = useContext(FilePreviewContext);
  const open = (path: string) => openFile?.(path);
  if (tab === "changes") return <Changes paneId={paneId} session={session} pr={pr} />;
  if (tab === "files") return <div className="px-3 pb-8 pt-2"><ProjectFilesBrowser paneId={paneId} session={session} onOpen={open} /></div>;
  return <Artifacts paneId={paneId} session={session} onOpen={open} />;
}

const SCOPES: ReadonlyArray<readonly [DiffScope, string]> = [["branch", "Branch"], ["uncommitted", "Uncommitted"]];
const REVIEW: Record<NonNullable<SessionPr["review"]>, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  commented: "Commented",
};

/** The session's pull request when it has one, then its diff: the branch against its base, or what is not committed. */
function Changes({ paneId, session, pr }: { paneId: string; session?: string; pr?: SessionPr }) {
  const [scope, setScope] = useState<DiffScope>("branch");
  const [attempt, setAttempt] = useState(0);
  const read = useDiffRead(`${scope}\0${attempt}`, true, (signal) => fetchSessionDiff(paneId, scope, session, signal));
  return (
    <div className="flex flex-col gap-2 pb-8 pt-3">
      {pr && <PrSummary pr={pr} />}
      <div className="flex items-center gap-2 px-4">
        <div role="radiogroup" aria-label="Diff scope" className="flex shrink-0 rounded-lg bg-muted/50 p-0.5">
          {SCOPES.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={scope === key} onClick={() => setScope(key)}
              className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs", scope === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" aria-label="Read the diff again" title="Read the diff again" onClick={() => setAttempt((n) => n + 1)}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground">
          <RefreshCw aria-hidden className="size-3.5" />
        </button>
      </div>
      <DiffBody read={read} empty={<div className="mx-4 rounded-xl border border-dashed px-5 py-8 text-center">
        <p className="text-sm font-medium">{scope === "branch" ? "Nothing changed on this branch" : "Nothing left to commit"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{scope === "branch" ? "The working tree matches where the branch started." : "Every edit in this folder is committed."}</p>
      </div>} />
    </div>
  );
}

function PrSummary({ pr }: { pr: SessionPr }) {
  const name = pr.number !== undefined ? `#${pr.number}` : "Pull request";
  return (
    <section aria-label={pr.number !== undefined ? `Pull request #${pr.number}` : "Pull request"} className="mx-3 flex flex-col gap-1.5 rounded-xl border border-border p-3 text-[13px]">
      <div className="flex min-w-0 items-center gap-2">
        <GitPullRequest aria-hidden className={cn("size-4 shrink-0", pr.state === "merged" ? "text-violet-400" : "text-status-done")} />
        <span className="shrink-0 font-semibold tabular-nums">{name}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{pr.title}</span>
        {pr.state && pr.state !== "open" && <span className="shrink-0 text-xs text-muted-foreground">{pr.state}</span>}
        {pr.review && <span className="shrink-0 text-xs text-muted-foreground">{REVIEW[pr.review]}</span>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {pr.head && <span className="min-w-0 truncate font-mono">{pr.base ? `${pr.head} → ${pr.base}` : pr.head}</span>}
        <span className="inline-flex items-center gap-1.5 tabular-nums"><span aria-hidden className={cn("size-1.5 rounded-full", ciTone(pr.checks))} />{ciLabel(pr.checks)}</span>
        {pr.diff && <span className="font-mono tabular-nums"><span className="text-status-done">+{pr.diff.additions}</span> <span className="text-status-blocked">−{pr.diff.deletions}</span></span>}
      </div>
      {pr.url && <a href={pr.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 w-fit items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs hover:bg-accent">
        <ExternalLink aria-hidden className="size-3" />Open on GitHub
      </a>}
    </section>
  );
}

/** What the agent handed over in this conversation: the whole history read once, and its claude.ai pages read once. */
function Artifacts({ paneId, session, onOpen }: { paneId: string; session?: string; onOpen: (path: string) => void }) {
  const { scan } = useConversationScan(paneId, session, true);
  const references = useMemo(() => chatFileReferences(scan.entries), [scan.entries]);
  const [published, setPublished] = useState<ActivityArtifact[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    fetchActivity(paneId, session, controller.signal)
      .then((activity) => { if (activity.available) setPublished(activity.artifacts); })
      .catch(() => {});
    return () => controller.abort();
  }, [paneId, session]);
  return (
    <div className="px-2 pb-8 pt-3">
      {scan.loading && <p role="status" className="mb-2 px-2 text-xs text-muted-foreground">Reading the conversation…</p>}
      <ArtifactsPanel paneId={paneId} session={session} references={references} published={published} ready={!scan.loading} onOpen={onOpen} />
    </div>
  );
}
