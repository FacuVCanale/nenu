import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ExternalLink, Loader2 } from "lucide-react";

import { errorMessage } from "@/components/node-start";
import { BottomSheet } from "@/components/ui/sheet";
import { fetchPaneDiff } from "@/lib/api";
import type { DiffFile, DiffHunk, PaneDiff } from "@/lib/types";
import { cn } from "@/lib/utils";

type Read = { state: "loading" } | { state: "failed"; message: string } | { state: "read"; diff: PaneDiff };

const OMITTED: Record<NonNullable<DiffFile["omitted"]>, string> = {
  binary: "Binary file",
  large: "Too long to show here",
  budget: "Past the size limit",
};

/**
 * A pull request's diff, read from a pane's folder when it opens: the files with their counts, each
 * folded until tapped. Lines are text nodes; nothing is highlighted, parsed or run.
 */
export default function DiffViewer({ open, onClose, paneId, pr, session, url }: {
  open: boolean;
  onClose: () => void;
  paneId: string;
  pr: number;
  session?: string;
  url?: string;
}) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setRead({ state: "loading" });
    fetchPaneDiff(paneId, pr, session, controller.signal)
      .then((diff) => setRead({ state: "read", diff }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setRead({ state: "failed", message: errorMessage(error) }); });
    return () => controller.abort();
  }, [open, paneId, pr, session]);

  const github = url && <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground lg:min-h-8">
    <ExternalLink aria-hidden className="size-3" />Open on GitHub
  </a>;
  const diff = read.state === "read" ? read.diff : undefined;
  // A portal: the sheet is fixed to the viewport, and a row or bar it is opened from may not be.
  return createPortal(
    <BottomSheet open={open} onClose={onClose} title={`PR #${pr} changes`} desktop="dialog" bodyClassName="flex flex-col gap-2 px-0 pb-4">
      {read.state === "loading" && <p role="status" className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />Reading the diff…
      </p>}
      {read.state === "failed" && <div className="px-4"><p role="alert" className="text-sm">{read.message}</p>{github}</div>}
      {diff && !diff.ok && <div className="px-4"><p className="text-sm">{diff.message}</p>{github}</div>}
      {diff?.ok && <>
        <div className="flex flex-col gap-1 px-4 text-xs text-muted-foreground">
          <p className="text-[13px] text-foreground">
            <span>{diff.totals.files} {diff.totals.files === 1 ? "file" : "files"}</span>{" · "}
            <span className="font-mono tabular-nums"><span className="text-status-done">+{diff.totals.additions}</span> <span className="text-status-blocked">−{diff.totals.deletions}</span></span>
          </p>
          <p className="break-words">{diff.source === "worktree"
            ? <>This thread's worktree on <code className="font-mono">{diff.head}</code>, uncommitted edits included, against <code className="font-mono">{diff.base}</code>.</>
            : <>The pushed branch <code className="font-mono">{diff.head}</code>, against <code className="font-mono">{diff.base}</code>.</>}</p>
          {diff.truncated?.files && <p className="text-foreground">Showing {diff.files.length} of {diff.totals.files} files.</p>}
          {diff.truncated?.bytes && <p className="text-foreground">The diff is over the size limit: files further down show their counts only.</p>}
          {github}
        </div>
        {diff.files.length === 0
          ? <p className="px-4 text-sm text-muted-foreground">No changes against the base branch.</p>
          : <ul className="border-t border-border/60">{diff.files.map((file) => <FileRow key={`${file.from ?? ""}\0${file.path}`} file={file} />)}</ul>}
      </>}
    </BottomSheet>,
    document.body,
  );
}

function FileRow({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(false);
  const lines = !!file.hunks?.length;
  const slash = file.path.lastIndexOf("/") + 1;
  const note = file.omitted ? OMITTED[file.omitted]
    : !lines ? (file.status === "renamed" ? "Renamed, no line changes" : "No line changes") : undefined;
  const status = file.status === "added" ? "new" : file.status === "deleted" ? "deleted" : undefined;
  return (
    <li className="border-b border-border/60">
      <button type="button" aria-expanded={lines ? open : undefined} disabled={!lines} onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-start gap-2 px-4 py-2 text-left disabled:cursor-default lg:min-h-9">
        <ChevronRight aria-hidden className={cn("mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-90", !lines && "invisible")} />
        <span className="min-w-0 flex-1">
          <span className="block break-all font-mono text-xs">
            {file.from && <span className="text-muted-foreground">{file.from} → </span>}
            <span className="text-muted-foreground">{file.path.slice(0, slash)}</span>{file.path.slice(slash)}
          </span>
          {(note || status) && <span className="block text-[11.5px] text-muted-foreground">{[status, note].filter(Boolean).join(" · ")}</span>}
        </span>
        {!file.binary && <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-status-done">+{file.additions}</span> <span className="text-status-blocked">−{file.deletions}</span>
        </span>}
      </button>
      {open && file.hunks && <div className="overflow-x-auto border-t border-border/60">
        <div className="inline-block min-w-full font-mono text-[12px] leading-5">
          {file.hunks.map((hunk, index) => <Hunk key={index} hunk={hunk} />)}
        </div>
      </div>}
    </li>
  );
}

/** A hunk's rows, numbered on the side that has the line: the new file's, or the old one's for a removal. */
function Hunk({ hunk }: { hunk: DiffHunk }) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return <>
    <div className="whitespace-pre bg-muted/60 px-4 text-muted-foreground">{hunk.header}</div>
    {hunk.lines.map((line, index) => {
      const mark = line[0];
      const number = mark === "+" ? newLine++ : mark === "-" ? oldLine++ : mark === " " ? (oldLine++, newLine++) : undefined;
      return (
        <div key={index} className={cn("flex", mark === "+" && "bg-status-done/15", mark === "-" && "bg-status-blocked/15")}>
          <span aria-hidden className="w-11 shrink-0 select-none pr-2 text-right text-muted-foreground/70">{number}</span>
          <span className={cn("w-4 shrink-0 select-none", mark === "+" ? "text-status-done" : "text-status-blocked")}>{mark === "+" || mark === "-" ? mark : ""}</span>
          <span className={cn("whitespace-pre pr-4", mark === "\\" && "italic text-muted-foreground")}>{line.slice(mark === "\\" ? 2 : 1) || " "}</span>
        </div>
      );
    })}
  </>;
}
