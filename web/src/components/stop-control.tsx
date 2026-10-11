import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { StopTurn } from "@/hooks/use-stop-turn";
import { cn } from "@/lib/utils";

function StopGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className="!size-2.5">
      <rect width="10" height="10" rx="2" />
    </svg>
  );
}

/**
 * The composer's Stop: the round primary button while nothing is typed, or (`compact`) a small
 * "■ Stop" on the "Working for …" row while a draft holds the round button for Send. Either way,
 * "Really stop?" when the bridge asked and "Stopping…" in flight.
 */
export function StopControl({ stop, disabled, compact = false }: { stop: StopTurn; disabled: boolean; compact?: boolean }) {
  if (stop.phase === "stopping") {
    return (
      <span role="status" className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full text-xs text-muted-foreground", compact ? "h-7 px-2" : "h-8 border border-border px-3")}>
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Stopping…
      </span>
    );
  }
  if (stop.armed) {
    return (
      <Button variant="destructive" className={cn("hit-area shrink-0 rounded-full px-3 text-xs font-semibold", compact ? "h-7" : "h-8")} onClick={stop.stop} disabled={disabled}>
        Really stop?
      </Button>
    );
  }
  if (compact) {
    return (
      <Button type="button" variant="ghost" className="hit-area h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-medium" onClick={stop.stop} disabled={disabled} aria-label="Stop" title="Stop">
        <StopGlyph />Stop
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" className="composer-action composer-stop hit-area" onClick={stop.stop} disabled={disabled} aria-label="Stop" title="Stop (Esc)">
      <StopGlyph />
    </Button>
  );
}
