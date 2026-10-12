import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, LayoutGrid } from "lucide-react";

import { OpeningMark, PaneMark, RowBody } from "@/components/nav-rows";
import { StatusDot } from "@/components/status-badge";
import { displayName } from "@/lib/display-name";
import { panePath, workspacePath } from "@/lib/nav";
import type { Herd } from "@/lib/spaces";
import { cn } from "@/lib/utils";
import { defaultOpen, workspaceTree, type TabBranch, type WorkspaceBranch } from "@/lib/workspace-tree";
import { STATUS_LABEL, type AgentStatus, type AgentView, type ProjectView } from "@/lib/types";

/** Only states worth reading at a glance get a word; a resting pane keeps its hollow dot. */
const STATUS_WORD: Partial<Record<AgentStatus, string>> = { blocked: "needs you", working: "working", done: "done" };
const STATUS_TEXT: Partial<Record<AgentStatus, string>> = { blocked: "text-status-blocked", working: "text-status-working", done: "text-status-done" };

/** The herd as Herdr holds it: each workspace, its tabs, and a tab's panes when it has several. */
export function WorkspaceTree({ source, session, currentPaneId, expanded, onExpand, empty = null, compact = false, startFolded = false }: {
  /** With the projects, so a pane is called what every other view calls it (lib/display-name.ts). */
  source: Herd & { projects?: readonly ProjectView[] };
  session?: string;
  currentPaneId?: string;
  /** Explicit fold per workspace id; an untouched one follows {@link defaultOpen}. */
  expanded: Record<string, boolean>;
  onExpand: (workspaceId: string, open: boolean) => void;
  /** Shown instead when nothing is left to list. */
  empty?: ReactNode;
  /** The sidebar's one-line workspace rows: the name opens the workspace's pane, the chevron folds its panes. */
  compact?: boolean;
  /** An untouched workspace starts folded instead of following {@link defaultOpen}. */
  startFolded?: boolean;
}) {
  const branches = workspaceTree(source, currentPaneId);
  if (branches.length === 0) return empty;
  return branches.map((branch) => (
    <WorkspaceSection key={branch.workspace.workspaceId} branch={branch} href={workspacePath(branch.workspace.workspaceId, source, session)}
      session={session} currentPaneId={currentPaneId} projects={source.projects}
      open={expanded[branch.workspace.workspaceId] ?? (!startFolded && defaultOpen(branch, branches.length))}
      onToggle={(open) => onExpand(branch.workspace.workspaceId, open)} compact={compact} />
  ));
}

function WorkspaceSection({ branch, href, session, currentPaneId, projects, open, onToggle, compact }: {
  branch: WorkspaceBranch;
  projects?: readonly ProjectView[];
  /** Where the workspace's name opens (see workspacePath). */
  href: string;
  session?: string;
  currentPaneId?: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  compact: boolean;
}) {
  const bodyId = useId();
  const { name, counts } = branch;
  const status = workspaceStatus(counts);
  return (
    <section aria-label={name} className={compact ? "nav-ws nav-ws-compact" : "nav-ws"}>
      {compact ? (
        <div className="nav-project">
          <button type="button" className="nav-disclosure" aria-label={`${name} panes`} aria-expanded={open} aria-controls={open ? bodyId : undefined}
            onClick={() => onToggle(!open)}>
            <ChevronRight aria-hidden size={14} />
          </button>
          <Link className="nav-row" to={href} aria-current={branch.current ? "true" : undefined}>
            <OpeningMark to={href}><LayoutGrid aria-hidden size={14} /></OpeningMark>
            <span className="nav-row-text">{name}</span>
            {status && <StatusDot status={status} surface="bg-transparent" className="size-1.5" />}
            {status && <span className="sr-only">, {STATUS_LABEL[status]}</span>}
            <span className="nav-count">{branch.tabs.length} {branch.tabs.length === 1 ? "tab" : "tabs"}</span>
          </Link>
        </div>
      ) : <div className="nav-ws-head">
        <button type="button" className="nav-ws-toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined}
          onClick={() => onToggle(!open)}>
          <ChevronRight aria-hidden size={15} className="nav-ws-chevron" />
          <span className="nav-ws-title">
            <span className="nav-ws-name">{name}</span>
            <span className="nav-ws-meta"><WorkspaceSummary counts={counts} tabs={branch.tabs.length} /></span>
          </span>
        </button>
        <Link className="nav-ws-open" to={href} aria-label={`Open workspace ${name}`}>
          <LayoutGrid aria-hidden size={15} />
        </Link>
      </div>}
      {open && (
        <div id={bodyId} className="nav-ws-body">
          {branch.tabs.map((tab) => <TabRows key={tab.tabId} tab={tab} projects={projects} session={session} currentPaneId={currentPaneId} />)}
          {branch.tabs.length === 0 && <p className="nav-empty">No panes yet</p>}
        </div>
      )}
    </section>
  );
}

/** The one dot a folded workspace shows: its most urgent agent, none for a workspace of shells. */
function workspaceStatus(counts: WorkspaceBranch["counts"]): AgentStatus | undefined {
  if (counts.blocked) return "blocked";
  if (counts.working) return "working";
  if (counts.done) return "done";
  return counts.agents ? "idle" : undefined;
}

/** "3 chats · 2 working · 1 needs you": what is inside, and only the states worth a look. */
function WorkspaceSummary({ counts, tabs }: { counts: WorkspaceBranch["counts"]; tabs: number }) {
  const size = counts.agents ? `${counts.agents} ${counts.agents === 1 ? "chat" : "chats"}` : `${tabs} ${tabs === 1 ? "tab" : "tabs"}`;
  return <>
    {size}
    {counts.blocked > 0 && <> · <span className="text-status-blocked">{counts.blocked} needs you</span></>}
    {counts.working > 0 && <> · <span className="text-status-working">{counts.working} working</span></>}
    {counts.done > 0 && <> · {counts.done} done</>}
  </>;
}

/**
 * A tab's panes, each named after its agent as the chat it opens is. A one-pane tab is that pane's
 * row, the tab named at its end while nothing more urgent sits there; a split tab heads its rows.
 */
function TabRows({ tab, projects, session, currentPaneId }: {
  tab: TabBranch;
  projects?: readonly ProjectView[];
  session?: string;
  currentPaneId?: string;
}) {
  if (tab.panes.length === 1) {
    const pane = tab.panes[0]!;
    const name = displayName(pane, projects);
    return <PaneRow pane={pane} title={name} note={tab.label === name ? undefined : tab.label} session={session}
      current={pane.paneId === currentPaneId} />;
  }
  return (
    <div role="group" aria-label={tab.label}>
      <div className="nav-tab-label"><span className="nav-row-text">{tab.label}</span><span className="nav-count">{tab.panes.length} panes</span></div>
      {tab.panes.map((pane) => (
        <PaneRow key={pane.paneId} nested pane={pane} title={displayName(pane, projects)} session={session}
          current={pane.paneId === currentPaneId} />
      ))}
    </div>
  );
}

function PaneRow({ pane, title, note, session, current, nested }: {
  pane: AgentView;
  title: string;
  /** Said at the end when no state word is. */
  note?: string;
  session?: string;
  current: boolean;
  nested?: boolean;
}) {
  const word = pane.kind === "shell" ? undefined : STATUS_WORD[pane.status];
  const to = panePath(pane.paneId, session);
  return (
    <Link className={cn("nav-pane", nested && "nav-pane-nested")} to={to} aria-current={current ? "page" : undefined}>
      <RowBody mark={<OpeningMark to={to}><PaneMark pane={pane} /></OpeningMark>} title={title} end={<>
        {word ? <span className={cn("nav-pane-status", STATUS_TEXT[pane.status])}>{word}</span>
          : note && <span className="nav-row-note"><span className="sr-only">, </span>{note}</span>}
        {pane.kind !== "shell" && !word && <span className="sr-only">, {STATUS_LABEL[pane.status]}</span>}
      </>} />
    </Link>
  );
}
