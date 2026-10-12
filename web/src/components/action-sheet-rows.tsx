import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Shared building blocks for the long-press action sheets — pane AND tab — so the two stay visually
// and behaviourally identical (the user's ask: "they should be the same"). The action row, the close
// confirmation and the rename view are authored ONCE here; each sheet owns its own state/handlers and
// just composes these, differing only in domain semantics (which RPC, whether a blank clears, what a
// close takes with it). A label rendered here is user text going only into an <input> value / text
// node — never markup — so it stays within the pane-output XSS boundary.

/** How long a confirmation ignores taps once it shows: the second tap of a quick double tap on the
 *  row that opened it lands here, and must close nothing. */
const CONFIRM_SETTLE_MS = 500;

/** An action row: leading icon + label, 44px on a touch screen. A destructive one (Close) is red
 *  from the first render, and only opens its confirmation. */
export function ActionRow({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-subhead font-medium transition-colors coarse:min-h-11",
        destructive ? "text-destructive hover:bg-destructive/10 active:bg-destructive/15" : "hover:bg-accent active:bg-muted",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The confirmation a destructive row opens in place of the action list, as an iOS action sheet asks:
 * the question, what it takes with it, the destructive button and Cancel. Cancel ends up where the
 * row was, and the destructive button ignores taps for its first {@link CONFIRM_SETTLE_MS}, so a
 * double tap on the row closes nothing.
 */
export function ConfirmView({
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  /** The close is in flight: the button keeps its label, shows a spinner and says it is busy. */
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [shownAt] = useState(() => performance.now());
  const cancelRef = useRef<HTMLButtonElement>(null);
  // The row that opened this is gone; keep a keyboard user's focus in the sheet, on the safe choice.
  useEffect(() => cancelRef.current?.focus({ preventScroll: true }), []);

  function confirm() {
    if (performance.now() - shownAt < CONFIRM_SETTLE_MS) return;
    onConfirm();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-headline">{title}</h2>
        <p className="text-subhead text-muted-foreground">{message}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="destructive" size="lg" className="w-full" onClick={confirm} disabled={busy} aria-busy={busy || undefined}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {confirmLabel}
        </Button>
        <Button ref={cancelRef} variant="secondary" size="lg" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The rename view behind "Rename", as an iOS edit sheet: an edit header (Cancel · title · Save, 44px
 * controls) that stands in for the sheet's own title row while it shows (strips.css), and the field
 * alone, at 16px so iOS doesn't zoom, with a clear button. The caller autofocuses the field through
 * `inputRef`. `canSave` lets a sheet refuse a blank field — tabs have no "clear" so they pass
 * `canSave = trimmed.length > 0`, while a pane passes `true` so saving a blank field clears its
 * label. Enter in the field saves.
 */
export function RenameView({
  inputRef,
  title,
  fieldLabel,
  label,
  onLabelChange,
  onSave,
  onCancel,
  saving,
  canSave,
  placeholder,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  /** "Rename pane", "Rename tab". */
  title: string;
  /** The field's accessible name: "Pane name", "Tab name". */
  fieldLabel: string;
  label: string;
  onLabelChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  canSave: boolean;
  placeholder: string;
}) {
  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Bleeds through the sheet body's padding (16px sides, 12px top) to sit where the title row was. */}
      <div data-sheet-edit-header className="sticky top-0 z-10 -mx-4 -mt-3 border-b border-border/60 bg-background">
        <div aria-hidden="true" className="flex justify-center pt-2 pb-1">
          <span className="h-1 w-9 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center px-2 pb-1">
          <button type="button" onClick={onCancel} className="h-11 justify-self-start rounded-md px-2 text-headline font-normal text-muted-foreground">
            Cancel
          </button>
          <h2 className="truncate text-headline">{title}</h2>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !canSave}
            aria-busy={saving || undefined}
            className="h-11 justify-self-end rounded-md px-2 text-headline disabled:not-aria-busy:text-disabled-foreground"
          >
            Save
          </button>
        </div>
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          aria-label={fieldLabel}
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          enterKeyHint="done"
          className="h-11 w-full rounded-lg border border-border bg-background pr-11 pl-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {label && (
          <button
            type="button"
            aria-label="Clear name"
            // Keep focus (and the phone keyboard) in the field.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onLabelChange("");
              inputRef.current?.focus({ preventScroll: true });
            }}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-subtle-foreground hover:text-foreground"
          >
            <XCircle aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
