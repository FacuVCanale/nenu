import { useEffect, useState } from "react";
import { Check, Copy } from "@/components/ui/icon";

const CONFIRM_MS = 2000;
const COPY_LABEL = { idle: "Copy", copied: "Copied", failed: "Failed" } as const;

// A quiet text action beside what it acts on (a code block's Wrap and Copy, a message's and a table's
// Copy). Pressed and the press itself take the neutral selected fill the nav rows use: --accent all
// but vanished on a code block's muted header in light (244 on 248).
export const QUIET_ACTION = "hit-area inline-flex h-7 select-none items-center gap-1.5 rounded-md px-2 text-caption text-muted-foreground transition-colors hover:bg-[var(--workbench-row-hover)] hover:text-foreground active:bg-[var(--workbench-row-selected)] aria-pressed:bg-[var(--workbench-row-selected)] aria-pressed:text-foreground [&_svg]:size-3.5";

/** What a Copy writes: text, and optionally the same thing as HTML for a paste that keeps structure. */
export interface CopyPayload {
  text: string;
  html?: string;
}

// The write starts inside the tap itself: Safari refuses a clipboard write the gesture no longer
// covers. Outside a secure context there is no navigator.clipboard, and that lands in "failed" too.
function writeClipboard({ text, html }: CopyPayload): Promise<void> {
  try {
    if (html !== undefined && typeof ClipboardItem !== "undefined" && typeof navigator.clipboard.write === "function") {
      return navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
    }
    return navigator.clipboard.writeText(text);
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * Copy, then Copied (or Failed) for two seconds. It is as wide as its widest word from the start, so
 * the answer never moves what sits beside it. `what` names the thing copied ("Copy table") where a
 * page holds several; `payload` is read at the tap. `iconOnly` draws the icon alone (a message's
 * quiet action): Copied shows as a check, and only a failure puts its word beside it.
 */
export function CopyButton({ payload, what, className = QUIET_ACTION, iconOnly = false }: { payload: () => CopyPayload; what?: string; className?: string; iconOnly?: boolean }) {
  const [state, setState] = useState<keyof typeof COPY_LABEL>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = () => writeClipboard(payload()).then(() => setState("copied"), () => setState("failed"));
  const icon = state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />;
  if (iconOnly) return (
    <button type="button" aria-label={state === "idle" ? (what ? `Copy ${what}` : "Copy") : COPY_LABEL[state]} className={className} onClick={copy}>
      {icon}
      {state === "failed" ? <span aria-live="polite">{COPY_LABEL.failed}</span> : <span aria-live="polite" className="sr-only">{state === "copied" ? COPY_LABEL.copied : ""}</span>}
    </button>
  );
  return (
    <button type="button" aria-label={what && state === "idle" ? `Copy ${what}` : undefined} className={className} onClick={copy}>
      {icon}
      <span className="grid justify-items-center">
        <span aria-live="polite" className="col-start-1 row-start-1">{COPY_LABEL[state]}</span>
        {Object.values(COPY_LABEL).map((label) => (
          <span key={label} aria-hidden="true" className="invisible col-start-1 row-start-1">{label}</span>
        ))}
      </span>
    </button>
  );
}
