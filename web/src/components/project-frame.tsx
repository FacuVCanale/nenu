import { useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRevalidator, useSearchParams } from "react-router";
import { ListChecks, ChatCircle } from "@/components/ui/icon";

import { PrBar } from "@/components/pr-bar";
import { ProjectTasks, coordinatedThreads, threadTree } from "@/components/project-tasks";
import { InspectorToggle, panelLink, SessionInspector, sessionPr, type SessionInspectorState, type SessionPanelLink } from "@/components/session-inspector";
import { DockedThread, ThreadChips, threadChipsShown } from "@/components/split-view";
import { PrList, ThreadsPanel, prLists } from "@/components/threads-panel";
import type { HomeData } from "@/lib/loaders";
import { nodePath, panePath } from "@/lib/nav";
import { isOpenThread, type PaneProject } from "@/lib/projects";
import { isReadOnly, type ProjectThreadView } from "@/lib/types";
import { WorkbenchNavigationContext } from "@/lib/workbench-navigation";

/** What a project gives the chat it wraps. */
export interface ProjectChatSlots {
  title: string;
  headerAction?: ReactNode;
  overlay?: ReactNode;
  strip?: ReactNode;
  composerTop?: ReactNode;
  /** The desk's session panel beside the chat, absent while a thread is docked there instead. */
  sessionPanel?: SessionPanelLink;
}

/** The search param naming the thread docked beside its coordinator on a desk. */
export const SPLIT_PARAM = "thread";

type PhoneView = "chat" | "threads" | "prs";

/** Who a pane answers to and which threads sit beside it. */
export function projectScope(owner: PaneProject, data: Pick<HomeData, "agents">) {
  const { project, thread } = owner;
  const coordinating = !thread || thread.role === "coordinator";
  // A coordinator scopes to the threads it runs; a worker to its siblings under the same coordinator.
  const parentId = coordinating ? thread?.id : thread.parentId === "root" ? undefined : thread.parentId;
  const parent = parentId ? project.threads.find((candidate) => candidate.id === parentId) : undefined;
  // Lists and counts cover the whole subtree; chips and tabs only the direct siblings.
  const threads = threadTree(project, parentId);
  const siblings = coordinatedThreads(project, parentId);
  const coordinatorPane = parentId ? parent?.paneId : project.coordinator?.paneId;
  const panelTitle = parent?.title ?? project.name;
  const live = coordinatorPane !== undefined && data.agents.some((pane) => pane.paneId === coordinatorPane);
  const subtitle = parent
    ? `Coordinator under ${project.name} · ${threads.length} ${threads.length === 1 ? "thread" : "threads"}`
    : project.goal;
  return { coordinating, threads, siblings, coordinator: parent, coordinatorPane: live ? coordinatorPane : undefined, panelTitle, subtitle };
}

/**
 * A pane that belongs to a project renders inside this frame. A desk keeps the session panel beside
 * the chat, with the project's own panel behind its ⋯, or docks a thread there (`?thread=`); the
 * sidebar lists the threads, so the chat carries none of them. A phone switches the coordinator between Chat,
 * Threads and PRs in place, keeping the chat mounted so its draft and scroll survive; a thread shows
 * its siblings as chips, a header button to the project's threads, and its pull request above the
 * composer.
 */
export function ProjectFrame({ owner, paneId, data, inspector, children }: {
  owner: PaneProject;
  paneId: string;
  data: HomeData;
  inspector: SessionInspectorState;
  children: (slots: ProjectChatSlots) => ReactNode;
}) {
  const { project, thread } = owner;
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [search, setSearch] = useSearchParams();
  const desk = inspector.desk;
  const [view, setView] = useState<PhoneView>("chat");
  const scope = projectScope(owner, data);
  const readOnly = isReadOnly(data.device);
  const refresh = () => revalidator.revalidate();
  const openPane = (id: string) => { setView("chat"); if (id !== paneId) navigate(panePath(id, data.session)); };
  const openNode = (id: string) => navigate(nodePath(project.slug, id, data.session));

  // A docked thread is only meaningful beside its own coordinator on a desk.
  const splitPane = search.get(SPLIT_PARAM);
  const docked = desk && scope.coordinating && splitPane
    ? scope.threads.find((candidate): candidate is ProjectThreadView & { paneId: string } => candidate.paneId === splitPane && data.agents.some((pane) => pane.paneId === splitPane))
    : undefined;
  const setDocked = (id: string | null) => setSearch((current) => {
    const next = new URLSearchParams(current);
    if (id) next.set(SPLIT_PARAM, id);
    else next.delete(SPLIT_PARAM);
    return next;
  }, { replace: true });
  const panelShown = desk && inspector.open && !docked;
  const onDock = useContext(WorkbenchNavigationContext)?.onDock;
  const isDocked = docked !== undefined;
  useEffect(() => {
    if (!onDock || !isDocked) return;
    onDock(true);
    return () => onDock(false);
  }, [onDock, isDocked]);

  const openCount = scope.threads.filter(isOpenThread).length;
  const prCount = prLists(scope.threads).open.length;
  // A phone thread switches between its chat and the project's threads with one header button.
  const phoneWorker = !desk && !scope.coordinating;
  const tasksShown = phoneWorker && view === "threads";
  const pr = sessionPr(data, paneId, thread);
  const headerAction = desk && !panelShown && !docked ? <InspectorToggle inspector={inspector} pr={pr} /> : phoneWorker ? (
    <button type="button" className="project-toggle" aria-label={tasksShown ? "Back to chat" : `Threads, ${openCount} open`}
      onClick={() => setView(tasksShown ? "chat" : "threads")}>
      {tasksShown ? <><ChatCircle aria-hidden className="size-3.5" />Chat</> : <>
        <ListChecks aria-hidden className="size-3.5" />Threads
        {openCount > 0 && <span className="tabular-nums text-muted-foreground">{openCount}</span>}
      </>}
    </button>
  ) : undefined;

  const phoneTabs = !desk && scope.coordinating ? (
    <div className="project-segmented-band">
      <div role="tablist" aria-label="Project" className="project-segmented">
        {([["chat", "Chat", null], ["threads", "Threads", openCount], ["prs", "PRs", prCount]] as const).map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className="project-segment">
            {label}{count !== null && count > 0 && <span className="project-segment-count">{count}</span>}
          </button>
        ))}
      </div>
    </div>
  ) : undefined;

  const chipCoordinator = scope.coordinatorPane ? { paneId: scope.coordinatorPane, label: "coordinator" } : undefined;
  // The panel lists the siblings (and their coordinator) already; chips take its place when it is put away.
  const chips = !scope.coordinating && !panelShown && threadChipsShown(scope.siblings, chipCoordinator !== undefined) ? (
    <ThreadChips threads={scope.siblings} currentPaneId={paneId} onOpen={openPane} coordinator={chipCoordinator} />
  ) : undefined;

  const tasks = <ProjectTasks project={project} threads={scope.threads} coordinator={scope.coordinator} title={scope.panelTitle} subtitle={scope.subtitle} panes={data.agents} session={data.session}
    currentPaneId={paneId} readOnly={readOnly} onOpenPane={openPane} onOpenNode={openNode} onChanged={refresh} />;
  const overlay = phoneTabs && view !== "chat" ? (
    <div className="flex min-h-0 flex-1 flex-col">{phoneTabs}<div className="project-overlay">
      {view === "threads" ? tasks : <PrList project={project} threads={scope.threads} session={data.session} readOnly={readOnly} onOpenPane={openPane} onOpenNode={openNode} onChanged={refresh} />}
    </div></div>
  ) : tasksShown ? <div className="project-overlay">{tasks}</div> : undefined;

  return (
    <div className="project-frame">
      {children({
        title: thread?.title ?? project.name,
        headerAction,
        overlay,
        // Project chips or tabs replace the workspace tabs; on a desk the panel stands in for them.
        strip: phoneTabs ?? chips ?? (desk ? null : undefined),
        composerTop: thread?.pr && !scope.coordinating
          ? <PrBar project={project} thread={thread} session={data.session} readOnly={readOnly} onChanged={refresh} />
          : undefined,
        sessionPanel: desk && !docked ? panelLink(inspector) : undefined,
      })}
      {docked && (
        <DockedThread thread={docked} project={project} siblings={coordinatedThreads(project, docked.parentId === "root" ? undefined : docked.parentId)} data={data}
          subtitle={[scope.panelTitle, docked.agent].filter(Boolean).join(" · ")}
          onSwitch={(id) => setDocked(id)}
          onExpand={() => navigate(panePath(docked.paneId, data.session))}
          onClose={() => setDocked(null)} />
      )}
      {panelShown && (
        <SessionInspector inspector={inspector} paneId={paneId} session={data.session} artifacts={data.agents.some((pane) => pane.paneId === paneId)} pr={pr}
          project={<ThreadsPanel project={project} threads={scope.threads} coordinator={scope.coordinator} title={scope.panelTitle} subtitle={scope.subtitle}
            activityPaneId={scope.coordinatorPane} panes={data.agents} session={data.session} currentPaneId={paneId} readOnly={readOnly}
            onOpenPane={(id) => { if (scope.coordinating && scope.threads.some((candidate) => candidate.paneId === id)) setDocked(id); else openPane(id); }}
            onOpenNode={openNode} onChanged={refresh} />} />
      )}
    </div>
  );
}
