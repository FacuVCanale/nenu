import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, WrapText } from "lucide-react";

import { cn } from "@/lib/utils";

const CONFIRM_MS = 2000;
const COPY_LABEL = { idle: "Copy", copied: "Copied", failed: "Copy failed" } as const;

const HEADER_BUTTON = "hit-area inline-flex h-7 select-none items-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground [&_svg]:size-3.5";

/**
 * A fenced block from agent prose: a 32px header with the language, Wrap and Copy over the code at
 * the code step of the type scale. A line too long for the column scrolls sideways, and the right
 * edge fades while part of a line is hidden past it, so a cut line never reads as a whole one.
 * `text` is what Copy writes; `children` is the same text as drawn (find hits marked).
 */
export function CodeBlock({ lang, text, children }: { lang: string; text: string; children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [wrap, setWrap] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [copy, setCopy] = useState<keyof typeof COPY_LABEL>("idle");

  // One pixel of slack: a fractional scroll position can stop just short of the end.
  const measure = useCallback(() => {
    const el = pre.current;
    if (el) setClipped(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);
  useLayoutEffect(() => measure(), [measure, wrap, text]);
  useEffect(() => {
    const el = pre.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  // The write starts inside the tap itself: Safari refuses a clipboard write the gesture no longer
  // covers. Outside a secure context there is no navigator.clipboard, and that lands in "failed" too.
  const onCopy = () => {
    let write: Promise<void>;
    try {
      write = navigator.clipboard.writeText(text);
    } catch (error) {
      write = Promise.reject(error);
    }
    write.then(() => setCopy("copied"), () => setCopy("failed"));
  };

  return (
    <div className="rounded-lg border bg-muted/50">
      <div className="flex h-8 items-center gap-2 border-b pr-0.5 pl-3">
        {lang && <span className="min-w-0 truncate text-caption text-muted-foreground">{lang}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-pressed={wrap} onClick={() => setWrap((on) => !on)} className={HEADER_BUTTON}>
            <WrapText aria-hidden="true" />
            Wrap
          </button>
          <button type="button" onClick={onCopy} className={HEADER_BUTTON}>
            {copy === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {/* As wide as "Copied" from the start, so the confirmation does not move Wrap under the finger. */}
            <span className="grid justify-items-center">
              <span aria-live="polite" className="col-start-1 row-start-1">{COPY_LABEL[copy]}</span>
              <span aria-hidden="true" className="invisible col-start-1 row-start-1">{COPY_LABEL.copied}</span>
            </span>
          </button>
        </div>
      </div>
      <pre
        ref={pre}
        onScroll={measure}
        data-clipped={clipped || undefined}
        className={cn(
          "overflow-x-auto rounded-b-lg px-3 py-2.5 font-mono text-code",
          "data-clipped:[mask-image:linear-gradient(to_left,transparent,#000_1.5rem)]",
          wrap ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "whitespace-pre",
        )}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}
