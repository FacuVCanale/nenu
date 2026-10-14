import { cn } from "@/lib/utils";

interface CollieHomeProps {
  /** Opens navigation (or the caller's action outside the workbench). */
  onHome?: () => void;
  /** Mobile chat uses the mark to open workspace navigation in the same header row. */
  label?: string;
  expanded?: boolean;
  /** The outage has passed the escalation threshold (useConnectionLost, ≥15s): the mark rests on the
   *  static app icon, muted, so "not connected" reads at a glance, matching the boot splash. */
  lost?: boolean;
  className?: string;
}

// The single, shared Nenu mark: brand + button + connection state in one. It is always the static
// app icon, muted while the connection is lost, and never moves. On a phone it leads Home's header
// (and a chat's, until the chat's title opens the switcher), where tapping it opens navigation; every
// other screen leads with a back instead (AppHeader).
export function CollieHome({ onHome, label = "Nenu home", expanded, lost = false, className }: CollieHomeProps) {
  return (
    <button
      type="button"
      onClick={onHome}
      // The muted mark conveys connection state visually; fold it into the button's accessible name
      // too, so screen-reader users get it (inside a pane there's no other cue).
      aria-label={lost ? `${label} — not connected` : label}
      aria-expanded={expanded}
      title={label}
      className={cn(
        "-mx-1 flex min-h-11 items-center gap-1.5 rounded px-1 transition-opacity active:opacity-70 sm:gap-2",
        className,
      )}
    >
      {/* A whitesmoke ring frames the mark so it reads as a deliberate badge against the dark header
          (the Nenu art is transparent, so it otherwise floats). */}
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-500/40 ring-1 ring-[whitesmoke]/60 sm:size-10">
        <img src="/nenu-mark.png" alt="" className={cn("nenu-mark size-6 sm:size-8", lost && "opacity-40 grayscale")} />
      </span>
    </button>
  );
}
