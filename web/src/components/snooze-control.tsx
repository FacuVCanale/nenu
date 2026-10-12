import { useState } from "react";
import { ChevronsUpDown, Loader2 } from "lucide-react";
import { useRevalidator } from "react-router";

import { listRowClass, listRowPressable } from "@/components/ui/list-group";
import { setSnooze } from "@/lib/api";
import { cn } from "@/lib/utils";

// "Do not disturb" for push: a global snooze. Server-enforced (the bridge sends nothing while a
// deadline is active and self-resumes), so it quiets every device — for when you're heads-down at
// the desk. State rides the snapshot (`snoozedUntil`), so it stays in sync across devices; after a
// change we revalidate to pull the new deadline straight back in.
//
// One row whose value is the current state, over a native <select>: the phone's own menu lists the
// pauses, as a Settings row does, instead of a strip of small buttons under a card.

const DURATIONS: ReadonlyArray<{ value: string; label: string; minutes: number }> = [
  { value: "30m", label: "For 30 minutes", minutes: 30 },
  { value: "1h", label: "For 1 hour", minutes: 60 },
  { value: "4h", label: "For 4 hours", minutes: 240 },
];
const MORNING = "morning";

/** The next 8:00 local time: this morning's while it is still before 8, otherwise tomorrow's. A
 *  pause picked at 1:00 must not swallow the whole next day. */
function nextMorning(now: number): number {
  const morning = new Date(now);
  morning.setHours(8, 0, 0, 0);
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  return morning.getTime();
}

/** The deadline a menu choice asks for: null turns the pause off, undefined is no known choice. */
function deadlineFor(choice: string, now: number): number | null | undefined {
  if (choice === "off") return null;
  if (choice === MORNING) return nextMorning(now);
  const duration = DURATIONS.find((d) => d.value === choice);
  return duration && now + duration.minutes * 60_000;
}

function untilLabel(deadline: number, now: number): string {
  const at = new Date(deadline);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (at.toDateString() === new Date(now).toDateString()) return `Until ${time}`;
  if (at.toDateString() === tomorrow.toDateString()) return `Until tomorrow, ${time}`;
  return `Until ${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function SnoozeControl({ snoozedUntil }: { snoozedUntil: number | null }) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const now = Date.now();
  const snoozed = snoozedUntil !== null && snoozedUntil > now;
  const value = snoozed ? untilLabel(snoozedUntil, now) : "Off";

  async function choose(choice: string) {
    const deadline = deadlineFor(choice, Date.now());
    if (deadline === undefined) return;
    setBusy(true);
    setFailed(false);
    try {
      await setSnooze(deadline);
      revalidator.revalidate();
    } catch {
      // The select snaps back to the live state on its own; say why nothing changed.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label
      className={cn(
        listRowClass,
        listRowPressable,
        "cursor-pointer has-[select:focus-visible]:outline-2 has-[select:focus-visible]:-outline-offset-2 has-[select:focus-visible]:outline-ring",
      )}
    >
      {/* The select carries the name and the value for assistive tech; these are its face. */}
      <span className="min-w-0 flex-1">
        <span aria-hidden="true" className="block text-body">
          Do not disturb
        </span>
        {failed && (
          <span role="alert" className="block text-footnote text-destructive">
            Couldn't save. Try again.
          </span>
        )}
      </span>
      <span aria-hidden="true" className="shrink-0 text-body text-muted-foreground tabular-nums">
        {value}
      </span>
      {busy ? (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
      ) : (
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
      )}
      <select
        aria-label="Do not disturb"
        value={snoozed ? "current" : "off"}
        disabled={busy}
        onChange={(event) => void choose(event.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        {/* The live deadline, so the menu opens on it and "Off" is a real change. */}
        {snoozed && (
          <option value="current" disabled hidden>
            {value}
          </option>
        )}
        <option value="off">Off</option>
        {DURATIONS.map((duration) => (
          <option key={duration.value} value={duration.value}>
            {duration.label}
          </option>
        ))}
        {/* Named by the time it ends, so the menu says whether that is this morning or tomorrow's. */}
        <option value={MORNING}>{untilLabel(nextMorning(now), now)}</option>
      </select>
    </label>
  );
}
