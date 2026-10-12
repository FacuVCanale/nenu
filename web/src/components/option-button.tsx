import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The one shared visual language for a dialog: the card every dialog is drawn as (the bridge's
// QuestionCard and each block a grammar lifts off the screen), its rows and its actions. One source,
// so a menu, a preview and a permission can't drift into different styles again. Theme tokens only,
// and no `dark:` variant: a block also renders inside the terminal mirror (ADR 0002).
//
// XSS boundary unchanged: labels/descriptions passed in are React text nodes; nothing is ever set as
// innerHTML.

/** The card's surface: an elevated card with a hairline, the same in the thread and the mirror. */
export const DIALOG_CARD = "flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm";

/** The card's status: the blocked dot carries the urgency, the words stay plain (direction.md). */
export function WaitingOnYou() {
  return (
    <span className="flex shrink-0 items-center gap-2 font-medium text-foreground">
      <span aria-hidden className="size-2 rounded-full bg-status-blocked" />
      Waiting on you
    </span>
  );
}

/**
 * A dialog a grammar lifted off the screen, drawn as the card: the status line, then the block's own
 * content. Named by its question, like the QuestionCard.
 */
export function DialogCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} data-dialog-card className={DIALOG_CARD}>
      <div className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px]">
        <WaitingOnYou />
      </div>
      {children}
    </section>
  );
}

/** The card's question. */
export function QuestionHeading({ children }: { children: ReactNode }) {
  return <p className="text-[17px] leading-[22px] font-semibold tracking-[-0.01em] text-pretty text-foreground">{children}</p>;
}

/**
 * Surface tone of an option row:
 *  - `default`  — a plain, selectable choice.
 *  - `selected` — the TUI's current/chosen row (primary accent tint).
 *  - `busy`     — this option's keystroke is in flight: primary accent, and NOT dimmed even while the
 *                 button is disabled (the caller renders a spinner in the trailing slot), so the
 *                 pressed row stays visibly distinct while its siblings dim under `disabled`.
 */
export type OptionTone = "default" | "selected" | "busy";

/** A tappable option row: 44 px at least, the card's row radius. */
export function optionSurface(tone: OptionTone): string {
  return cn(
    "flex min-h-11 w-full items-center gap-3 rounded-xl border px-3.5 py-2 text-left transition-colors",
    "active:scale-[0.99]",
    tone === "busy"
      ? "border-primary bg-primary/10" // in flight — accent, never dimmed (the spinner reads over it)
      : tone === "selected"
        ? "border-primary/60 bg-primary/10 active:bg-primary/15 disabled:opacity-60"
        : "border-border bg-secondary active:bg-muted disabled:opacity-60",
  );
}

/** The card's one commit: an ink fill, full width (direction.md: one primary per surface). */
export const PRIMARY_ACTION =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-3.5 text-base font-medium text-background transition-colors active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground";
/** A second key the screen names that commits too, beside the primary but never as loud. */
export const NEUTRAL_ACTION =
  "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-secondary px-3.5 text-base font-medium text-foreground transition-colors active:scale-[0.99] disabled:opacity-60";
/** An escape or a utility under the card (Cancel, Chat about this, Add a note…): plain text, neutral. */
export const SECONDARY_ACTION =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted disabled:text-muted-foreground/70";
/** The row of SECONDARY_ACTIONs, bled into the card's padding so their text lines up with the content. */
export const SECONDARY_ROW = "-mx-2 -mb-2 flex flex-wrap items-center";

/**
 * The enclosing surface for a block that is not a dialog (the completion popup): a bordered panel
 * that lifts it off the raw terminal mirror behind it. Owns `role="group"` + its aria label.
 */
export function PromptPanel({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="my-1.5 flex flex-col gap-1.5 rounded-xl border border-border bg-card p-1.5 shadow-sm"
    >
      {children}
    </div>
  );
}

/** The compact caption above a PromptPanel's rows. Non-semantic (the group is already labelled). */
export function OptionGroupCaption({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 pl-0.5">
      <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-primary/60" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

/** A full option row: label + optional description, and a trailing slot (spinner or a state mark).
 *  Shared by prompt-select and wizard answers, which are structurally identical. */
export function OptionButton({
  tone = "default",
  label,
  description,
  trailing,
  disabled,
  onClick,
}: {
  tone?: OptionTone;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={optionSurface(tone)}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-words text-base leading-5 font-medium text-foreground">{label}</span>
        {description ? (
          <span className="break-words text-[13px] leading-[18px] text-muted-foreground">{description}</span>
        ) : null}
      </span>
      {trailing}
    </button>
  );
}
