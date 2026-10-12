import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { useLongPress } from "@/hooks/use-long-press";
import { StatusDot } from "@/components/status-badge";
import { revealScrollLeft } from "@/components/ui/strip-reveal";
import { STATUS_LABEL, type AgentStatus } from "@/lib/types";

// The tab and pane strips above a chat share this one chip, styled in styles/strips.css: a pill with
// a leading glyph, a name capped so it can't hide its siblings, and a neutral fill on the open one.

/** The fade a strip draws on an edge it can still scroll toward (strips.css: --fade-start/--fade-end). */
const EDGE_FADE = 24;

interface ChipProps {
  label: string;
  /** Tells same-named siblings apart, drawn quieter than the name. Omit when the name is unique. */
  tag?: string;
  active: boolean;
  /** Dashed outline for the item focused in the desktop TUI. */
  focused?: boolean;
  /** Drawn as a leading dot and said after the name ("claude, idle"); omit when there is no agent,
   *  since empty is not idle. */
  status?: AgentStatus | null;
  /** A glyph in place of the dot (a shell's). */
  icon?: ReactNode;
  onClick: () => void;
  /** Long-press (or right-click / Android contextmenu) opens the chip's actions. Inert when unset. */
  onLongPress?: () => void;
  /** A tap on the chip while it is `active` opens its actions instead of a dead re-select, and the
   *  chip shows a chevron saying so: long-press alone was a gesture nobody found. */
  onTapActive?: () => void;
}

export function Chip({ label, tag, active, focused, status, icon, onClick, onLongPress, onTapActive }: ChipProps) {
  const longPress = useLongPress(onLongPress);
  const opensActions = active && !!onTapActive;

  // A long-press already suppresses the click that follows (longPress.onClickCapture), so this only
  // sees a genuine tap.
  function handleClick() {
    if (opensActions) {
      onTapActive!();
      return;
    }
    onClick();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      {...longPress}
      aria-current={active ? "true" : undefined}
      aria-haspopup={opensActions ? "dialog" : undefined}
      data-focused={focused || undefined}
      title={label}
      className="strip-chip"
    >
      {icon ?? (status && <StatusDot status={status} surface="bg-transparent" className="size-2" />)}
      <span className="strip-chip-label">{label}</span>
      {tag && <span className="strip-chip-tag"> · {tag}</span>}
      {status && <span className="sr-only">, {STATUS_LABEL[status]}</span>}
      {opensActions && <ChevronDown data-chip-actions aria-hidden="true" className="strip-chip-more" />}
    </button>
  );
}

interface ChipStripProps {
  /** Which strip this is: also the hook the keyboard rule and the bench use. */
  band: "tabs" | "panes";
  /** The open item's key: when it changes, the strip scrolls its chip into view. */
  activeKey: string;
  /** Before the scroller, outside it (the desk's "Panes" label). */
  lead?: ReactNode;
  children: ReactNode;
}

// One row of chips that scrolls sideways. The open chip is kept in view, and an edge the row can
// still scroll toward fades, so a sibling past it is seen to exist.
export function ChipStrip({ band, activeKey, lead, children }: ChipStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const chip = scroller?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!scroller || !chip) return;
    const left = revealScrollLeft({
      scrollLeft: scroller.scrollLeft,
      width: scroller.clientWidth,
      max: scroller.scrollWidth - scroller.clientWidth,
      fade: EDGE_FADE,
      start: chip.offsetLeft,
      end: chip.offsetLeft + chip.offsetWidth,
    });
    if (left !== null) scroller.scrollLeft = left;
  }, [activeKey]);

  // Which edges fade, written straight to the DOM: it follows every scroll frame and needs no render.
  // Runs after every render too, since a rename or a new chip changes what overflows.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const update = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      const edges = [scroller.scrollLeft > 1 && "start", scroller.scrollLeft < max - 1 && "end"].filter(Boolean);
      scroller.dataset.overflow = edges.join(" ");
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      resize?.disconnect();
    };
  });

  return (
    <div data-workbench-navigation-band={band} className="strip">
      {lead}
      <div ref={scrollerRef} className="strip-scroller">
        {children}
      </div>
    </div>
  );
}
