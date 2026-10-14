import { needsYouItems } from "@/lib/home-stats";
import { chatRecency } from "@/lib/projects";
import type { AgentView, ProjectView } from "@/lib/types";

/** How many chats Recent shows; the rest stay one tap away under Projects and Workspaces. */
export const RECENT_CHATS = 5;

/** A chat row at the top of the phone's navigation; the row names it as every view does (lib/display-name.ts). */
export interface DrawerChat {
  pane: AgentView;
  current: boolean;
}

export interface DrawerSections {
  /** Every chat waiting on you, as Home's headline and icon count them, newest first. */
  needsYou: DrawerChat[];
  /** The chats that moved or were opened last, the open one included and marked; never one listed above. */
  recent: DrawerChat[];
}

/** The two sections the phone's navigation leads with, before its projects and workspaces. */
export function drawerSections(data: { agents: readonly AgentView[]; projects?: readonly ProjectView[] }, currentPaneId: string | undefined): DrawerSections {
  const rows = [...data.agents]
    .sort((a, b) => chatRecency(b) - chatRecency(a))
    .map((pane): DrawerChat => ({ pane, current: pane.paneId === currentPaneId }));
  const asking = new Set(needsYouItems(data.agents, [], data.projects).map((item) => item.paneId));
  return {
    needsYou: rows.filter((row) => asking.has(row.pane.paneId)),
    recent: rows.filter((row) => !asking.has(row.pane.paneId)).slice(0, RECENT_CHATS),
  };
}
