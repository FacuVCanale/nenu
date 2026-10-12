// What the navigation's search finds: the agents, projects and nodes whose own name matches, each
// called what every other view calls it (lib/display-name.ts), so the row you pick reads like the
// screen it opens. Before this a search narrowed the tree to tab rows, and the name that matched
// was nowhere on screen.
import { displayName, displayPlace, type DisplayPlace } from "./display-name";
import { nodeState, type NodeState } from "./org-tree";
import { chatRecency, projectForPane, projectSummary } from "./projects";
import type { AgentView, ProjectThreadView, ProjectView } from "./types";

/** How many rows a group shows before it only counts the rest. */
export const SEARCH_LIMIT = 8;

interface HitBase {
  /** Unique across every group, for React keys and the option ids. */
  key: string;
  title: string;
  /** The line under the title: where it lives. */
  place: DisplayPlace;
}

export type SearchHit =
  | HitBase & { kind: "project"; project: ProjectView }
  | HitBase & { kind: "node"; project: ProjectView; thread: ProjectThreadView; state: NodeState }
  | HitBase & { kind: "pane"; pane: AgentView };

export interface SearchGroup {
  label: "Projects" | "Chats";
  hits: SearchHit[];
  /** Matches past the limit, counted rather than listed. */
  more: number;
}

interface Ranked {
  hit: SearchHit;
  /** 0 a word of the title starts with the query, 1 the title holds it, 2 only where it lives does. */
  rank: number;
  resolved: boolean;
  at: number;
}

/** Where `query` (trimmed, any case) first occurs in `text`, as [start, end); null when it doesn't. */
export function matchRange(text: string, query: string): [number, number] | null {
  const needle = query.trim().toLocaleLowerCase();
  const hay = text.toLocaleLowerCase();
  // A letter whose lower case is longer would shift every index after it; such a title just goes unmarked.
  if (!needle || hay.length !== text.length) return null;
  const start = hay.indexOf(needle);
  return start < 0 ? null : [start, start + needle.length];
}

function rank(query: string, title: string, ...elsewhere: Array<string | null | undefined>): number | null {
  const range = matchRange(title, query);
  if (range) return range[0] === 0 || /\s/.test(title[range[0] - 1]!) ? 0 : 1;
  return elsewhere.some((field) => field && matchRange(field, query)) ? 2 : null;
}

/**
 * The search's two groups, Projects then Chats, each ordered by how well the title matches, open
 * work before resolved, then the latest to move. A project's coordinator and threads are found under
 * Projects only; Chats holds every other pane, shells included.
 */
export function navSearch(source: { agents: readonly AgentView[]; shellPanes?: readonly AgentView[]; projects?: readonly ProjectView[] }, query: string, limit = SEARCH_LIMIT): SearchGroup[] {
  if (!query.trim()) return [];
  const projects = source.projects ?? [];
  const panes = [...source.agents, ...(source.shellPanes ?? [])];
  const byPane = new Map(panes.map((pane) => [pane.paneId, pane]));
  const paneAt = (paneId: string | undefined) => {
    const pane = paneId ? byPane.get(paneId) : undefined;
    return pane ? chatRecency(pane) : 0;
  };
  const owned: Ranked[] = [];
  const loose: Ranked[] = [];

  for (const project of projects) {
    const projectRank = rank(query, project.name, project.slug, project.goal);
    const threadTimes = project.threads.map((thread) => Math.max(paneAt(thread.paneId), Date.parse(thread.updated ?? "") || 0));
    if (projectRank !== null) {
      owned.push({ hit: { kind: "project", key: `project:${project.slug}`, project, title: project.name, place: { place: projectSummary(project), tab: null } },
        rank: projectRank, resolved: false, at: Math.max(0, paneAt(project.coordinator?.paneId), ...threadTimes) });
    }
    project.threads.forEach((thread, index) => {
      const threadRank = rank(query, thread.title, thread.id);
      if (threadRank === null) return;
      const state = nodeState(thread);
      owned.push({ hit: { kind: "node", key: `node:${project.slug}/${thread.id}`, project, thread, state, title: thread.title, place: { place: project.name, tab: null } },
        rank: threadRank, resolved: state === "resolved", at: threadTimes[index]! });
    });
  }

  for (const pane of panes) {
    const owner = projectForPane(projects, pane.paneId);
    if (owner?.thread) continue; // found as its node
    const title = displayName(pane, projects);
    const place = displayPlace(pane, projects);
    const paneRank = rank(query, title, place.place, place.tab);
    if (paneRank === null) continue;
    (owner ? owned : loose).push({ hit: { kind: "pane", key: `pane:${pane.paneId}`, pane, title, place }, rank: paneRank, resolved: false, at: chatRecency(pane) });
  }

  const order = (a: Ranked, b: Ranked) => Number(a.resolved) - Number(b.resolved) || a.rank - b.rank || b.at - a.at;
  const group = (label: SearchGroup["label"], list: Ranked[]): SearchGroup[] => {
    if (list.length === 0) return [];
    const sorted = [...list].sort(order);
    return [{ label, hits: sorted.slice(0, limit).map((item) => item.hit), more: Math.max(0, sorted.length - limit) }];
  };
  return [...group("Projects", owned), ...group("Chats", loose)];
}
