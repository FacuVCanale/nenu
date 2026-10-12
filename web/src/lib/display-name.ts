// What an agent is CALLED, and where it lives, in every view that names one: sidebar rows, headers,
// Recent, Needs you, chips, pills and the switcher. Before this each view picked its own field (the
// tab label in the sidebar, the pane label in the header, the thread title on a chip), so the row you
// tapped and the screen that opened disagreed about who you were talking to.
import { projectForPane } from "./projects";
import { workspaceName } from "./spaces";
import { paneDisplayName, type AgentView, type ProjectView } from "./types";

/** Between a workspace and its tab on the line under a name. */
export const PLACE_SEP = " › ";

/**
 * The agent's one name: a project thread's title, "<Project> coordinator" for the coordinator, else
 * the pane's own name (label, then Claude's /rename, then the terminal title, then the agent).
 * Render as text only, never markup: every field here comes from the herd.
 */
export function displayName(pane: AgentView, projects: readonly ProjectView[] | undefined): string {
  const owner = projectForPane(projects, pane.paneId);
  const title = owner?.thread?.title.trim();
  if (title) return title;
  if (owner && !owner.thread) return `${owner.project.name} coordinator`;
  return paneDisplayName(pane);
}

/**
 * The line under the name: a worker's project, else "workspace › tab" (the tab only when its label
 * says something). The coordinator gets its workspace, since its name already carries the project.
 */
export function displayPlace(pane: AgentView, projects: readonly ProjectView[] | undefined): string {
  const owner = projectForPane(projects, pane.paneId);
  if (owner?.thread) return owner.project.name;
  const workspace = workspaceName({ label: pane.workspaceLabel, number: pane.workspaceNumber });
  return pane.tabLabel ? `${workspace}${PLACE_SEP}${pane.tabLabel}` : workspace;
}
