import * as React from "react";

import { cn } from "@/lib/utils";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { ScrollToLatest } from "./scroll-to-latest";

export interface ChatMessageListHandle {
  /** Imperatively jump to the latest output (e.g. after sending a reply). */
  scrollToBottom: () => void;
  /** The scroll container itself — lets the parent measure/anchor (e.g. "Load older" scrollback). */
  getScrollElement: () => HTMLElement | null;
}

interface ChatMessageListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Changing this value re-pins the list to the bottom (pass your message count / latest text). */
  dep?: unknown;
  /** Fires when the user reaches / leaves the bottom — lets the parent follow or freeze content. */
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Dot the "jump to latest" button when newer output arrived while you were scrolled up. */
  hasNew?: boolean;
}

// Scrollable conversation container that auto-follows new messages and shows a "jump to latest"
// affordance once the user scrolls up. Exposes `scrollToBottom` via ref so the parent can re-follow
// after an action, and reports at-bottom changes so the parent can freeze content while you read.
const ChatMessageList = React.forwardRef<ChatMessageListHandle, ChatMessageListProps>(
  function ChatMessageList(
    { className, children, dep, onAtBottomChange, hasNew, ...props },
    ref,
  ) {
    const { scrollRef, isAtBottom, scrollToBottom, onScroll } = useAutoScroll<HTMLDivElement>({
      dep,
      onAtBottomChange,
    });

    React.useImperativeHandle(
      ref,
      () => ({ scrollToBottom: () => scrollToBottom(), getScrollElement: () => scrollRef.current }),
      [scrollToBottom, scrollRef],
    );

    return (
      <div className="relative h-full min-w-0 w-full">
        {/* Block scrollport (not flex-col): flex children with overflow-x-auto can shrink and steal
            vertical scrolling from this container — see ansi-output preClass. */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            "h-full min-w-0 w-full overflow-y-auto overflow-x-hidden px-3 py-4",
            className,
          )}
          {...props}
        >
          {children}
        </div>

        {/* Centred: the history page keeps its prompt stepper in the bottom-right corner. */}
        {!isAtBottom && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10">
            <ScrollToLatest onClick={() => scrollToBottom()} changed={hasNew} />
          </div>
        )}
      </div>
    );
  },
);

export { ChatMessageList };
