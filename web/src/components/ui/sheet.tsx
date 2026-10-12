import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Minimal modal focus handling (no deps, no full trap): on open move focus into the panel so
// keyboard / screen-reader users land inside the dialog; on close restore focus to whatever was
// focused before it opened. The panel must carry tabIndex={-1} to be a focus target.
function useDialogFocus(open: boolean, panelRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.({ preventScroll: true });
    };
  }, [open, panelRef]);
}

// A minimal bottom sheet — no Radix, no portals, no extra deps. Renders nothing when closed.
// Dismisses on backdrop tap or Escape. Animations come from tw-animate-css (already imported).
interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function BottomSheet({ open, onClose, title, children, className }: BottomSheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef({ startY: 0, atTop: false, engaged: false, dy: 0 });
  const [dragY, setDragY] = React.useState(0);
  const titleId = React.useId();
  useDialogFocus(open, panelRef);

  // Backdrop dismiss requires press AND release on the backdrop itself (the Radix
  // outside-pointerdown rule) — NOT just whatever the browser happens to synthesize a `click` on. A
  // long-press that opens this sheet has its finger still down at the moment the sheet mounts; the
  // browser's release click then lands on whatever is now under the finger, which is the backdrop —
  // and without this guard that click would immediately close the sheet it just opened. Arming only
  // on a backdrop `pointerdown` means a click that originated elsewhere (e.g. the pill's release)
  // never dismisses.
  const backdropArmed = React.useRef(false);
  React.useEffect(() => {
    if (open) backdropArmed.current = false;
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Drag-to-dismiss: pull the sheet down from the top to close it. The touchmove listener is
  // attached NON-PASSIVE so we can `preventDefault()` the downward pull — that's what suppresses
  // the browser's pull-to-refresh (otherwise a pull-down at the top would reload the whole app
  // instead of closing the sheet). A gesture that starts mid-scroll falls through to normal list
  // scrolling; only a pull that begins at the top engages the dismiss.
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    setDragY(0);
    const SLOP = 6; // ignore taps / tiny jitter before engaging the drag
    const CLOSE = 90; // px past which release closes instead of snapping back

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      let atTop = panel.scrollTop <= 0;
      // A nested list owns its scroll gesture; the sheet must not turn a downward scroll into
      // dismissal. Inputs also own selection/drag gestures while editing.
      let target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) atTop = false;
      while (target && target !== panel) {
        if (target.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(target).overflowY)) atTop = false;
        target = target.parentElement;
      }
      drag.current = { startY: t.clientY, atTop, engaged: false, dy: 0 };
    };
    const onMove = (e: TouchEvent) => {
      const d = drag.current;
      if (!d.atTop) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - d.startY;
      if (!d.engaged && dy > SLOP) d.engaged = true;
      if (d.engaged) {
        e.preventDefault();
        const off = Math.max(0, dy);
        d.dy = off;
        setDragY(off);
      }
    };
    const onEnd = () => {
      const off = drag.current.dy;
      drag.current = { startY: 0, atTop: false, engaged: false, dy: 0 };
      if (off > CLOSE) onClose();
      else setDragY(0);
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-viewport fixed inset-x-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
    >
      {/* Backdrop: still dismisses on tap, but hidden from assistive tech — the ✕ in the header is
          the single accessible "Close", so the dialog isn't announced with a giant duplicate. Dismiss
          fires only when the pointer went DOWN on the backdrop too — see backdropArmed above. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 duration-200 animate-in fade-in motion-reduce:animate-none"
        onPointerDown={() => {
          backdropArmed.current = true;
        }}
        onClick={() => {
          if (!backdropArmed.current) return;
          backdropArmed.current = false;
          onClose();
        }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: drag.current.engaged ? "none" : undefined,
        }}
        className={cn(
          "sheet-bottom-panel relative z-10 w-full overflow-y-auto overscroll-contain rounded-t-2xl border-t border-border bg-background shadow-2xl duration-200 animate-in slide-in-from-bottom-4 motion-reduce:animate-none",
          "pb-[calc(env(safe-area-inset-bottom)_+_1rem)]",
          className,
        )}
      >
        <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur-md">
          {/* Grab handle — pull down (from anywhere at the top) to dismiss. */}
          <div className="flex justify-center pt-2 pb-1">
            <span className="h-1 w-9 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="flex items-center justify-between px-4 pb-3">
            <span id={title ? titleId : undefined} className="text-sm font-semibold">
              {title}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

// A left-edge drawer — same no-deps approach as BottomSheet, but slides in from the side and fills
// the viewport height from the top. The phone's navigation opens here from the Nenu mark in the
// header's top-left corner, so it starts where the finger was instead of rising from the bottom.
interface SideSheetProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name; shown as the heading unless `heading` replaces it. */
  title: string;
  /** A visible heading in place of the title text (the brand row); the title still names the dialog. */
  heading?: React.ReactNode;
  /** Optional action(s) rendered in the header, to the left of the close (✕) button. */
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function SideSheet({
  open,
  onClose,
  title,
  heading,
  headerAction,
  children,
  footer,
  className,
}: SideSheetProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = React.useState(0);
  const dragging = React.useRef(false);
  const titleId = React.useId();
  useDialogFocus(open, panelRef);

  // Backdrop dismiss requires press AND release on the backdrop itself (the Radix
  // outside-pointerdown rule) — NOT just whatever the browser happens to synthesize a `click` on. A
  // long-press that opens this sheet has its finger still down at the moment the sheet mounts; the
  // browser's release click then lands on whatever is now under the finger, which is the backdrop —
  // and without this guard that click would immediately close the sheet it just opened. Arming only
  // on a backdrop `pointerdown` means a click that originated elsewhere (e.g. the pill's release)
  // never dismisses.
  const backdropArmed = React.useRef(false);
  React.useEffect(() => {
    if (open) backdropArmed.current = false;
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Swipe left to dismiss, as a native drawer closes. The gesture engages only once it is clearly
  // horizontal, so a vertical scroll of the list never moves the panel; the move listener is
  // non-passive so an engaged swipe can stop iOS from scrolling underneath it.
  React.useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    setDragX(0);
    const SLOP = 8;
    const CLOSE = 72;
    let start: { x: number; y: number } | null = null;
    let engaged = false;
    let dx = 0;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const editing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true]");
      start = t && !editing ? { x: t.clientX, y: t.clientY } : null;
      engaged = false;
      dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const x = t.clientX - start.x;
      const y = t.clientY - start.y;
      if (!engaged) {
        if (Math.abs(y) > SLOP && Math.abs(y) >= Math.abs(x)) return void (start = null);
        if (x > -SLOP || Math.abs(x) <= Math.abs(y)) return;
        engaged = true;
        dragging.current = true;
      }
      e.preventDefault();
      dx = Math.min(0, x);
      setDragX(dx);
    };
    const onEnd = () => {
      const shut = engaged && dx < -CLOSE;
      start = null;
      engaged = false;
      dragging.current = false;
      dx = 0;
      if (shut) onClose();
      else setDragX(0);
    };
    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-viewport fixed inset-x-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby={heading ? undefined : titleId}
      aria-label={heading ? title : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragging.current ? "none" : undefined,
        }}
        className={cn(
          "side-sheet-panel relative z-10 flex h-full w-[86%] max-w-sm flex-col border-r border-border bg-background shadow-2xl duration-200 animate-in slide-in-from-left-4 motion-reduce:animate-none",
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 pt-[env(safe-area-inset-top)]">
          <div className="flex min-h-13 min-w-0 flex-1 items-center pl-2">
            {heading ?? (
              <span id={titleId} className="text-sm font-semibold">
                {title}
              </span>
            )}
          </div>
          {headerAction}
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-border/60 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)_+_0.5rem)]">
            {footer}
          </div>
        )}
      </div>
      {/* Backdrop: dismisses on tap but hidden from assistive tech — the header ✕ is the accessible
          "Close", so the drawer isn't announced with a giant duplicate close target. Dismiss fires
          only when the pointer went DOWN on the backdrop too — see backdropArmed above. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="flex-1 bg-black/50 duration-200 animate-in fade-in motion-reduce:animate-none"
        onPointerDown={() => {
          backdropArmed.current = true;
        }}
        onClick={() => {
          if (!backdropArmed.current) return;
          backdropArmed.current = false;
          onClose();
        }}
      />
    </div>
  );
}
