import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { isLocked, useLocked } from "@/lib/idle";
import { cn } from "@/lib/utils";
import { formatWorkDuration } from "@/lib/work-timeline";

/**
 * The time since `since` ("1m 37s", after `prefix`), or `fallback` without a usable start. Only this
 * text node ticks, so the transcript around it never re-renders for it; it stops while the page is
 * hidden or the idle lock is up and catches up when either ends.
 */
export function Elapsed({ since, prefix = "", fallback = "", className }: { since?: string; prefix?: string; fallback?: string; className?: string }) {
  const text = useRef<HTMLSpanElement>(null);
  const locked = useLocked();
  const start = since ? Date.parse(since) : NaN;
  const label = () => Number.isFinite(start) && start <= Date.now() ? `${prefix}${formatWorkDuration(Date.now() - start)}` : fallback;
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => { if (text.current) text.current.textContent = label(); };
    const sync = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      if (document.hidden || isLocked()) return;
      update();
      if (Number.isFinite(start)) timer = setInterval(update, 1000);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { if (timer) clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [since, prefix, fallback, locked]);
  return <span ref={text} className={cn("tabular-nums", className)}>{label()}</span>;
}

/** The live mark: a spinner, or a steady dot under reduced motion, so the state never rests on motion. */
export function LiveGlyph({ className }: { className?: string }) {
  return <span data-live-glyph aria-hidden="true" className={cn("inline-flex size-4 shrink-0 items-center justify-center text-status-working", className)}>
    <LoaderCircle className="size-full animate-spin motion-reduce:hidden" />
    <span className="hidden size-2 rounded-full bg-current motion-reduce:block" />
  </span>;
}

/** "Working for 1m 37s" with its live mark, where no turn line says it yet. */
export function WorkActivityLabel({ startedAt }: { startedAt?: string }) {
  return <span className="inline-flex items-center gap-1.5 text-footnote text-muted-foreground">
    <LiveGlyph className="size-3.5" />
    <Elapsed since={startedAt} prefix="Working for " fallback="Working…" />
  </span>;
}
