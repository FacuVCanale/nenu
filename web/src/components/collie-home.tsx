import { cn } from "@/lib/utils";
import { DogGallop } from "@/components/dog-gallop";

interface CollieHomeProps {
  /** Return to the dashboard. */
  onHome?: () => void;
  /** Mobile chat uses the mark to open workspace navigation in the same header row. */
  label?: string;
  expanded?: boolean;
  /** The connection has been not-live for a sustained beat (useConnectionTrouble, ≥4s) — run the
   *  gallop sprite. Below that (healthy, or a single slow poll) the static app icon shows: the 4s
   *  delay is the flicker fix, so a normal polling hiccup never kicks the dog into a run. */
  trouble: boolean;
  /** The outage has passed the escalation threshold (useConnectionLost, ≥15s). The mark stops galloping
   *  and rests on the static app icon, muted — a galloping mark that never stops reads as "still trying"
   *  when we've in fact given up; the muted icon says "not connected" at a glance, matching the boot
   *  splash. (Never a gallop rest-frame — that full-stretch pose looks frozen mid-run.) */
  lost?: boolean;
  className?: string;
}

// The single, shared Nenu mark: brand + button + connection loader in one. At rest it's the familiar
// static app icon (favicon.svg); once the connection has been not-live for a sustained beat (`trouble`)
// it springs into the galloping sprite — until the outage escalates (`lost`), when it drops the gallop
// and rests on the SAME static icon, muted, then settles back to the full-color icon once live. The rest state is always the static icon,
// never a paused sprite: a gallop strip's rest frame is a full-stretch mid-stride pose that reads as
// frozen mid-run. On a phone it leads Home's header (and a chat's, until the chat's title opens the
// switcher), where tapping it opens navigation; every other screen leads with a back instead (AppHeader).
export function CollieHome({ onHome, label = "Nenu home", expanded, trouble, lost = false, className }: CollieHomeProps) {
  const gallop = trouble && !lost;
  return (
    <button
      type="button"
      onClick={onHome}
      // The gallop conveys connection state visually; fold it into the button's accessible name too,
      // so screen-reader and reduced-motion users get it (inside a pane there's no other cue).
      aria-label={!trouble ? label : lost ? `${label} — not connected` : `${label} — reconnecting`}
      aria-expanded={expanded}
      title={label}
      className={cn(
        "-mx-1 flex min-h-11 items-center gap-1.5 rounded px-1 transition-opacity active:opacity-70 sm:gap-2",
        className,
      )}
    >
      {/* A whitesmoke ring frames the mark so it reads as a deliberate badge against the dark header
          (the Nenu art is transparent, so it otherwise floats). The ring wraps every state so the
          frame doesn't pop in/out as the connection settles out of the gallop. */}
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-zinc-500/40 ring-1 ring-[whitesmoke]/60 sm:size-10">
        {gallop ? (
          <DogGallop running size="2rem" />
        ) : lost ? (
          // Escalated: the reconnect has run past the threshold — the dog rests on the static app icon,
          // muted (grayscale + dimmed) to read asleep/inactive, in the same box (no gallop). NOT a
          // paused sprite: a gallop rest-frame is a full-stretch mid-stride pose that looks frozen
          // mid-run — the "stuck mid-run" bug. Mirrors the boot splash's not-connected state.
          <img src="/nenu-mark.png" alt="" className="nenu-mark size-6 opacity-40 grayscale sm:size-8" />
        ) : (
          // Live rest state = the crisp Nenu mark, in the same box as the sprite so it doesn't resize
          // when the connection settles. Larger than the agent logo.
          <img src="/nenu-mark.png" alt="" className="nenu-mark size-6 sm:size-8" />
        )}
      </span>
    </button>
  );
}
