import { useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, Clock, Loader2, MoreHorizontal, type LucideIcon } from "lucide-react";

import { ActionGroups } from "@/components/conversation-actions";
import { MarkdownText } from "@/components/markdown-text";
import { MessageImages } from "@/components/message-images";
import { WorkbenchPopover } from "@/components/ui/workbench-popover";
import type { queueRowStatus } from "@/hooks/use-message-queue";
import { splitMessageImages } from "@/lib/message-images";
import { cn } from "@/lib/utils";

// One tone vocabulary for both devices: the queue's own status decides it (hooks/use-message-queue.ts).
export type QueuedTone = ReturnType<typeof queueRowStatus>["tone"];

export interface QueuedAction {
  id: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
  disabled?: boolean;
  /** An accessible name that says more than the visible label (it must still contain it). */
  name?: string;
  /** A first tap that only arms a confirm: drawn in the destructive tone. */
  armed?: boolean;
}

const TONE_ICON: Record<Exclude<QueuedTone, "waiting">, ReactNode> = {
  busy: <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />,
  done: <Check aria-hidden="true" className="size-3.5 shrink-0" />,
  problem: <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />,
};

/**
 * One of the operator's own messages that has not reached the conversation yet, drawn the same way
 * whether this device queued it (the bubble at the end of the chat) or another one did (the rows
 * above the composer): the bubble, a status line under it and one trailing ⋯ of 44px. A message
 * waiting in a queue wears a Queued badge; managing it (Send now, Edit, Remove) lives behind the ⋯
 * so the line never wraps a button onto a row of its own. A remedy for the state it is in (Retry,
 * Open Terminal, Read it now) stays on the line, next to the words that call for it.
 */
export function QueuedMessage({
  text,
  tone,
  label,
  device,
  menuLabel,
  menu,
  remedies = [],
  editor,
  clamp = false,
}: {
  /** The wire text: prose plus image paths. */
  text: string;
  tone: QueuedTone;
  label: string;
  /** The device that queued it, when it was not this one. */
  device?: string;
  /** The ⋯ button's accessible name. */
  menuLabel: string;
  menu: QueuedAction[];
  remedies?: QueuedAction[];
  /** Replaces the bubble's text while the message is edited in place. */
  editor?: ReactNode;
  /** Shows the first three lines only, where the rows share a short strip above the composer. */
  clamp?: boolean;
}) {
  const { text: prose, images } = splitMessageImages(text);
  const [open, setOpen] = useState(false);
  // The message started going (or went) while its menu was open: the ⋯ is gone, so is its menu, and
  // it stays closed if the ⋯ comes back.
  if (open && !menu.length) setOpen(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // The ⋯ is described by the message it manages, so two of them read apart.
  const bubbleId = useId();
  const queued = tone === "waiting";
  // The badge already says it is queued; the status copy's own "Queued." would repeat it.
  const detail = queued ? label.replace(/^Queued\.\s*/, "") : label;
  return (
    <div className="flex flex-col items-end">
      <div
        id={bubbleId}
        className={cn(
          "max-w-[85%] min-w-0 space-y-1.5 rounded-xl rounded-br-md bg-muted px-3.5 py-2 [overflow-wrap:anywhere]",
          // Not in the conversation yet: a quieter ink, never a translucent one.
          (tone === "waiting" || tone === "busy") && !editor && "text-muted-foreground",
          editor && "w-full max-w-full",
        )}
      >
        {editor ?? (
          <>
            {prose && <MarkdownText text={prose} query="" className={clamp ? "line-clamp-3" : undefined} />}
            <MessageImages paths={images} className="pt-1" />
          </>
        )}
      </div>
      {/* The words take the line while they leave them 15rem; past that (a long failure next to Open
          Terminal on a phone) the buttons wrap under them instead of squeezing them into a column. */}
      <div className="flex w-full flex-wrap items-center justify-end gap-x-1">
        <p
          role="status"
          aria-live="polite"
          className={cn("flex min-w-0 grow basis-60 items-center justify-end gap-1.5 px-1 py-1 text-footnote text-muted-foreground", tone === "problem" && "text-destructive")}
        >
          {queued ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-micro text-foreground">
              <Clock aria-hidden="true" className="size-3" />
              Queued
            </span>
          ) : (
            TONE_ICON[tone]
          )}{" "}
          <span className="min-w-0">
            {detail}
            {device ? <> · from {device}</> : null}
          </span>
        </p>
        {remedies.map(({ id, label: text, icon: Icon, run, disabled, name, armed }) => (
          <button
            key={id}
            type="button"
            aria-label={name}
            disabled={disabled}
            onClick={run}
            className={cn(
              "flex min-h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-footnote font-medium text-foreground hover:bg-accent disabled:text-disabled-foreground coarse:min-h-11",
              armed && "bg-destructive/10 text-destructive hover:bg-destructive/15",
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" />
            {text}
          </button>
        ))}
        {menu.length > 0 && (
          <button
            ref={trigger}
            type="button"
            aria-label={menuLabel}
            aria-describedby={bubbleId}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground active:bg-muted"
          >
            <MoreHorizontal aria-hidden="true" className="size-5" />
          </button>
        )}
      </div>
      <WorkbenchPopover
        open={open}
        onDismiss={() => setOpen(false)}
        anchorRef={trigger}
        label="Queued message"
        className="w-56 [&>div:first-child]:hidden [&>div:last-child]:p-1.5"
      >
        <ActionGroups
          groups={[{ label: "Queued message", actions: menu }]}
          onRun={(run) => {
            setOpen(false);
            run();
          }}
        />
      </WorkbenchPopover>
    </div>
  );
}
