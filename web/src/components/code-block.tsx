import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { WrapText } from "lucide-react";

import { CopyButton, QUIET_ACTION } from "@/components/copy-button";
import { cn } from "@/lib/utils";

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

  return (
    <div className="rounded-lg border bg-muted/50">
      <div className="flex h-8 items-center gap-2 border-b pr-0.5 pl-3">
        {lang && <span className="min-w-0 truncate text-caption text-muted-foreground">{lang}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" aria-pressed={wrap} onClick={() => setWrap((on) => !on)} className={QUIET_ACTION}>
            <WrapText aria-hidden="true" />
            Wrap
          </button>
          <CopyButton payload={() => ({ text })} />
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
