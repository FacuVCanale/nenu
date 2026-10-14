import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FileUp } from "lucide-react";

/**
 * Files dragged over `zone` (the chat, on a desk): returns where to draw the overlay while they are
 * over it, and hands what is dropped to `onFiles`. Enter and leave are counted, because each child
 * the drag crosses fires its own pair — WebKit sends no `relatedTarget` to tell them apart. A drag
 * that carries no files (text, a link) is left to the browser.
 */
export function useFileDrop(zone: RefObject<HTMLElement | null>, enabled: boolean, onFiles: (files: File[]) => void): DOMRect | null {
  const [over, setOver] = useState<DOMRect | null>(null);
  const handler = useRef(onFiles);
  handler.current = onFiles;
  useEffect(() => {
    const el = zone.current;
    if (!el || !enabled) return;
    let depth = 0;
    const carriesFiles = (e: DragEvent) => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes("Files"));
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (depth++ === 0) setOver(el.getBoundingClientRect());
    };
    const overZone = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      if (--depth <= 0) { depth = 0; setOver(null); }
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(null);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) handler.current(files);
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", overZone);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", overZone);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
      setOver(null);
    };
  }, [zone, enabled]);
  return over;
}

/**
 * What a drag over the chat shows: the zone outlined, the conversation dimmed under it, and one card
 * that says what dropping does. It never takes the pointer, so the zone keeps receiving the drag.
 * The browser names no file until the drop, so the card names none either.
 */
export function FileDropOverlay({ rect }: { rect: DOMRect }) {
  return createPortal(
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-50 grid place-items-center rounded-xl border border-dashed border-primary bg-background/75 p-4"
      style={{ top: rect.top + 12, left: rect.left + 12, width: Math.max(0, rect.width - 24), height: Math.max(0, rect.height - 24) }}
    >
      <div className="flex max-w-sm flex-col items-center gap-2 rounded-xl border border-border/70 bg-card px-8 py-7 text-center shadow-lg">
        <span className="mb-1 grid size-12 place-items-center rounded-lg bg-primary/15 text-primary">
          <FileUp className="size-5" />
        </span>
        <p className="text-subhead font-semibold">Drop to attach</p>
        <p className="text-footnote text-muted-foreground">Any file type, up to 25 MB each. The agent gets each file's path; nothing runs in Nenu.</p>
      </div>
    </div>,
    document.body,
  );
}
