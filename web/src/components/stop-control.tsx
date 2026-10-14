import { Pending } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import type { StopTurn } from "@/hooks/use-stop-turn";

function StopGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className="!size-2.5">
      <rect width="10" height="10" rx="2" />
    </svg>
  );
}

/**
 * The composer's Stop, at the end of the "Working for …" row above the draft for as long as a turn
 * runs. It never takes the Send slot, so typing a draft never moves it under the thumb. Every phase
 * keeps the row's 32px height: "Really stop?" when the bridge asked, "Stopping…" in flight.
 */
export function StopControl({ stop, disabled }: { stop: StopTurn; disabled: boolean }) {
  if (stop.phase === "stopping") {
    return (
      <span role="status" className="composer-stop inline-flex items-center gap-1.5 text-muted-foreground">
        <Pending className="size-3.5" aria-hidden="true" />
        Stopping…
      </span>
    );
  }
  if (stop.armed) {
    return (
      <Button variant="destructive" className="composer-stop hit-area h-8 font-semibold" onClick={stop.stop} disabled={disabled}>
        Really stop?
      </Button>
    );
  }
  return (
    <Button type="button" variant="outline" className="composer-stop hit-area h-8 gap-1.5" onClick={stop.stop} disabled={disabled} aria-label="Stop" title="Stop (Esc)">
      <StopGlyph />Stop
    </Button>
  );
}
