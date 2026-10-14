import { lazy, Suspense, useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// The viewer is its own chunk: nothing of it loads until a size is tapped.
const DiffViewer = lazy(() => import("./diff-viewer"));

/**
 * A pull request's size, "+N −M". Given the pane it can be read from and the PR's number, it is a
 * button that opens the PR's files and hunks; the diff is read then, once per opening, and let go
 * after it closes.
 */
export function DiffStat({ diff, paneId, pr, session, url, className }: {
  diff: { additions: number; deletions: number };
  paneId?: string;
  pr?: number;
  session?: string;
  url?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open || !mounted) return;
    // Closed: drop the viewer and the diff it holds once its exit has played.
    const timer = setTimeout(() => setMounted(false), 1_000);
    return () => clearTimeout(timer);
  }, [open, mounted]);
  const size = <><span className="text-status-done">+{diff.additions}</span> <span className="text-status-blocked">−{diff.deletions}</span></>;
  if (!paneId || pr === undefined) return <span className={cn("shrink-0 font-mono tabular-nums", className)}>{size}</span>;
  return <>
    <button type="button" aria-label={`View changes: ${diff.additions} added, ${diff.deletions} removed`}
      onClick={() => { setMounted(true); setOpen(true); }}
      className={cn("relative shrink-0 rounded-md font-mono tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:decoration-current",
        "after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] lg:after:hidden", className)}>
      {size}
    </button>
    {mounted && <Suspense fallback={null}>
      <DiffViewer open={open} onClose={() => setOpen(false)} paneId={paneId} pr={pr} session={session} url={url} />
    </Suspense>}
  </>;
}
