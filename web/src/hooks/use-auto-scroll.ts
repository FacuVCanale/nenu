import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface UseAutoScrollOptions {
  /** Px distance from the bottom still considered "at bottom". */
  offset?: number;
  /** Any value that changes when new content is appended — drives the auto-scroll effect. */
  dep?: unknown;
  /** Fires when the at-bottom state changes — lets a parent follow live output or freeze it. */
  onAtBottomChange?: (atBottom: boolean) => void;
}

/** At or past the bottom (an iOS bounce overshoots it), within `offset` px. */
export function atTail(el: HTMLElement, offset = 24): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= offset;
}

// Keeps a scroll container pinned to the bottom as content grows, but yields control the moment
// the user scrolls up to read backscroll (and offers a button to jump back down).
//
// Only a move UP leaves the tail. A pin queues a scroll event the browser dispatches a frame later,
// and output that grows meanwhile makes that event report a gap nobody scrolled; read as the user
// leaving, it froze the view at the bottom behind the arrow. So `lastTop` keeps where the list last
// stood, set by every pin, and an event that did not move above it re-pins instead.
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  options: UseAutoScrollOptions = {},
) {
  const { offset = 24, dep, onAtBottomChange } = options;
  const scrollRef = useRef<T>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const autoScroll = useRef(true);
  const lastTop = useRef(0);

  const pin = useCallback((el: HTMLElement) => {
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    lastTop.current = el.scrollTop;
  }, []);

  const pinToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !autoScroll.current) return;
    pin(el);
  }, [pin]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    autoScroll.current = true;
    pin(el);
    setIsAtBottom(true);
    onAtBottomChange?.(true);
  }, [onAtBottomChange, pin]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const up = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;
    const bottom = atTail(el, offset);
    if (!bottom && !up) {
      if (autoScroll.current) pin(el);
      return;
    }
    autoScroll.current = bottom;
    setIsAtBottom(bottom);
    onAtBottomChange?.(bottom);
  }, [offset, onAtBottomChange, pin]);

  // Re-pin before paint when new content arrives — opening a pane / switching tabs must land on
  // the live tail without a flash of the oldest scrollback. Yields if the user has scrolled away.
  useLayoutEffect(() => {
    pinToBottom();
  }, [dep, pinToBottom]);

  // Re-pin when the container OR its content resizes while we're following.
  // - Container: a shrinking viewport (keys dock, on-screen keyboard) pushes the tail below the fold.
  // - Content: opening a pane paints the flex-sized scroller first; AnsiOutput then grows inside it.
  //   That does not change the container's border box, so observing only `el` leaves you stuck at the
  //   top of scrollback. Keyed on the captured `autoScroll` intent, NOT a recomputed at-bottom (a
  //   shrink already moved the view off bottom); a scrolled-up user is left in place.
  // Guarded for jsdom, which has no ResizeObserver.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      pinToBottom();
    });
    ro.observe(el);
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }

    // React replaces/grows children across polls and pane opens — keep observing new nodes and
    // re-pin when the child list changes while following.
    const mo = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) ro.observe(node);
        }
      }
      pinToBottom();
    });
    mo.observe(el, { childList: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [pinToBottom]);

  return { scrollRef, isAtBottom, scrollToBottom, onScroll };
}
