import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface ScrollToLatestProps {
  onClick: () => void;
  /** A question waits at the tail: the way back says so. */
  waiting?: boolean;
  /** Messages that arrived below while the reader was away; null when too many to count. */
  count?: number | null;
  /** Something below changed with no message to count (a turn ended, output moved): a dot. */
  changed?: boolean;
}

/** The way back is a labelled pill, centred, when it has something to say; a corner circle otherwise. */
export function scrollToLatestIsPill({ waiting = false, count = 0 }: Pick<ScrollToLatestProps, "waiting" | "count">): boolean {
  return waiting || count === null || count > 0;
}

// The way back to the live tail, floating over the list (a floating layer, so it takes the float
// shadow). With nothing new it is a quiet 44 px circle in the corner, as in Messages. New messages
// fill it with the accent and say how many; a question at the tail names itself, its dot the one red.
export function ScrollToLatest({ onClick, waiting = false, count = 0, changed = false }: ScrollToLatestProps) {
  const pill = scrollToLatestIsPill({ waiting, count });
  const fresh = pill && !waiting;
  return (
    <button type="button" onClick={onClick} aria-label="Scroll to latest"
      className={cn(
        "pointer-events-auto relative flex h-11 shrink-0 items-center justify-center rounded-full shadow-(--shadow-float) transition-[scale,background-color] duration-150 ease-out active:scale-[0.97] animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none motion-reduce:transition-none",
        pill ? "gap-1.5 px-4 text-footnote font-medium" : "w-11",
        fresh ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border bg-popover text-popover-foreground hover:bg-accent",
      )}>
      {waiting
        ? <><span aria-hidden className="size-2 rounded-full bg-status-blocked" />Waiting on you<ArrowDown aria-hidden="true" className="size-4" /></>
        : fresh
          ? <>{count === null ? "New messages" : `${count} new`}<ArrowDown aria-hidden="true" className="size-4" /></>
          : <>
            <ArrowDown aria-hidden="true" className="size-5" />
            {changed && <span aria-hidden className="absolute right-0 top-0 size-2.5 rounded-full bg-primary ring-2 ring-background" />}
          </>}
    </button>
  );
}
