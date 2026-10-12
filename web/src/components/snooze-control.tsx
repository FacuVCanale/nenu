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

const PAUSES: ReadonlyArray<{ value: string; label: string; until: (now: number) => number }> = [
  { value: "30m", label: "For 30 minutes", until: (now) => now + 30 * 60_000 },
  { value: "1h", label: "For 1 hour", until: (now) => now + 60 * 60_000 },
  { value: "4h", label: "For 4 hours", until: (now) => now + 240 * 60_000 },
  { value: "tomorrow", label: "Until tomorrow", until: tomorrowMorning },
];

/** 8:00 the next calendar day, local time. */
function tomorrowMorning(now: number): number {
  const morning = new Date(now);
  morning.setDate(morning.getDate() + 1);
  morning.setHours(8, 0, 0, 0);
  return morning.getTime();
}

function untilLabel(deadline: number, now: number): string {
  const at = new Date(deadline);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === new Date(now).toDateString()) return `Until ${time}`;
  if (at.toDateString() === new Date(tomorrowMorning(now)).toDateString()) return `Until tomorrow, ${time}`;
  return `Until ${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function SnoozeControl({ snoozedUntil }: { snoozedUntil: number | null }) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  const snoozed = snoozedUntil !== null && snoozedUntil > now;
  const value = snoozed ? untilLabel(snoozedUntil, now) : "Off";

  async function choose(choice: string) {
    const pause = PAUSES.find((p) => p.value === choice);
    if (choice !== "off" && !pause) return;
    setBusy(true);
    try {
      await setSnooze(pause ? pause.until(Date.now()) : null);
      revalidator.revalidate();
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
      <span aria-hidden="true" className="min-w-0 flex-1 text-body">
        Do not disturb
      </span>
      <span aria-hidden="true" className="shrink-0 text-body text-muted-foreground tabular-nums">
        {value}
      </span>
      {busy ? (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />
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
        {PAUSES.map((pause) => (
          <option key={pause.value} value={pause.value}>
            {pause.label}
          </option>
        ))}
      </select>
    </label>
  );
}
