import { useEffect, useRef } from "react";

import type { AgentStatus, AgentView, ProjectView } from "@/lib/types";
import { displayName, displayPlace } from "@/lib/display-name";
import { homePath, panePath } from "@/lib/nav";
import { setStatus } from "@/lib/status";

// In-app lifecycle notifications. We diff each snapshot against the previous one and surface a
// header status line when an agent crosses into a state that wants attention. Background/OS
// notifications are handled separately by the server via Web Push; this is the foreground equivalent.
//
// The first snapshot never fires (prev is null), so opening the app doesn't spam the status line
// for agents that were already blocked — matching the server's transition semantics.
export function useAgentTransitions(agents: AgentView[], openPaneId: string | null, session?: string,
  projects?: readonly ProjectView[]) {
  const prev = useRef<{ session?: string; statuses: Map<string, AgentStatus> } | null>(null);

  useEffect(() => {
    const now = new Map(agents.map((a) => [a.paneId, a.status]));
    const before = prev.current && prev.current.session === session ? prev.current.statuses : null;
    prev.current = { session, statuses: now };
    if (!before) return;

    const changed = agents.filter((agent) => {
      const was = before.get(agent.paneId);
      return was !== undefined && was !== agent.status && agent.paneId !== openPaneId;
    });
    const blocked = changed.filter((agent) => agent.status === "blocked");
    const attention = blocked.length ? blocked : changed.filter((agent) => agent.status === "done");
    if (!attention.length) return;

    const needsInput = blocked.length > 0;
    const first = attention[0]!;
    // The pane's own name, as its header and the sidebar show it. Only the bare CLI id ("claude",
    // the last fallback) gets a capital; a label is printed as the operator wrote it.
    const name = displayName(first, projects).trim();
    const subject = attention.length === 1
      ? name === first.agent ? name.charAt(0).toUpperCase() + name.slice(1) : name || "Agent"
      : `${attention.length} agents`;
    const title = `${subject} ${needsInput ? attention.length === 1 ? "needs your input" : "need your input" : "finished"}`;
    const locations = [...new Set(attention.map((agent) => {
      const { place, tab } = displayPlace(agent, projects);
      return [place, tab].filter(Boolean).join(" · ");
    }))];
    const description = locations.slice(0, 3).join(", ") + (locations.length > 3 ? ` +${locations.length - 3} more` : "");
    // One agent opens its pane; several open Home, whose Needs you lists each of them.
    const to = attention.length === 1 ? panePath(first.paneId, session) : homePath(session);
    setStatus(title, needsInput ? "warn" : "success", undefined, { description, background: true, to });
  }, [agents, openPaneId, session, projects]);
}
