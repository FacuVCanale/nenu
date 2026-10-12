import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import { ChatMessageList } from "./chat-message-list";

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

/** The terminal mirror and the History page: a find box above the list jumps to the first match. */
function Find() {
  const match = useRef<HTMLParagraphElement>(null);
  return <>
    <input aria-label="Find in output" onChange={() => match.current?.scrollIntoView({ block: "center" })} />
    <ChatMessageList dep="tail" className="h-96">
      <p ref={match}>needle: the line to find</p>
      <p>output line 220</p>
    </ChatMessageList>
  </>;
}

describe("ChatMessageList", () => {
  // Measured on the bench: typing "needle" in the mirror's Find left the list at the tail, short of
  // the match, because the keystroke counted as an edit that could have moved the list.
  it("leaves the tail for a match the find box jumps to while the operator types", () => {
    const { container } = render(<Find />);
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    const box = { height: 3000, client: 400, top: 0 };
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => box.height },
      clientHeight: { configurable: true, get: () => box.client },
      scrollTop: { configurable: true, get: () => box.top, set: (v: number) => { box.top = Math.max(0, Math.min(v, box.height - box.client)); } },
    });
    scroller.scrollTo = ((o: ScrollToOptions) => { scroller.scrollTop = o.top ?? 0; }) as HTMLElement["scrollTo"];
    act(() => { scroller.scrollTo({ top: box.height }); fireEvent.scroll(scroller); });
    screen.getByText(/needle/).scrollIntoView = () => { scroller.scrollTop = 0; };

    fireEvent.input(screen.getByRole("textbox", { name: "Find in output" }), { target: { value: "needle" } });
    act(() => { fireEvent.scroll(scroller); });

    expect(box.top).toBe(0);
    expect(screen.getByRole("button", { name: /^Scroll to latest/ })).toBeInTheDocument();
  });
});
