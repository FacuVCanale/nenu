import { useState } from "react";
import { Plus } from "lucide-react";

import { Chip, ChipStatus, ChipStrip } from "@/components/ui/chip";
import { TabActionsSheet } from "@/components/tab-actions-sheet";
import { tabName } from "@/lib/spaces";
import { TRIAGE_STATUS, worstTriage } from "@/lib/triage";
import type { AgentView, TabView } from "@/lib/types";

interface TabStripProps {
  workspaceId: string;
  tabs: TabView[];
  agents: AgentView[];
  /** The tab the open pane sits in. */
  selected: string;
  onSelect: (tabId: string) => void;
  onNewTab: (workspaceId: string) => void;
  /** Session scope for the long-press tab actions (rename/close); undefined = primary. */
  session?: string;
  /** Drop the long-press write actions when the device isn't authorised (the sheet shows a note). */
  readOnly?: boolean;
  /** Revalidate after a rename. Long-press tab actions turn on only when this AND onClosed are set. */
  onRenamed?: () => void;
  /** Refresh/fall back after a close. Enables long-press together with onRenamed. */
  onClosed?: (tabId: string) => void;
}

// The open pane's space as a row of tabs above the conversation: tapping a tab opens one of its
// panes; the trailing + creates a new tab (and opens its fresh shell). The desktop-focused tab gets a
// dashed outline; each tab carries a status dot for the most urgent thing inside it. A long-press on
// a chip, or a tap on the open one, opens its actions sheet (rename / close) when the parent wires
// both onRenamed and onClosed (the + never takes long-press).
export function TabStrip({
  workspaceId,
  tabs,
  agents,
  selected,
  onSelect,
  onNewTab,
  session,
  readOnly,
  onRenamed,
  onClosed,
}: TabStripProps) {
  const [sheetTab, setSheetTab] = useState<TabView | null>(null);
  // Actions need both callbacks wired (revalidate on rename, fall back on close); without them the
  // chips stay plain tap-to-switch — long-press is inert.
  const actionsEnabled = !!onRenamed && !!onClosed;

  const wsTabs = tabs.filter((t) => t.workspaceId === workspaceId);
  if (wsTabs.length === 0) return null;

  return (
    <>
      <ChipStrip band="tabs" activeKey={selected}>
        {wsTabs.map((t, index) => {
          // What's going on in there (blocked / ready / working / idle); nothing for a tab with no agent,
          // since empty is not idle.
          const status = worstTriage(agents.filter((a) => a.tabId === t.tabId));
          return (
            <Chip
              key={t.tabId}
              label={tabName(t.label, index + 1)}
              active={selected === t.tabId}
              focused={t.focused}
              leading={status && <ChipStatus status={TRIAGE_STATUS[status]} />}
              onClick={() => onSelect(t.tabId)}
              // Long-press, or a tap on the open tab, opens its actions when the parent wired them.
              onLongPress={actionsEnabled ? () => setSheetTab(t) : undefined}
              onTapActive={actionsEnabled ? () => setSheetTab(t) : undefined}
            />
          );
        })}
        <button type="button" onClick={() => onNewTab(workspaceId)} aria-label="New tab" className="strip-add">
          <Plus className="size-4" />
        </button>
      </ChipStrip>

      {actionsEnabled && (
        <TabActionsSheet
          open={sheetTab !== null}
          onClose={() => setSheetTab(null)}
          tab={sheetTab}
          session={session}
          readOnly={readOnly}
          onRenamed={onRenamed}
          onClosed={onClosed}
        />
      )}
    </>
  );
}
