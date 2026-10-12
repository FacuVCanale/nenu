import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { TabStrip } from "./tab-strip";
import type { AgentStatus, AgentView, TabView } from "@/lib/types";

const tabs: TabView[] = [
  { tabId: "w1:t1", workspaceId: "w1", number: 1, label: "1", focused: true, paneCount: 2 },
  { tabId: "w1:t2", workspaceId: "w1", number: 2, label: "2", focused: false, paneCount: 1 },
  { tabId: "w2:t1", workspaceId: "w2", number: 1, label: "1", focused: false, paneCount: 1 },
];

describe("TabStrip", () => {
  it("renders tabs in snapshot order even when their stable numbers differ", () => {
    render(
      <TabStrip
        workspaceId="w1"
        tabs={[
          { ...tabs[1]!, label: "Second" },
          { ...tabs[0]!, label: "First" },
        ]}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );

    const renderedTabs = screen
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((label) => label === "First" || label === "Second");
    expect(renderedTabs).toEqual(["Second", "First"]);
  });

  it("shows only this workspace's tabs, and reports selection", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={onSelect}
        onNewTab={vi.fn()}
      />,
    );
    // w2's tab (also labelled "1") must be excluded, so there's exactly one "Tab 1".
    expect(screen.getAllByRole("button", { name: "Tab 1" })).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Tab 2" }));
    expect(onSelect).toHaveBeenCalledWith("w1:t2");
  });

  it("creates a tab in the current workspace", async () => {
    const user = userEvent.setup();
    const onNewTab = vi.fn();
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={onNewTab}
      />,
    );
    await user.click(screen.getByRole("button", { name: /new tab/i }));
    expect(onNewTab).toHaveBeenCalledWith("w1");
  });

  // The + used to end the row that scrolls: on a desk, once the tabs overflowed, it went out of view.
  it("keeps New tab beside the row that scrolls, so it stays in reach however many tabs there are", () => {
    render(<TabStrip workspaceId="w1" tabs={tabs} agents={[]} selected="w1:t1" onSelect={vi.fn()} onNewTab={vi.fn()} />);
    const row = screen.getByRole("button", { name: "Tab 1" }).closest(".strip-scroller")!;
    expect(row).not.toBeNull();
    expect(row.contains(screen.getByRole("button", { name: "New tab" }))).toBe(false);
  });
});

describe("TabStrip — long-press actions", () => {
  afterEach(() => vi.useRealTimers());

  // A long-press on a chip reaches the DOM as a `contextmenu` event (Android Chrome / right-click);
  // with both actions wired it opens the actions sheet (rename / close), like the pane strip.
  it("opens the actions sheet on a long-press (contextmenu) when the actions are wired", () => {
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab 2" }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close tab" })).toBeInTheDocument();
  });

  it("stays inert on contextmenu when the actions are not wired", () => {
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab 2" }));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("stays inert when only onRenamed is wired (both callbacks are required)", () => {
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
        onRenamed={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab 2" }));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  // Tapping the already-selected tab is otherwise a no-op re-select; with actions wired it opens the
  // same actions sheet a long-press would, so the chip is never a dead tap.
  it("opens the actions sheet on a plain tap of the already-selected tab", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={onSelect}
        onNewTab={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Tab 1" }));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Nothing used to say the open tab had actions; it now carries a chevron and says it opens a dialog.
  it("marks the open tab, and only it, as opening its actions when they are wired", () => {
    const { rerender } = render(
      <TabStrip workspaceId="w1" tabs={tabs} agents={[]} selected="w1:t1" onSelect={vi.fn()} onNewTab={vi.fn()} onRenamed={vi.fn()} onClosed={vi.fn()} />,
    );
    const open = screen.getByRole("button", { name: "Tab 1" });
    expect(open).toHaveAttribute("aria-haspopup", "dialog");
    expect(open.querySelector("[data-chip-actions]")).not.toBeNull();
    const other = screen.getByRole("button", { name: "Tab 2" });
    expect(other).not.toHaveAttribute("aria-haspopup");
    expect(other.querySelector("[data-chip-actions]")).toBeNull();

    rerender(<TabStrip workspaceId="w1" tabs={tabs} agents={[]} selected="w1:t1" onSelect={vi.fn()} onNewTab={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Tab 1" }).querySelector("[data-chip-actions]")).toBeNull();
  });

  // A read-only device's sheet holds only a note, so the open tab promises nothing; a long-press
  // still shows the note.
  it("puts no actions affordance on the open tab on a read-only device", () => {
    render(
      <TabStrip workspaceId="w1" tabs={tabs} agents={[]} selected="w1:t1" onSelect={vi.fn()} onNewTab={vi.fn()} readOnly onRenamed={vi.fn()} onClosed={vi.fn()} />,
    );
    const open = screen.getByRole("button", { name: "Tab 1" });
    expect(open).not.toHaveAttribute("aria-haspopup");
    expect(open.querySelector("[data-chip-actions]")).toBeNull();
    fireEvent.contextMenu(open);
    expect(screen.getByText(/isn't authorised to rename or close tabs/)).toBeInTheDocument();
  });

  // The chip, the sheet's title and its confirmation each named the tab their own way: "Tab 2",
  // "Tab " and "Close “Tab 3”?" for a tab with no label, second in the strip, numbered 3 by Herdr.
  it("names the sheet and its close confirmation as the strip names the tab", async () => {
    const user = userEvent.setup();
    const strip: TabView[] = [tabs[0]!, { tabId: "w1:t3", workspaceId: "w1", number: 3, label: "", focused: false, paneCount: 1 }];
    render(
      <TabStrip workspaceId="w1" tabs={strip} agents={[]} selected="w1:t1" onSelect={vi.fn()} onNewTab={vi.fn()} onRenamed={vi.fn()} onClosed={vi.fn()} />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab 2" }));
    expect(screen.getByRole("dialog", { name: "Tab 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close tab" }));
    expect(screen.getByRole("heading", { name: "Close “Tab 2”?" })).toBeInTheDocument();
  });

  it("still switches on a tap of a non-selected tab even with actions wired", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={onSelect}
        onNewTab={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Tab 2" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("w1:t2");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  // The close wiring the call-site fallbacks hang off: long-press → Close tab → confirm hits the
  // bridge and fires the parent's onClosed with the tab id.
  it("closes a tab once confirmed and reports the closed tab id", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const user = userEvent.setup();
    const onClosed = vi.fn();
    let url = "";
    server.use(
      http.post(/\/api\/tab\/[^/]+\/close$/, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
        onRenamed={vi.fn()}
        onClosed={onClosed}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "Tab 2" })); // w1:t2, paneCount 1
    await user.click(screen.getByRole("button", { name: "Close tab" }));
    vi.advanceTimersByTime(600);
    await user.click(screen.getByRole("button", { name: "Close tab" }));

    await waitFor(() => expect(onClosed).toHaveBeenCalledExactlyOnceWith("w1:t2"));
    expect(url).toContain("/api/tab/w1%3At2/close");
  });

  // The tab label is user text — it must render as a plain text node, never markup (XSS boundary).
  it("renders a markup-looking tab label as literal text, injecting nothing", () => {
    const xss = "<img src=x onerror=alert(1)>";
    render(
      <TabStrip
        workspaceId="w1"
        tabs={[{ tabId: "w1:t1", workspaceId: "w1", number: 1, label: xss, focused: false, paneCount: 1 }]}
        agents={[]}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: xss })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("TabStrip — status on the chips", () => {
  const tabs: TabView[] = [
    { tabId: "w1:t1", workspaceId: "w1", number: 1, label: "code", focused: false, paneCount: 1 },
    { tabId: "w1:t2", workspaceId: "w1", number: 2, label: "empty", focused: false, paneCount: 0 },
  ];
  const pane = (tabId: string, status: AgentStatus, extra: Partial<AgentView> = {}): AgentView => ({
    paneId: `${tabId}:p1`,
    workspaceId: "w1",
    workspaceLabel: "ws",
    workspaceNumber: 1,
    tabId,
    agent: "claude",
    status,
    cwd: "/home/you/ws",
    focused: false,
    ...extra,
  });

  const strip = (agents: AgentView[]) =>
    render(
      <TabStrip
        workspaceId="w1"
        tabs={tabs}
        agents={agents}
        selected="w1:t1"
        onSelect={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );

  it("says what's going on in a tab, in words as well as colour", () => {
    strip([pane("w1:t1", "blocked")]);
    expect(screen.getByRole("button", { name: /code/ })).toHaveTextContent("needs you");
  });

  it("reports the most urgent pane when a tab holds several", () => {
    strip([pane("w1:t1", "idle"), { ...pane("w1:t1", "blocked"), paneId: "w1:t1:p2" }]);
    expect(screen.getByRole("button", { name: /code/ })).toHaveTextContent("needs you");
  });

  it("distinguishes a finished-but-unseen tab from a working one", () => {
    const { unmount } = strip([pane("w1:t1", "done", { lastActiveAt: 9, lastSeenAt: 1 })]);
    expect(screen.getByRole("button", { name: /code/ })).toHaveTextContent("done");
    unmount();
    strip([pane("w1:t1", "working")]);
    expect(screen.getByRole("button", { name: /code/ })).toHaveTextContent("working");
  });

  it("says idle rather than staying silent about a quiet tab", () => {
    strip([pane("w1:t1", "idle")]);
    expect(screen.getByRole("button", { name: /code/ })).toHaveTextContent("idle");
  });

  it("reports nothing for a tab with no agents — empty is not idle", () => {
    strip([pane("w1:t1", "idle")]);
    const empty = screen.getByRole("button", { name: /empty/ });
    for (const word of ["idle", "working", "done", "needs you"]) {
      expect(empty).not.toHaveTextContent(word);
    }
  });
});

// Reordering by drag (ui/strip-reorder): jsdom lays nothing out, so the chips get the slots a strip of
// three short names has (92px wide, 8px apart); the bench drags real ones (tabs-display-copy-shots).
describe("TabStrip — dragging a tab to another place", () => {
  const three: TabView[] = [
    { tabId: "w1:t1", workspaceId: "w1", number: 1, label: "one", focused: false, paneCount: 1 },
    { tabId: "w1:t2", workspaceId: "w1", number: 2, label: "two", focused: false, paneCount: 1 },
    { tabId: "w1:t3", workspaceId: "w1", number: 3, label: "three", focused: false, paneCount: 1 },
  ];
  const names = () => screen.getAllByRole("button").map((b) => b.textContent).filter((t) => t === "one" || t === "two" || t === "three");
  const layOut = () => {
    ["one", "two", "three"].forEach((name, i) => {
      const chip = screen.getByRole("button", { name });
      Object.defineProperty(chip, "offsetLeft", { configurable: true, value: i * 100 });
      Object.defineProperty(chip, "offsetWidth", { configurable: true, value: 92 });
    });
    const scroller = screen.getByRole("button", { name: "one" }).closest(".strip-scroller")!;
    scroller.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 32, width: 1000, height: 32, x: 0, y: 0, toJSON: () => ({}) });
  };
  const point = (pointerType: "mouse" | "touch", clientX: number, clientY = 16) => ({ pointerId: 1, pointerType, isPrimary: true, button: 0, clientX, clientY });
  const draw = (props: Partial<Parameters<typeof TabStrip>[0]> = {}) =>
    render(
      <TabStrip workspaceId="w1" tabs={three} agents={[]} selected="w1:t1" onSelect={vi.fn()} onNewTab={vi.fn()}
        onRenamed={vi.fn()} onClosed={vi.fn()} onMoved={vi.fn()} {...props} />,
    );

  afterEach(() => vi.useRealTimers());

  it("moves a tab a mouse drags past its neighbours, before the tab it lands on", async () => {
    const bodies: unknown[] = [];
    let url = "";
    server.use(http.post(/\/api\/tab\/[^/]+\/move$/, async ({ request }) => {
      url = request.url;
      bodies.push(await request.json());
      return HttpResponse.json({ ok: true });
    }));
    const onMoved = vi.fn();
    const onSelect = vi.fn();
    draw({ onMoved, onSelect });
    layOut();
    const one = screen.getByRole("button", { name: "one" });
    fireEvent.pointerDown(one, point("mouse", 46));
    fireEvent.pointerMove(one, point("mouse", 60));
    fireEvent.pointerMove(one, point("mouse", 260));
    fireEvent.pointerUp(one, point("mouse", 260));
    fireEvent.click(one);

    expect(names()).toEqual(["two", "three", "one"]);
    await waitFor(() => expect(onMoved).toHaveBeenCalledOnce());
    expect(url).toContain("/api/tab/w1%3At1/move");
    expect(bodies).toEqual([{ before: null }]);
    // The click that ends a drag is not a tap on the tab.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("puts the tab back where it was when Herdr refuses the move", async () => {
    server.use(http.post(/\/api\/tab\/[^/]+\/move$/, () => HttpResponse.json({ ok: false, error: "tab_not_found" })));
    const onMoved = vi.fn();
    draw({ onMoved });
    layOut();
    const three = screen.getByRole("button", { name: "three" });
    fireEvent.pointerDown(three, point("mouse", 246));
    fireEvent.pointerMove(three, point("mouse", 100));
    fireEvent.pointerUp(three, point("mouse", 100));
    expect(names()).toEqual(["one", "three", "two"]);
    await waitFor(() => expect(names()).toEqual(["one", "two", "three"]));
    expect(onMoved).not.toHaveBeenCalled();
  });

  it("lifts a tab a finger holds, and opens its actions when the finger lets go in place", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    draw({ onSelect });
    layOut();
    const two = screen.getByRole("button", { name: "two" });
    fireEvent.pointerDown(two, point("touch", 146));
    act(() => { vi.advanceTimersByTime(450); });
    expect(two).toHaveAttribute("data-lifted");
    fireEvent.pointerUp(two, point("touch", 147));
    fireEvent.click(two);
    expect(screen.getByRole("dialog", { name: "two" })).toBeInTheDocument();
    expect(two).not.toHaveAttribute("data-lifted");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("leaves a finger that slides before the hold to scroll the strip", () => {
    vi.useFakeTimers();
    draw();
    layOut();
    const two = screen.getByRole("button", { name: "two" });
    fireEvent.pointerDown(two, point("touch", 146));
    fireEvent.pointerMove(two, point("touch", 120));
    act(() => { vi.advanceTimersByTime(600); });
    expect(two).not.toHaveAttribute("data-lifted");
    fireEvent.pointerUp(two, point("touch", 120));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves a tab one place from its actions, and offers no way past either end", async () => {
    const bodies: unknown[] = [];
    server.use(http.post(/\/api\/tab\/[^/]+\/move$/, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ ok: true });
    }));
    const user = userEvent.setup();
    draw();
    fireEvent.contextMenu(screen.getByRole("button", { name: "one" }));
    expect(screen.queryByRole("button", { name: "Move left" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Move right" }));
    expect(names()).toEqual(["two", "one", "three"]);
    await waitFor(() => expect(bodies).toEqual([{ before: "w1:t3" }]));
    fireEvent.contextMenu(screen.getByRole("button", { name: "three" }));
    expect(screen.queryByRole("button", { name: "Move right" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move left" })).toBeInTheDocument();
  });

  it("doesn't drag, or offer a move, on a device that can't write", () => {
    draw({ readOnly: true });
    layOut();
    const one = screen.getByRole("button", { name: "one" });
    expect(one).not.toHaveAttribute("data-reorder-key");
    fireEvent.pointerDown(one, point("mouse", 46));
    fireEvent.pointerMove(one, point("mouse", 200));
    fireEvent.pointerUp(one, point("mouse", 200));
    expect(names()).toEqual(["one", "two", "three"]);
    fireEvent.contextMenu(one);
    expect(screen.queryByRole("button", { name: "Move right" })).toBeNull();
  });
});
