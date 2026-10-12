import { cn } from "@/lib/utils";

// The composer docks' one control surface: a tile raised off the dock's card, used by the Keys pad
// and the quick replies. The fill alone sits about 1.1:1 against the card in both themes, too faint to
// find a key by (the old tiles measured 1.02:1), so the 1px edge carries the 3:1 a control's boundary
// needs (WCAG 1.4.11). It borrows --switch-ring, the token index.css measures at 3:1 on the card for
// exactly that job.
export const DOCK_TILE = "border border-[color:var(--switch-ring)] bg-accent text-foreground";

/** A tile that just took a press: a step lighter in dark, darker in light, never the accent. */
export const DOCK_TILE_PRESSED = "bg-foreground/15 hover:bg-foreground/15";

// A segmented control (the Keys pads, Display's Chat text): a quiet track whose chosen segment takes
// the neutral selected fill navigation uses. The accent stays for on-states, like an armed key.
export const SEGMENT_TRACK = "grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1";

export function segmentClass(selected: boolean): string {
  return cn(
    "hit-area h-9 rounded-md px-2 text-subhead font-medium transition-colors duration-150 ease-out motion-reduce:transition-none",
    selected ? "bg-[var(--workbench-row-selected)] text-foreground" : "text-muted-foreground hover:text-foreground",
  );
}
