import { useState } from "react";
import { TerminalSquare } from "lucide-react";

import { SectionLabel } from "@/components/ui/section-label";
import { Chip, ChipStatus, ChipStrip } from "@/components/ui/chip";
import { PaneActionsSheet } from "@/components/pane-actions-sheet";
import { paneDisplayName } from "@/lib/types";
import type { AgentView } from "@/lib/types";

interface PaneStripProps {
  /** The panes that share the current tab (agents + shells), in stable order. */
  panes: AgentView[];
  currentPaneId: string;
  onSelect: (paneId: string) => void;
  /** Session scope for the long-press pane actions (rename/close); undefined = primary. */
  session?: string;
  /** Drop the long-press write actions when the device isn't authorised. */
  readOnly?: boolean;
  /** Revalidate after a rename. Long-press pane actions turn on only when this AND onClosed are set. */
  onRenamed?: () => void;
  /** Refresh after a close (DetailRoute moves off the open pane). Enables long-press with onRenamed. */
  onClosed?: (paneId: string) => void;
}

// The panes within the current tab, as a horizontal switcher one level below the tab bar
// (space › tab › pane). Mobile deliberately doesn't replicate the desktop's pane tiling — a tab can
// hold several panes, and this is just a quick way to flip between them. Rendered only when the tab
// actually holds more than one pane (a lone pane needs no switcher), so it's an optional extra row.
// A long-press on a pill, or a tap on the open one, opens its actions sheet (rename / close) when the
// parent wires the actions.
export function PaneStrip({
  panes,
  currentPaneId,
  onSelect,
  session,
  readOnly,
  onRenamed,
  onClosed,
}: PaneStripProps) {
  const [sheetPane, setSheetPane] = useState<AgentView | null>(null);
  // Actions need both callbacks wired (revalidate on rename, refresh on close); without them the
  // pills stay plain tap-to-switch — long-press is inert.
  const actionsEnabled = !!onRenamed && !!onClosed;

  if (panes.length < 2) return null;

  return (
    <>
      <ChipStrip band="panes" activeKey={currentPaneId} lead={<span className="hidden sm:inline"><SectionLabel>Panes</SectionLabel></span>}>
        {panes.map((p) => (
          <Chip
            key={p.paneId}
            label={paneDisplayName(p)}
            tag={p.paneId.split(":").pop()}
            active={p.paneId === currentPaneId}
            leading={p.kind === "shell" ? <TerminalSquare aria-hidden="true" className="size-3.5 shrink-0" /> : <ChipStatus status={p.status} />}
            onClick={() => onSelect(p.paneId)}
            onLongPress={actionsEnabled ? () => setSheetPane(p) : undefined}
            // A tap on the open pill would be a dead re-navigate; it opens the same sheet instead.
            onTapActive={actionsEnabled ? () => setSheetPane(p) : undefined}
          />
        ))}
      </ChipStrip>

      {actionsEnabled && (
        <PaneActionsSheet
          open={sheetPane !== null}
          onClose={() => setSheetPane(null)}
          pane={sheetPane}
          session={session}
          readOnly={readOnly}
          onRenamed={onRenamed}
          onClosed={onClosed}
        />
      )}
    </>
  );
}
