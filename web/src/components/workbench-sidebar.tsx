import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Bot, ChevronRight, House, Inbox, Plus, Search, Settings, Terminal } from "lucide-react";

import { NodeDot } from "@/components/node-row";
import { SessionSwitcher } from "@/components/session-switcher";
import { StatusDot } from "@/components/status-badge";
import { Highlight, PaneMark, PlaceText, RowBody } from "@/components/nav-rows";
import { WorkspaceTree } from "@/components/workspace-tree";
import { cn } from "@/lib/utils";
import { isAttention } from "@/lib/triage";
import { workspaceTree } from "@/lib/workspace-tree";
import { displayName, displayPlace } from "@/lib/display-name";
import { navSearch, type SearchGroup, type SearchHit } from "@/lib/nav-search";
import { useSidebarPrefs } from "@/hooks/use-sidebar-prefs";
import { drawerSections, type DrawerChat } from "@/lib/nav-drawer";
import { timeAgoShort } from "@/lib/format";
import type { HomeData } from "@/lib/loaders";
import { homePath, nodePath, panePath, projectPath, settingsPath } from "@/lib/nav";
import { STATE_LABEL, historyCount, holds, orgTree, type NodeState, type OrgNode } from "@/lib/org-tree";
import { chatRecency, isOpenThread, projectForPane } from "@/lib/projects";
import { STATUS_LABEL, type AgentView, type ProjectView, type WorkspaceView } from "@/lib/types";

/** What the sidebar lists: the whole tree, or only what is waiting on the operator. */
export type SidebarMode = "browse" | "needs-you";
export interface SidebarRequest {
  target: "search" | "needs-you";
  seq: number;
}

/**
 * Where the navigation is drawn. The desk's sidebar leads with New, Search, Needs you and Home. A
 * phone's sheet (the tab bar's) and drawer (a chat's Nenu mark) leave those to the bar or the drawer's
 * header and start every project and workspace folded; the drawer, which has no Home behind it, also
 * leads with what needs you and the chats that moved last.
 */
export type SidebarVariant = "sidebar" | "sheet" | "drawer";

/**
 * The workbench navigation: its variant's lead, then projects (coordinators and their threads) and
 * the workspaces no project holds, and the host it all runs on.
 */
export function WorkbenchSidebar({ data, onNavigate, onNewChat, request, variant = "sidebar" }: {
  data: HomeData;
  variant?: SidebarVariant;
  onNavigate?: () => void;
  onNewChat?: () => void;
  /** Each new `seq` opens search or the Needs you list (⌘K, the rail, the tab bar). */
  request?: SidebarRequest;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(0);
  const [mode, setMode] = useState<SidebarMode>("browse");
  const searchBox = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Where the tree was scrolled, so leaving the Needs you filter lands back on the same rows.
  const treeScroll = useRef(0);
  const listId = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const attention = needsYou(data);
  const phone = variant !== "sidebar";
  const results = searching ? navSearch(data, query) : [];
  const hits = results.flatMap((group) => group.hits);
  const selected = Math.min(picked, hits.length - 1);

  const target = request?.target;
  useEffect(() => {
    if (!target) return;
    if (target === "needs-you") {
      setMode("needs-you");
      return;
    }
    setMode("browse");
    setSearching(true);
    searchBox.current?.focus();
    searchBox.current?.select();
  }, [target, request?.seq]);

  const browsing = mode === "browse" && !query.trim();
  useLayoutEffect(() => {
    if (browsing && scroller.current) scroller.current.scrollTop = treeScroll.current;
  }, [browsing]);

  function closeSearch() {
    setQuery("");
    setSearching(false);
  }

  /** Enter opens the picked result, the first one until an arrow moves the pick. */
  function openPicked() {
    const hit = hits[selected];
    if (!hit) return;
    navigate(hitPath(hit, data.session));
    closeSearch();
    onNavigate?.();
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.stopPropagation(); closeSearch(); }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) openPicked();
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && hits.length > 0) {
      event.preventDefault();
      setPicked(Math.max(0, Math.min(hits.length - 1, selected + (event.key === "ArrowDown" ? 1 : -1))));
    }
  }

  return (
    <nav className="workbench-navigation" aria-label="Projects and chats" data-variant={variant}>
      {(!phone || searching) && <div className="nav-top">
        {!phone && <button type="button" className="nav-row" onClick={onNewChat} disabled={!onNewChat} aria-keyshortcuts="Meta+N">
          <Plus aria-hidden size={16} /><span className="nav-row-text">New</span><kbd className="nav-kbd" aria-hidden>⌘N</kbd>
        </button>}
        {searching ? (
          <label className="nav-row nav-search">
            <Search aria-hidden size={16} />
            <input ref={searchBox} type="search" autoFocus value={query} placeholder="Search" aria-label="Search projects and chats"
              aria-controls={hits.length ? listId : undefined} aria-autocomplete="list"
              aria-activedescendant={hits.length ? optionId(listId, selected) : undefined}
              onChange={(event) => { setQuery(event.target.value); setPicked(0); }}
              onBlur={() => { if (!query.trim()) closeSearch(); }}
              onKeyDown={onSearchKey} />
          </label>
        ) : !phone && (
          <button type="button" className="nav-row" onClick={() => { setMode("browse"); setSearching(true); }} aria-keyshortcuts="Meta+K">
            <Search aria-hidden size={16} /><span className="nav-row-text">Search</span><kbd className="nav-kbd" aria-hidden>⌘K</kbd>
          </button>
        )}
        {!phone && <button type="button" className="nav-row" aria-pressed={mode === "needs-you"} aria-label={attention.length ? `Needs you, ${attention.length}` : "Needs you"} onClick={() => setMode(mode === "needs-you" ? "browse" : "needs-you")}>
          <Inbox aria-hidden size={16} /><span className="nav-row-text">Needs you</span>
          {attention.length > 0 && <span className="nav-badge" aria-hidden>{attention.length}</span>}
        </button>}
        {!phone && <Link className="nav-row" to={homePath(data.session)} onClick={onNavigate} aria-current={pathname === "/" ? "page" : undefined}>
          <House aria-hidden size={16} />Home
        </Link>}
      </div>}

      <div ref={scroller} className="nav-scroll" onScroll={(event) => { if (browsing) treeScroll.current = event.currentTarget.scrollTop; }}>
        {query.trim()
          ? <SearchResults groups={results} query={query} listId={listId} selected={selected} session={data.session} onPick={setPicked}
              onNavigate={() => { closeSearch(); onNavigate?.(); }} />
          : mode === "needs-you"
          ? <NeedsYouList data={data} panes={attention} labelled={!phone} onNavigate={onNavigate} />
          : <>
            {variant === "drawer" && <DrawerSections data={data} onNavigate={onNavigate} />}
            <SidebarTree data={data} onNavigate={onNavigate} folded={phone} />
          </>}
      </div>

      {/* The host belongs to browsing; a phone's Needs you or Search sheet keeps to its list. */}
      {(!phone || (mode === "browse" && !searching)) && <div className="nav-footer">
        <SessionSwitcher sessions={data.sessions ?? []} current={data.session} />
        <HostRow data={data} onNavigate={onNavigate} />
      </div>}
    </nav>
  );
}

const optionId = (listId: string, index: number) => `${listId}-${index}`;

/** Where a search result opens: a project's page, a node's chat (or its detail when it runs nowhere), a pane's chat. */
function hitPath(hit: SearchHit, session?: string): string {
  if (hit.kind === "project") return projectPath(hit.project.slug, session);
  if (hit.kind === "node") return hit.thread.paneId ? panePath(hit.thread.paneId, session) : nodePath(hit.project.slug, hit.thread.id, session);
  return panePath(hit.pane.paneId, session);
}

/** The search's matches as one list: Projects, then Chats, each row named as everywhere else with the match in semibold. */
function SearchResults({ groups, query, listId, selected, session, onPick, onNavigate }: {
  groups: SearchGroup[];
  query: string;
  listId: string;
  selected: number;
  session?: string;
  onPick: (index: number) => void;
  onNavigate: () => void;
}) {
  useEffect(() => {
    document.getElementById(optionId(listId, selected))?.scrollIntoView?.({ block: "nearest" });
  }, [listId, selected]);
  if (groups.length === 0) return <p className="nav-empty">No matches for “{query.trim()}”</p>;
  let index = 0;
  return (
    <div role="listbox" id={listId} aria-label="Search results" className="nav-results">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="nav-group">
          <div className="nav-label" aria-hidden>
            {group.label}{group.more > 0 && <span className="nav-label-end">{group.hits.length} of {group.hits.length + group.more}</span>}
          </div>
          {group.hits.map((hit) => {
            const at = index++;
            return (
              <Link key={hit.key} id={optionId(listId, at)} role="option" aria-selected={at === selected} className="nav-pane nav-result"
                to={hitPath(hit, session)} onClick={onNavigate} onMouseMove={() => { if (at !== selected) onPick(at); }}>
                <RowBody mark={<HitMark hit={hit} />} title={<Highlight text={hit.title} query={query} />}
                  detail={<PlaceText place={hit.place} query={query} />} end={<span className="sr-only">, {hitState(hit)}</span>} />
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function HitMark({ hit }: { hit: SearchHit }) {
  if (hit.kind === "project") return <span className="nav-avatar" aria-hidden>{hit.project.name.trim().charAt(0).toUpperCase() || "P"}</span>;
  if (hit.kind === "node") return <NodeDot state={hit.state} />;
  return <PaneMark pane={hit.pane} />;
}

function hitState(hit: SearchHit): string {
  if (hit.kind === "project") return "project";
  if (hit.kind === "node") return STATE_LABEL[hit.state].toLowerCase();
  return hit.pane.kind === "shell" ? "shell" : STATUS_LABEL[hit.pane.status];
}

/** Agent panes waiting on the operator, the same set the Home headline and the rail's dot count. */
export function needsYou(data: Pick<HomeData, "agents">): AgentView[] {
  return data.agents.filter((pane) => isAttention(pane.status));
}

/** `labelled` is the sidebar's: a phone's Needs you sheet already carries the name as its title. */
function NeedsYouList({ data, panes, labelled, onNavigate }: { data: HomeData; panes: AgentView[]; labelled: boolean; onNavigate?: () => void }) {
  const { paneId } = useParams();
  if (panes.length === 0) return <p className="nav-empty">Nothing needs you right now.</p>;
  const now = Date.now();
  return (
    <section aria-label="Needs you">
      {labelled && <h3 className="nav-label">Needs you</h3>}
      {panes.map((pane) => <ChatRow key={pane.paneId} pane={pane} projects={data.projects} current={pane.paneId === paneId} now={now}
        session={data.session} onNavigate={onNavigate} />)}
    </section>
  );
}

/** What the drawer leads with: the chats waiting on you, then the ones that moved last. */
function DrawerSections({ data, onNavigate }: { data: HomeData; onNavigate?: () => void }) {
  const { paneId } = useParams();
  const { needsYou: needs, recent } = drawerSections(data, paneId);
  const now = Date.now();
  const row = (chat: DrawerChat) => <ChatRow key={chat.pane.paneId} pane={chat.pane} projects={data.projects} current={chat.current} now={now}
    session={data.session} onNavigate={onNavigate} />;
  return <>
    {needs.length > 0 && (
      <section aria-label="Needs you" className="nav-group">
        <h3 className="nav-label">Needs you <span className="nav-count">{needs.length}</span></h3>
        {needs.map(row)}
      </section>
    )}
    {recent.length > 0 && (
      <section aria-label="Recent" className="nav-group">
        <h3 className="nav-label">Recent</h3>
        {recent.map(row)}
      </section>
    )}
  </>;
}

/** A chat: its state, its one name, where it lives and how long ago it last moved. */
function ChatRow({ pane, projects, current, now, session, onNavigate }: {
  pane: AgentView;
  projects?: readonly ProjectView[];
  current: boolean;
  now: number;
  session?: string;
  onNavigate?: () => void;
}) {
  const at = chatRecency(pane);
  return (
    <Link className="nav-pane nav-chat" to={panePath(pane.paneId, session)} onClick={onNavigate} aria-current={current ? "page" : undefined}>
      <RowBody mark={<PaneMark pane={pane} />} title={displayName(pane, projects)} detail={<PlaceText place={displayPlace(pane, projects)} />} end={<>
        {pane.kind !== "shell" && <span className="sr-only">, {STATUS_LABEL[pane.status]}</span>}
        {at > 0 && <span className="nav-chat-time">{timeAgoShort(at, now)}</span>}
      </>} />
    </Link>
  );
}

/**
 * Projects first, then the workspaces no project holds a pane in. `folded` is the phone's: every
 * project and workspace starts closed, and what the operator opens there lasts while the sheet does,
 * so the next open is compact again and the desk's remembered folds stay the desk's.
 */
function SidebarTree({ data, onNavigate, folded = false }: { data: HomeData; onNavigate?: () => void; folded?: boolean }) {
  const { paneId, projectSlug } = useParams();
  const { prefs, setExpanded, setWorkspaceOpen } = useSidebarPrefs({ persist: !folded });
  const projects = data.projects ?? [];
  const loose = { ...data, ...looseWorkspaces(data) };
  const currentProject = projectSlug ?? projectForPane(data.projects, paneId)?.project.slug;
  useRevealProject(folded ? undefined : currentProject, setExpanded);
  const hasWorkspaces = workspaceTree(loose, paneId).length > 0;

  return <>
    {projects.length > 0 && (
      <section aria-label="Projects" className="nav-group">
        <h3 className="nav-label">Projects</h3>
        {projects.map((project) => (
          <ProjectSection key={project.slug} project={project} data={data} open={prefs.expanded[project.slug] ?? !folded}
            expanded={prefs.expanded} onExpand={setExpanded} onNavigate={onNavigate} panes={projectPanes(data, project)} />
        ))}
      </section>
    )}
    {hasWorkspaces && (
      <section aria-label="Workspaces" className="nav-group">
        <h3 className="nav-label">Workspaces</h3>
        <WorkspaceTree compact source={loose} session={data.session} currentPaneId={paneId}
          expanded={prefs.workspaces} onExpand={setWorkspaceOpen} onNavigate={onNavigate} startFolded={folded} />
      </section>
    )}
    {projects.length === 0 && !hasWorkspaces && <Empty />}
  </>;
}

/**
 * Workspaces no project holds a live pane in; all of them when there are no projects. A project's
 * panes are listed under the project, so the workspace tree leaves them out, and a workspace left
 * with only those (a bridge that did not report `workspaceIds`) is not loose either.
 */
export function looseWorkspaces(data: Pick<HomeData, "workspaces" | "projects" | "agents" | "shellPanes">): { workspaces: WorkspaceView[]; agents: AgentView[]; shellPanes: AgentView[] } {
  const held = new Set((data.projects ?? []).flatMap((project) => project.workspaceIds ?? []));
  const free = (pane: AgentView) => !projectForPane(data.projects, pane.paneId);
  const agents = data.agents.filter(free);
  const shellPanes = data.shellPanes.filter(free);
  const panes = [...data.agents, ...data.shellPanes];
  const workspaces = data.workspaces.filter((workspace) => {
    if (held.has(workspace.workspaceId)) return false;
    const inside = panes.filter((pane) => pane.workspaceId === workspace.workspaceId);
    return inside.length === 0 || inside.some(free);
  });
  return { workspaces, agents, shellPanes };
}

/** Arriving in a project reveals it once; collapsing it again afterwards is the operator's call. */
function useRevealProject(currentProject: string | undefined, setExpanded: (slug: string, open: boolean) => void) {
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!currentProject || revealed.current === currentProject) return;
    revealed.current = currentProject;
    setExpanded(currentProject, true);
  }, [currentProject, setExpanded]);
}

/** The host Nenu reaches Herdr on, whether that link is up, and how much it holds. */
function HostRow({ data, onNavigate }: { data: HomeData; onNavigate?: () => void }) {
  const connected = data.bridge === "connected" && !data.error;
  const { hostname } = window.location;
  const host = /^[\d.]+$|:/.test(hostname) ? hostname : hostname.split(".")[0] || "local";
  const agents = data.agents.length;
  return (
    <div className="nav-host">
      <span className={cn("size-2 shrink-0 rounded-full", connected ? "bg-status-done" : "bg-status-blocked")} aria-hidden />
      <span className="nav-host-text">
        <span className="nav-host-name">herdr · {host}</span>
        <span className="nav-host-meta">
          {connected ? `${data.workspaces.length} ${data.workspaces.length === 1 ? "workspace" : "workspaces"} · ${agents} ${agents === 1 ? "agent" : "agents"}` : "Not connected"}
        </span>
      </span>
      <Link className="workbench-icon-button" to={settingsPath(data.session)} onClick={onNavigate} aria-label="Settings"><Settings aria-hidden size={16} /></Link>
    </div>
  );
}

interface TreeFolds {
  /** Explicit folds, keyed by project slug, `slug/threadId` for a coordinator, and `slug/history`. */
  expanded: Record<string, boolean>;
  onExpand: (key: string, open: boolean) => void;
}

const STATE_WORD: Partial<Record<NodeState, string>> = { needs: "needs you", review: "review" };

function ProjectSection({ project, data, open, expanded, onExpand, onNavigate, panes = [] }: TreeFolds & {
  project: ProjectView;
  data: HomeData;
  open: boolean;
  onNavigate?: () => void;
  /** The project's workspace panes outside every thread, listed after its threads. */
  panes?: AgentView[];
}) {
  const { paneId, projectSlug, nodeId } = useParams();
  const listId = useId();
  const session = data.session;
  const status = project.coordinator?.liveStatus;
  const openCount = project.threads.filter(isOpenThread).length;
  const tree = orgTree(project.threads);
  const isCurrent = (node: OrgNode) => (node.thread.paneId !== undefined && node.thread.paneId === paneId) || (projectSlug === project.slug && nodeId === node.thread.id);
  // Open coordinators start open and resolved ones folded; the node on screen opens them.
  const branch = (node: OrgNode, depth: number): ReactNode => {
    const row = (fold?: ThreadRowFold) => <ThreadRow key={node.thread.id} node={node} depth={depth} slug={project.slug} session={session} current={isCurrent(node)}
      onNavigate={onNavigate} fold={fold} />;
    if (node.children.length === 0) return row();
    const key = `${project.slug}/${node.thread.id}`;
    const nodeOpen = expanded[key] ?? (node.state !== "resolved" || node.children.some((child) => holds(child, isCurrent)));
    return (
      <div key={node.thread.id} role="group" aria-label={node.thread.title}>
        {row({ open: nodeOpen, onToggle: () => onExpand(key, !nodeOpen) })}
        {nodeOpen && node.children.map((child) => branch(child, depth + 1))}
      </div>
    );
  };
  const historyKey = `${project.slug}/history`;
  const historyOpen = expanded[historyKey] ?? tree.history.some((node) => holds(node, isCurrent));
  const historyTotal = tree.resolved.coordinators + tree.resolved.threads;
  const history = historyPreview(tree.history, (node) => holds(node, isCurrent));
  return (
    <section aria-label={project.name} className="nav-project-section">
      <div className="nav-project">
        <Link className="nav-row" to={projectPath(project.slug, session)} onClick={onNavigate} aria-current={projectSlug === project.slug && !nodeId ? "page" : undefined}>
          <span className="nav-avatar" aria-hidden>{project.name.trim().charAt(0).toUpperCase() || "P"}</span>
          <span className="nav-row-text">{project.name}</span>
          {status && <StatusDot status={status} surface="bg-transparent" className="size-2" />}
          {status && <span className="sr-only">, coordinator {STATUS_LABEL[status]}</span>}
          {openCount > 0 && <span className="nav-count" aria-hidden>{openCount}</span>}
          {openCount > 0 && <span className="sr-only">{`, ${openCount} open ${openCount === 1 ? "task" : "tasks"}`}</span>}
        </Link>
        <button type="button" className="nav-disclosure nav-disclosure-end" aria-label={`${project.name} tasks`} aria-expanded={open} aria-controls={listId}
          onClick={() => onExpand(project.slug, !open)}>
          <ChevronRight aria-hidden size={14} />
        </button>
      </div>
      {open && (
        <div id={listId}>
          {project.coordinator && (
            <Link className="nav-row nav-tree-row" style={depthStyle(1)} to={panePath(project.coordinator.paneId, session)} onClick={onNavigate}
              aria-current={project.coordinator.paneId === paneId ? "page" : undefined}>
              <Bot aria-hidden size={14} />
              <span className="nav-row-text">Coordinator</span>
              <span className="sr-only">, {STATUS_LABEL[project.coordinator.liveStatus]}</span>
              {isAttention(project.coordinator.liveStatus)
                ? <span className="nav-row-word text-status-blocked">needs you</span>
                : <span className="nav-row-note">{project.coordinator.agent}</span>}
            </Link>
          )}
          {tree.open.map((node) => branch(node, 1))}
          {panes.map((pane) => (
            <Link key={pane.paneId} className="nav-row nav-tree-row" style={depthStyle(1)} to={panePath(pane.paneId, session)} onClick={onNavigate}
              aria-current={pane.paneId === paneId ? "page" : undefined}>
              {pane.kind === "shell" ? <Terminal aria-hidden size={14} /> : <StatusDot status={pane.status} surface="bg-transparent" className="size-2" />}
              <span className="nav-row-text">{displayName(pane, data.projects)}</span>
              {pane.kind !== "shell" && <span className="sr-only">, {STATUS_LABEL[pane.status]}</span>}
              <span className="nav-row-note">{pane.kind === "shell" ? "shell" : pane.agent}</span>
            </Link>
          ))}
          {tree.history.length > 0 && <>
            <button type="button" className="nav-row nav-row-nested nav-history" aria-expanded={historyOpen}
              title={`History · ${historyCount(tree.resolved)}`} onClick={() => onExpand(historyKey, !historyOpen)}>
              <ChevronRight aria-hidden size={14} />History <span className="nav-count">{historyTotal}</span>
            </button>
            {historyOpen && history.map((node) => branch(node, 2))}
            {historyOpen && history.length < tree.history.length && (
              <Link className="nav-row nav-tree-row nav-history-all" style={depthStyle(2)} to={projectPath(project.slug, session)} onClick={onNavigate}>
                <span className="nav-row-text">Show all {historyTotal} in project</span><ChevronRight aria-hidden size={14} />
              </Link>
            )}
          </>}
        </div>
      )}
    </section>
  );
}

/** How many resolved nodes the sidebar's History lists before handing the rest to the project page. */
const HISTORY_PREVIEW = 5;

/**
 * History as the sidebar shows it: the nodes that moved last, plus any holding what is on screen,
 * still in the tree's own order (coordinators first, newest first).
 */
function historyPreview(history: OrgNode[], onScreen: (node: OrgNode) => boolean): OrgNode[] {
  if (history.length <= HISTORY_PREVIEW) return history;
  const updated = (node: OrgNode) => Date.parse(node.thread.updated ?? "") || 0;
  const keep = new Set([...history].sort((a, b) => updated(b) - updated(a)).slice(0, HISTORY_PREVIEW));
  return history.filter((node) => keep.has(node) || onScreen(node));
}

/** Panes in a project's workspaces that run neither its coordinator nor one of its threads. */
function projectPanes(data: HomeData, project: ProjectView): AgentView[] {
  const held = new Set(project.workspaceIds ?? []);
  if (held.size === 0) return [];
  return [...data.agents, ...data.shellPanes].filter((pane) => held.has(pane.workspaceId) && !projectForPane(data.projects, pane.paneId));
}

const depthStyle = (depth: number) => ({ "--nav-depth": depth }) as CSSProperties;

interface ThreadRowFold {
  open: boolean;
  onToggle: () => void;
}

/** A node's row: its chat when it runs in a live pane, its detail otherwise; never the project page. */
function ThreadRow({ node, depth, slug, session, current, onNavigate, fold }: {
  node: OrgNode;
  depth: number;
  slug: string;
  session?: string;
  current: boolean;
  onNavigate?: () => void;
  /** Present on a coordinator with nodes under it. */
  fold?: ThreadRowFold;
}) {
  const { thread, state } = node;
  const word = STATE_WORD[state];
  const note = thread.paneId || state === "resolved" ? undefined : thread.status === "open" ? "not running" : thread.status;
  return (
    <div className="nav-thread">
      {fold && (
        <button type="button" className="nav-disclosure" style={depthStyle(depth)} aria-label={`${thread.title} threads`} aria-expanded={fold.open}
          onClick={fold.onToggle}>
          <ChevronRight aria-hidden size={13} />
        </button>
      )}
      <Link className={cn("nav-row nav-tree-row", fold && "nav-tree-head", state === "resolved" && "nav-tree-resolved")} style={depthStyle(depth)}
        to={thread.paneId ? panePath(thread.paneId, session) : nodePath(slug, thread.id, session)} onClick={onNavigate} aria-current={current ? "page" : undefined}>
        <NodeDot state={state} />
        <span className="nav-row-text">{thread.title}</span>
        <span className="sr-only">, {STATE_LABEL[state].toLowerCase()}</span>
        {fold && state !== "resolved" && <span className="nav-dots" aria-hidden>{node.children.slice(0, 6).map((child) => <NodeDot key={child.thread.id} state={child.state} className="size-1.5" />)}</span>}
        {word && <span aria-hidden className={cn("nav-row-word", state === "review" ? "text-primary" : "text-status-blocked")}>{word}</span>}
        {note && !word && !fold && <span className="nav-row-note">{note}</span>}
      </Link>
    </div>
  );
}

function Empty() {
  return <p className="nav-empty">Your agent chats will appear here.</p>;
}
