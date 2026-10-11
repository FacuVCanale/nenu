import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { StopTurn } from "@/hooks/use-stop-turn";

/** The composer's Stop: a round button, "Really stop?" when the bridge asked, "Stopping…" in flight. */
export function StopControl({ stop, disabled }: { stop: StopTurn; disabled: boolean }) {
  if (stop.phase === "stopping") {
    return (
      <span role="status" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Stopping…
      </span>
    );
  }
  if (stop.armed) {
    return (
      <Button variant="destructive" className="hit-area h-8 shrink-0 rounded-full px-3 text-xs font-semibold" onClick={stop.stop} disabled={disabled}>
        Really stop?
      </Button>
    );
  }
  return (
    <Button type="button" variant="ghost" size="icon" className="composer-action composer-stop hit-area" onClick={stop.stop} disabled={disabled} aria-label="Stop" title="Stop (Esc)">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className="!size-2.5">
        <rect width="10" height="10" rx="2" />
      </svg>
    </Button>
  );
}
