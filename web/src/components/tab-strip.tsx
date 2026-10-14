import { useRef, useState } from "react";
import { Plus } from "@/components/ui/icon";

import { Chip, ChipStrip } from "@/components/ui/chip";
import { useStripReorder } from "@/components/ui/strip-reorder";
import { TabActionsSheet } from "@/components/tab-actions-sheet";
import * as api from "@/lib/api";
import { tabName } from "@/lib/spaces";
import { setStatus } from "@/lib/status";
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
  /** Session scope for the long-press tab actions (rename/close/move); undefined = primary. */
  session?: string;
  /** Drop the long-press write actions when the device isn't authorised (the sheet shows a note). */
  readOnly?: boolean;
  /** Revalidate after a rename. Long-press tab actions turn on only when this AND onClosed are set. */
  onRenamed?: () => void;
  /** Refresh/fall back after a close. Enables long-press together with onRenamed. */
  onClosed?: (tabId: string) => void;
  /** Revalidate after a move. With it (and the actions), a tab can be dragged to another place. */
  onMoved?: () => void;
}

// The open pane's space as a row of tabs above the conversation: tapping a tab opens one of its
// panes; the trailing + creates a new tab (and opens its fresh shell). The desktop-focused tab gets a
// dashed outline; each tab carries a status dot for the most urgent thing inside it. A long-press on
// a chip, or a tap on the open one, opens its actions sheet (rename / move / close) when the parent
// wires both onRenamed and onClosed (the + never takes long-press). With onMoved too, a held tab can
// be dragged along the strip (a mouse drags it straight away), and Herdr moves it there.
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
  onMoved,
}: TabStripProps) {
  // The tab whose actions are open, with the name its chip shows, which the sheet repeats.
  const [sheet, setSheet] = useState<{ tab: TabView; name: string } | null>(null);
  // Actions need both callbacks wired (revalidate on rename, fall back on close); without them the
  // chips stay plain tap-to-switch — long-press is inert.
  const actionsEnabled = !!onRenamed && !!onClosed;
  const movable = actionsEnabled && !readOnly && !!onMoved;
  const scrollerRef = useRef<HTMLDivElement>(null);

  const wsTabs = tabs.filter((t) => t.workspaceId === workspaceId);
  const byId = new Map(wsTabs.map((t) => [t.tabId, t]));
  const name = (t: TabView) => tabName(t.label, wsTabs.indexOf(t) + 1);
  const reorder = useStripReorder({
    scroller: scrollerRef,
    keys: wsTabs.map((t) => t.tabId),
    enabled: movable,
    onHold: (tabId) => {
      const tab = byId.get(tabId);
      if (tab) setSheet({ tab, name: name(tab) });
    },
    onMove: async (tabId, before) => {
      try {
        const res = await api.moveTab(tabId, before, session);
        if (res.ok) {
          onMoved?.();
          return true;
        }
        setStatus(res.error ?? "Move failed", "error");
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e), "error");
      }
      return false;
    },
  });
  if (wsTabs.length === 0) return null;

  const shown = reorder.order.map((tabId) => byId.get(tabId)!);
  const at = sheet ? reorder.order.indexOf(sheet.tab.tabId) : -1;

  return (
    <>
      <ChipStrip
        band="tabs"
        activeKey={selected}
        scrollerRef={scrollerRef}
        trail={
          <button type="button" onClick={() => onNewTab(workspaceId)} aria-label="New tab" className="strip-add">
            <Plus className="size-4" />
          </button>
        }
      >
        {shown.map((t) => {
          // What's going on in there (blocked / ready / working / idle); nothing for a tab with no agent,
          // since empty is not idle.
          const status = worstTriage(agents.filter((a) => a.tabId === t.tabId));
          return (
            <Chip
              key={t.tabId}
              label={name(t)}
              active={selected === t.tabId}
              focused={t.focused}
              status={status && TRIAGE_STATUS[status]}
              onClick={() => onSelect(t.tabId)}
              // Long-press, or a tap on the open tab, opens its actions when the parent wired them. A
              // read-only device's sheet holds only a note, so the open tab doesn't offer it. A movable
              // strip owns the hold itself: it lifts the chip, and the sheet opens on a release in place.
              onLongPress={actionsEnabled && !movable ? () => setSheet({ tab: t, name: name(t) }) : undefined}
              onTapActive={actionsEnabled && !readOnly ? () => setSheet({ tab: t, name: name(t) }) : undefined}
              reorderKey={movable ? t.tabId : undefined}
              lifted={reorder.lifted === t.tabId}
            />
          );
        })}
      </ChipStrip>

      {actionsEnabled && (
        <TabActionsSheet
          open={sheet !== null}
          onClose={() => setSheet(null)}
          tab={sheet?.tab ?? null}
          name={sheet?.name ?? ""}
          session={session}
          readOnly={readOnly}
          onRenamed={onRenamed}
          onClosed={onClosed}
          onMoveLeft={movable && sheet && at > 0 ? () => reorder.moveTo(sheet.tab.tabId, at - 1) : undefined}
          onMoveRight={movable && sheet && at >= 0 && at < reorder.order.length - 1 ? () => reorder.moveTo(sheet.tab.tabId, at + 1) : undefined}
        />
      )}
    </>
  );
}
