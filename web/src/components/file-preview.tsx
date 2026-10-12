import { lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Copy, Download, FileText, Globe, ImageIcon, Loader2, MoreHorizontal, RefreshCw, X } from "lucide-react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { fetchArtifactMetadata, fetchPaneFile, journalImageUrl, PaneFileError, paneFileUrl } from "@/lib/api";
import { displayPath } from "@/lib/display-path";
import { paneOwningPath, type PaneRoot } from "@/lib/file-links";
import { FilePreviewContext } from "@/lib/file-preview-context";
import { useHoldReload } from "@/lib/reload-guard";
import { cn } from "@/lib/utils";
import { ActionGroups } from "./conversation-actions";
import { MarkdownText } from "./markdown-text";
import { HtmlViewer } from "./html-viewer";
import { FileUnavailable, type FileFailure } from "./file-unavailable";
import { WorkbenchPopover } from "./ui/workbench-popover";
import type { PreviewItem } from "./file-preview-provider";
import "./file-preview.css";

const PdfPreview = lazy(() => import("./pdf-preview"));
type DocumentData = { kind: "video"; url: string } | { kind: "pdf"; bytes: ArrayBuffer; url: string } | { kind: "image"; url: string } | { kind: "text"; text: string; markdown: boolean; url: string };

const isHtml = (item: PreviewItem | undefined) => item?.kind === "file" && /\.html?$/i.test(item.path);
const keyOf = (item: PreviewItem | undefined) => item?.kind === "journal" ? `journal:${item.entry}:${item.index}` : `file:${item?.path ?? ""}`;
const fileName = (path: string) => path.split("/").pop() || "Document";

/** How long the layer stays mounted for its exit: a fade, or nothing where motion is off. */
function exitMs(): number {
  if (typeof window.matchMedia !== "function") return 0;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 150;
}

/**
 * The line under a file's name: its path from the folder of the pane it is read through, cut in the
 * middle to `max` characters (lib/display-path.ts). A file at the top of that folder needs no line,
 * the name already says it all; a name too long to share the line leaves it to the folder.
 */
function whereLine(path: string, cwd: string | undefined, name: string, from: string, max: number): string {
  const { dir, base } = displayPath(path, cwd, max);
  const where = dir + base === name ? "" : (dir + base).length > max ? displayPath(path, cwd, max + base.length + 1).dir : dir + base;
  return [where, from && `from ${from}`].filter(Boolean).join(" · ");
}

/**
 * A file name cut in the middle to `max` characters, keeping its start and its extension. CSS can only
 * cut the end, which hid the extension, and an ellipsis on a separate stem left a gap before it.
 */
function shortName(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  return `${name.slice(0, Math.max(1, max - extension.length - 1))}…${extension}`;
}

let canvas: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return 0;
  canvas.font = font;
  return canvas.measureText(text).width;
}

/**
 * `cut(n)` for the largest `n` whose text fits the line's width in the font `ref` is drawn with: a
 * character count guesses wrong both ways, "reporte-auditoria.html" fits a phone's bar at 22 and a
 * name of wide letters does not. Where nothing can be measured, `fallback` characters.
 */
function useFitted(ref: RefObject<HTMLElement | null>, line: RefObject<HTMLElement | null>, full: string, cut: (max: number) => string, fallback: number): string {
  const [max, setMax] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current, box = line.current;
    if (!element || !box) return;
    const fit = () => {
      const width = box.clientWidth;
      if (!width) return setMax(fallback);
      const { fontStyle, fontWeight, fontSize, fontFamily } = getComputedStyle(element);
      const font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
      let n = full.length;
      while (n > 1 && textWidth(cut(n), font) > width) n--;
      setMax(n);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(box);
    return () => observer?.disconnect();
    // `cut` is rebuilt every render; `full` and `fallback` are what it depends on.
  }, [full, fallback]);
  return cut(max);
}

export default function FilePreview({ paneId, session, items, start = 0, path, panes = [], onClose }: {
  paneId: string;
  session?: string;
  /** Live panes, so a file beyond this pane's folder can be opened from the pane that holds it. */
  panes?: readonly PaneRoot[];
  /** A gallery to step through; `path` is the one-file shorthand. */
  items?: readonly PreviewItem[];
  start?: number;
  path?: string;
  onClose: () => void;
}) {
  useHoldReload("document-preview", true);
  const list: readonly PreviewItem[] = items ?? (path ? [{ kind: "file", path }] : []);
  const [index, setIndex] = useState(start);
  const at = Math.min(index, list.length - 1);
  const item = list[at];
  const [data, setData] = useState<DocumentData | null>(null);
  const [error, setError] = useState<FileFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const whereRef = useRef<HTMLParagraphElement>(null);
  const exit = useRef(0);
  const narrow = useMediaQuery("(max-width: 639px)");
  const openFile = useContext(FilePreviewContext);
  const itemKey = keyOf(item);
  // A name the pane's folder lacks can live in a folder the conversation names (a summary recapping
  // another repo, a scratchpad): where the bridge found it, for this item only.
  const [moved, setMoved] = useState<{ itemKey: string; path: string } | null>(null);
  const shown = useRef(itemKey);
  shown.current = itemKey;
  const filePath = item?.kind !== "file" ? "" : moved?.itemKey === itemKey ? moved.path : item.path;
  const openRelated = openFile ? (target: string) => openFile(target.startsWith("/") ? target : filePath.slice(0, filePath.lastIndexOf("/") + 1) + target) : null;
  const name = item?.kind === "journal" ? item.label : fileName(filePath);
  const html = isHtml(item);
  // The pane this item is read through: the open one, unless the operator chose the pane whose
  // folder holds it. The choice belongs to one item, so stepping the gallery drops it.
  const [from, setFrom] = useState<{ itemKey: string; paneId: string } | null>(null);
  const source = from?.itemKey === itemKey ? from.paneId : paneId;
  const owner = error?.outside ? paneOwningPath(panes, filePath, source) : undefined;
  const sourceLabel = source === paneId ? "" : panes.find((pane) => pane.paneId === source)?.label ?? source;
  const fail = (cause: unknown) => {
    const failure: FileFailure = cause instanceof PaneFileError
      ? { message: cause.message, outside: cause.outside, status: cause.status }
      : { message: cause instanceof Error ? cause.message : "Could not open this file.", outside: false };
    // Inside the folder by name and not there: ask the bridge where the name leads before saying so.
    if (failure.status !== 404 || failure.outside || !filePath) return setError(failure);
    const key = itemKey;
    fetchArtifactMetadata(source, [filePath], session).then(([found]) => {
      if (shown.current !== key) return;
      if (found?.state === "missing") setError({ message: "File not found.", outside: false, status: 404 });
      else if (found?.resolved && found.resolved !== filePath) setMoved({ itemKey: key, path: found.resolved });
      else setError(failure);
    }, () => { if (shown.current === key) setError(failure); });
  };

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    setError(null); setData(null);
    if (!item || html) return;
    if (item.kind === "journal") { setData({ kind: "image", url: journalImageUrl(paneId, item.entry, item.index, session) }); return; }
    if (/\.(mp4|m4v|mov|webm)$/i.test(filePath)) { setData({ kind: "video", url: paneFileUrl(source, filePath, session) }); return; }
    void (async () => {
      const response = await fetchPaneFile(source, filePath, session, controller.signal);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      const type = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (type === "application/pdf") {
        const bytes = await blob.arrayBuffer();
        if (!controller.signal.aborted) setData({ kind: "pdf", bytes, url });
      } else if (/^image\/(png|jpeg|gif|webp)$/.test(type)) setData({ kind: "image", url });
      else if (type.startsWith("text/")) {
        const text = await blob.text();
        if (!controller.signal.aborted) setData({ kind: "text", text, markdown: /\.(md|markdown)$/i.test(filePath), url });
      } else throw new Error("This file type cannot be previewed.");
    })().catch((cause: unknown) => { if (!controller.signal.aborted) fail(cause); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
    // itemKey and filePath name the item; the object itself is rebuilt on every render of a one-file preview.
  }, [paneId, source, session, itemKey, filePath, html, attempt]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(exit.current);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  /** Leave with the layer still mounted for its exit, then unmount. */
  const close = () => {
    if (exit.current) return;
    const ms = exitMs();
    if (!ms) return onClose();
    setLeaving(true);
    exit.current = window.setTimeout(onClose, ms);
  };

  const copyPath = async () => {
    try { await navigator.clipboard.writeText(filePath); setCopied(true); } catch { setCopied(false); }
  };

  const step = (by: number) => setIndex((current) => (current + by + list.length) % list.length);
  const downloadUrl = error ? undefined : data?.url ?? (html ? paneFileUrl(source, filePath, session) : undefined);
  const failure = error && <FileUnavailable failure={error} path={filePath} paneId={source} session={session} owner={owner} onRetry={() => setAttempt((value) => value + 1)}
    onOpenFrom={(paneId) => setFrom({ itemKey, paneId })} />;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!menu) return close();
      setMenu(false);
      more.current?.focus({ preventScroll: true });
      return;
    }
    if (list.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1); }
    if (event.key === "Tab") {
      // Done and Close trade places by width; only the one on screen takes focus.
      const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') ?? [])
        .filter((control) => control.checkVisibility?.() ?? control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus({ preventScroll: true }); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus({ preventScroll: true }); }
    }
  };

  const cwd = panes.find((pane) => pane.paneId === source)?.cwd;
  const title = useFitted(titleRef, heading, name, (max) => shortName(name, max), narrow ? 21 : 80);
  const fullWhere = whereLine(filePath, cwd, name, sourceLabel, Infinity);
  const where = useFitted(whereRef, heading, fullWhere, (max) => whereLine(filePath, cwd, name, sourceLabel, max), narrow ? 28 : 96);
  const Icon = html ? Globe : item?.kind === "journal" ? ImageIcon : FileText;

  return createPortal(<div className="file-preview-backdrop" data-leaving={leaving ? "" : undefined}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} onKeyDown={onKeyDown}
      className={cn("file-preview-panel", html && "file-preview-panel--full")}>
        <header className="file-preview-header">
          <button type="button" className="preview-done" onClick={close}><ChevronLeft className="size-6" aria-hidden="true" />Done</button>
          <Icon className="file-preview-kind size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div ref={heading} className="file-preview-heading">
            <h2 ref={titleRef} className="file-preview-title" aria-label={title === name ? undefined : name} title={title === name ? undefined : name}>{title}</h2>
            {where && <p ref={whereRef} className="file-preview-subtitle" title={filePath || undefined}>{where}</p>}
          </div>
          <div className="file-preview-actions">
            {downloadUrl && <a href={downloadUrl} download={name} aria-label="Download file" className="file-preview-action"><Download className="size-5" aria-hidden="true" /></a>}
            <button ref={more} type="button" aria-label="More actions" aria-haspopup="dialog" aria-expanded={menu} className="file-preview-action"
              onClick={() => { setCopied(false); setMenu(!menu); }}><MoreHorizontal className="size-5" aria-hidden="true" /></button>
            <button type="button" aria-label="Close document" onClick={close} className="file-preview-action preview-close"><X className="size-5" aria-hidden="true" /></button>
          </div>
          <WorkbenchPopover open={menu} onDismiss={() => setMenu(false)} anchorRef={more} label="More actions" className="w-56 [&>div:first-child]:hidden [&>div:last-child]:p-1.5">
            <ActionGroups onRun={(action) => action()} groups={[{ label: "More actions", actions: [
              { id: "reload", label: "Reload", icon: RefreshCw, run: () => { setMenu(false); setAttempt((value) => value + 1); } },
              { id: "copy", label: copied ? "Copied path" : "Copy path", icon: copied ? Check : Copy, run: () => void copyPath() },
            ] }]} />
          </WorkbenchPopover>
        </header>
        {error ? <div className="file-preview-content">{failure}</div>
          : html ? <HtmlViewer paneId={source} session={session} path={filePath} name={name} reload={attempt} onError={fail} />
          : <div className="file-preview-content">
            <DocumentContent data={data} name={name} openRelated={openRelated} onError={(message) => setError({ message, outside: false })} />
          </div>}
        {list.length > 1 && <nav aria-label="Gallery" className="file-preview-gallery">
          <button type="button" aria-label="Previous" onClick={() => step(-1)} className="file-preview-action"><ChevronLeft className="size-5" /></button>
          <span aria-live="polite" className="min-w-28 text-center text-sm">{name} <span className="text-muted-foreground">· {at + 1} of {list.length}</span></span>
          <button type="button" aria-label="Next" onClick={() => step(1)} className="file-preview-action"><ChevronRight className="size-5" /></button>
        </nav>}
    </div>
  </div>, document.body);
}

function DocumentContent({ data, name, openRelated, onError }: { data: DocumentData | null; name: string; openRelated: ((path: string) => void) | null; onError: (message: string) => void }) {
  if (!data) return <Loading />;
  switch (data.kind) {
    case "pdf":
      return <Suspense fallback={<Loading />}><PdfPreview bytes={data.bytes} /></Suspense>;
    case "video":
      return <video src={data.url} controls playsInline preload="metadata" aria-label={name} className="max-h-full w-full" onError={() => onError("Could not play this video. Download it to open in another player.")} />;
    case "image":
      return <img src={data.url} alt={name} decoding="async" className="mx-auto h-auto max-w-full" onError={() => onError("Could not load this image.")} />;
    case "text":
      if (!data.markdown) return <pre className="overflow-x-auto p-5 font-mono text-sm whitespace-pre">{data.text}</pre>;
      return <FilePreviewContext.Provider value={openRelated}>
        <MarkdownText text={data.text} className="mx-auto max-w-3xl p-5 sm:p-8" />
      </FilePreviewContext.Provider>;
  }
}

function Loading() { return <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />Loading document…</div>; }
