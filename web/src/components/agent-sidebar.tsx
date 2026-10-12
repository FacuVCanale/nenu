import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { PaneMark, PlaceText, RowBody } from "@/components/nav-rows";
import { displayName, displayPlace } from "@/lib/display-name";
import { byRecency } from "@/lib/projects";
import { isAttention } from "@/lib/triage";
import { STATUS_LABEL, type AgentView, type ProjectView } from "@/lib/types";

interface ThreadSidebarProps {
  agents: AgentView[];
  /** Bare shell panes (no agent): the open workspace's sit with it, the rest under a trailing "Shells". */
  shellPanes?: AgentView[];
  /** So a project's pane is called what every other view calls it (lib/display-name.ts). */
  projects?: readonly ProjectView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  /** Whether the Recent section is expanded, and how to fold it. Omit to leave it always open. */
  recentOpen?: boolean;
  onRecentOpenChange?: (open: boolean) => void;
  /** Whether the Shells section is expanded, and how to fold it. Omit to leave it always open. */
  shellsOpen?: boolean;
  onShellsOpenChange?: (open: boolean) => void;
  /** Override the list container padding (e.g. flush inside a bottom sheet). */
  className?: string;
}

// The pane switcher: Browse's rows (a state dot, the agent's one name, where it lives) under three
// sections: what needs you (the dashboard's own rule, lib/triage.ts), the open pane's workspace, and
// everything else newest first; then the other workspaces' bare shells. Switching is the ONLY action
// here. Closing a pane lives in the pane pill's long-press sheet (with its own confirm), so a
// fat-thumbed switch can never destroy a pane.
//
// This sheet sees the WHOLE herd, so its two long tails (Recent, and 30-odd bare shells) fold, and
// the parent remembers the folds.
export function ThreadSidebar({
  agents,
  shellPanes = [],
  projects,
  currentPaneId,
  onSelect,
  recentOpen = true,
  onRecentOpenChange,
  shellsOpen = true,
  onShellsOpenChange,
  className,
}: ThreadSidebarProps) {
  if (agents.length === 0 && shellPanes.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-subhead text-muted-foreground">No agents running.</div>
    );
  }

  const here = [...agents, ...shellPanes].find((pane) => pane.paneId === currentPaneId)?.workspaceId;
  const needs = agents.filter((pane) => isAttention(pane.status));
  const inWorkspace = (pane: AgentView) => here !== undefined && pane.workspaceId === here && !isAttention(pane.status);
  const workspace = [...agents, ...shellPanes].filter(inWorkspace);
  const recent = byRecency(agents.filter((pane) => !isAttention(pane.status) && !inWorkspace(pane)));
  const shells = shellPanes.filter((pane) => !inWorkspace(pane));
  const row = (pane: AgentView) => <PaneRow key={pane.paneId} pane={pane} projects={projects} active={pane.paneId === currentPaneId} onSelect={onSelect} />;

  return (
    <div className={cn("-mx-2.5 flex flex-col gap-2 py-3", className)}>
      {needs.length > 0 && <Section label="Needs you" count={needs.length}>{needs.map(row)}</Section>}
      {workspace.length > 0 && <Section label="This workspace" count={workspace.length}>{workspace.map(row)}</Section>}
      {recent.length > 0 && (
        <Section label="Recent" count={recent.length} {...(onRecentOpenChange ? { open: recentOpen, onToggle: onRecentOpenChange } : {})}>
          {recent.map(row)}
        </Section>
      )}
      {shells.length > 0 && (
        <Section label="Shells" count={shells.length} {...(onShellsOpenChange ? { open: shellsOpen, onToggle: onShellsOpenChange } : {})}>
          {shells.map(row)}
        </Section>
      )}
    </div>
  );
}

/**
 * A sentence-case heading over its rows. Passing `open` and `onToggle` makes the heading a fold; an
 * attention section never gets one, since collapsing an alert defeats the alert.
 */
function Section({ label, count, open, onToggle, children }: {
  label: string;
  count: number;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  const foldable = open !== undefined && onToggle !== undefined;
  return (
    <section aria-label={label} className="nav-group">
      <h3 className="nav-label">
        {foldable ? (
          <button type="button" className="nav-fold" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => onToggle(!open)}>
            <ChevronRight aria-hidden size={14} />{label}<span className="nav-count">{count}</span>
          </button>
        ) : <>{label}<span className="nav-count">{count}</span></>}
      </h3>
      {(!foldable || open) && <div id={bodyId}>{children}</div>}
    </section>
  );
}

function PaneRow({ pane, projects, active, onSelect }: {
  pane: AgentView;
  projects?: readonly ProjectView[];
  active: boolean;
  onSelect: (paneId: string) => void;
}) {
  return (
    <button type="button" className="nav-pane" onClick={() => onSelect(pane.paneId)} aria-current={active ? "page" : undefined}>
      <RowBody mark={<PaneMark pane={pane} />} title={displayName(pane, projects)} detail={<PlaceText place={displayPlace(pane, projects)} />}
        end={pane.kind !== "shell" && <span className="sr-only">, {STATUS_LABEL[pane.status]}</span>} />
    </button>
  );
}
