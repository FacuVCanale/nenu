import { isAttention } from "@/lib/triage";
import { chatRecency, paneTitle, projectForPane } from "@/lib/projects";
import type { AgentView, ProjectView } from "@/lib/types";

/** How many chats Recent shows; the rest stay one tap away under Projects and Workspaces. */
export const RECENT_CHATS = 5;

/** A chat row at the top of the phone's navigation: what it is, where it lives, and when it last moved. */
export interface DrawerChat {
  pane: AgentView;
  title: string;
  /** Its project, else its workspace. */
  place: string;
  /** Last time it moved or was opened (see chatRecency). */
  at: number;
  current: boolean;
}

export interface DrawerSections {
  /** Every chat waiting on you, newest first. */
  needsYou: DrawerChat[];
  /** The chats that moved or were opened last, the open one included and marked; never one listed above. */
  recent: DrawerChat[];
}

/** The two sections the phone's navigation leads with, before its projects and workspaces. */
export function drawerSections(data: { agents: readonly AgentView[]; projects?: readonly ProjectView[] }, currentPaneId: string | undefined): DrawerSections {
  const rows = [...data.agents]
    .sort((a, b) => chatRecency(b) - chatRecency(a))
    .map((pane): DrawerChat => {
      const owner = projectForPane(data.projects, pane.paneId);
      return { pane, title: paneTitle(pane, owner), place: owner?.project.name ?? pane.workspaceLabel, at: chatRecency(pane), current: pane.paneId === currentPaneId };
    });
  return {
    needsYou: rows.filter((row) => isAttention(row.pane.status)),
    recent: rows.filter((row) => !isAttention(row.pane.status)).slice(0, RECENT_CHATS),
  };
}
