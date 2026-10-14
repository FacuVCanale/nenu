// What the desk's sidebar lists, drawn the way Cursor's agent window draws its own: projects as one
// flat row each, and every conversation in a project or outside one as a chat, dated by when it last
// moved. Kept free of React so the rows' rules stay unit-testable.
import { displayName } from "./display-name";
import { chatRecency, isOpenThread, looseChats, projectForPane } from "./projects";
import type { AgentStatus, AgentView, ProjectThreadView, ProjectView } from "./types";

export interface DeskChat {
  key: string;
  title: string;
  /** The live pane it opens; undefined for a thread that runs nowhere, which opens its node page. */
  paneId?: string;
  /** The project that holds it, with the thread it runs; neither for a chat outside every project. */
  project?: string;
  thread?: ProjectThreadView;
  pane?: AgentView;
  /** When it last moved, epoch ms; 0 when nothing says. */
  at: number;
}

const updatedAt = (thread: ProjectThreadView) => Date.parse(thread.updated ?? "") || 0;

/**
 * Every open thread of every project and every agent pane outside them. A project's own coordinator
 * is the project's row, so it is no chat; resolved threads stay in the project's History.
 */
export function deskChats(data: { agents: readonly AgentView[]; projects?: readonly ProjectView[] }): DeskChat[] {
  const panes = new Map(data.agents.map((pane) => [pane.paneId, pane]));
  const threads = (data.projects ?? []).flatMap((project) => project.threads.filter(isOpenThread).map((thread): DeskChat => {
    const pane = thread.paneId ? panes.get(thread.paneId) : undefined;
    return {
      key: `${project.slug}/${thread.id}`, title: thread.title, paneId: pane?.paneId, project: project.slug, thread, pane,
      at: Math.max(updatedAt(thread), pane ? chatRecency(pane) : 0),
    };
  }));
  const loose = looseChats(data.agents, data.projects).map((pane): DeskChat => ({
    key: pane.paneId, title: displayName(pane, data.projects), paneId: pane.paneId, pane, at: chatRecency(pane),
  }));
  return [...threads, ...loose];
}

/** The agents a project holds: its coordinator, its threads' panes, and any pane in its workspaces. */
export function projectAgents(project: ProjectView, agents: readonly AgentView[], projects: readonly ProjectView[] | undefined): AgentView[] {
  const held = new Set(project.workspaceIds ?? []);
  return agents.filter((pane) => held.has(pane.workspaceId) || projectForPane(projects, pane.paneId)?.project.slug === project.slug);
}

/** When anything in the project last moved: a thread's update, resolved ones included, or its coordinator's pane. */
export function projectActivity(project: ProjectView, agents: readonly AgentView[]): number {
  const coordinator = agents.find((pane) => pane.paneId === project.coordinator?.paneId);
  return Math.max(0, ...project.threads.map(updatedAt), coordinator ? chatRecency(coordinator) : 0);
}

/** The most pressing state among `panes`, for a project's dot. Resting agents draw none. */
export function liveliest(panes: readonly AgentView[]): AgentStatus | undefined {
  return (["blocked", "working", "done"] as const).find((status) => panes.some((pane) => pane.status === status));
}
