import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";

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
 * The rename view behind the "Rename" tap: a Back row, a prefilled label input (autofocused by the
 * caller via `inputRef`), and Save. `canSave` lets a sheet refuse a blank field — tabs have no
 * "clear" so they pass `canSave = trimmed.length > 0`, while a pane passes `true` always so saving a
 * blank field clears its label. Enter in the input saves.
 */
export function RenameView({
  inputRef,
  label,
  onLabelChange,
  onSave,
  onBack,
  saving,
  canSave,
  placeholder,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  onLabelChange: (value: string) => void;
  onSave: () => void;
  onBack: () => void;
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
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start rounded-md py-1 pr-2 text-xs font-medium text-muted-foreground transition-colors active:bg-muted"
      >
        <ChevronLeft className="size-3.5" />
        Back
      </button>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Label</span>
        <input
          ref={inputRef}
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="h-11 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <Button onClick={onSave} disabled={saving || !canSave} className="h-11">
        {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}
