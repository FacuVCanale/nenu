import { act, fireEvent, render, screen } from "@testing-library/react";

import { Chip, ChipStrip } from "./chip";

// jsdom lays nothing out, so here a strip is 300px wide and its chips sit in a row 8px apart, each as
// wide as `widths` says for its name (80px otherwise). The bench measures the real thing.
const STRIP = 300;
const GAP = 8;
let widths: Record<string, number> = {};
const widthOf = (chip: HTMLElement) => widths[chip.title] ?? 80;
const chipsIn = (scroller: Element | null) => [...(scroller?.querySelectorAll<HTMLElement>(".strip-chip") ?? [])];

class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.all.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
/** What the browser does after a layout that changed an observed box. */
const layoutChanged = () =>
  act(() => FakeResizeObserver.all.forEach((o) => o.callback([], o as unknown as ResizeObserver)));

beforeEach(() => {
  widths = {};
  FakeResizeObserver.all = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("strip-chip") ? widthOf(this) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    let left = 0;
    for (const chip of chipsIn(this.closest(".strip-scroller"))) {
      if (chip === this) return left;
      left += widthOf(chip) + GAP;
    }
    return 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.classList.contains("strip-scroller") ? STRIP : 0;
  });
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    if (!this.classList.contains("strip-scroller")) return 0;
    const chips = chipsIn(this);
    return chips.reduce((sum, chip) => sum + widthOf(chip), 0) + GAP * Math.max(0, chips.length - 1);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Item = { key: string; label: string };
const items = (...labels: string[]): Item[] => labels.map((label) => ({ key: label, label }));

function Strip({ chips, open }: { chips: Item[]; open: string }) {
  return (
    <ChipStrip band="panes" activeKey={open}>
      {chips.map((c) => (
        <Chip key={c.key} label={c.label} active={c.key === open} onClick={() => {}} />
      ))}
    </ChipStrip>
  );
}

const scroller = () => screen.getAllByRole("button")[0]!.closest<HTMLElement>(".strip-scroller")!;

describe("ChipStrip keeps the open chip in view", () => {
  it("when a rename grows it past the edge", () => {
    const { rerender } = render(<Strip chips={items("a", "b", "c")} open="c" />);
    widths["c, renamed for the billing migration"] = 220;
    rerender(<Strip chips={[...items("a", "b"), { key: "c", label: "c, renamed for the billing migration" }]} open="c" />);
    layoutChanged();
    // 80 + 8 + 80 + 8 + 220 = 396 wide in 300: as far as it goes, 96.
    expect(scroller().scrollLeft).toBe(96);
  });

  it("when a chip arrives before it and pushes it out", () => {
    const { rerender } = render(<Strip chips={items("a", "b")} open="b" />);
    widths["new pane"] = 200;
    rerender(<Strip chips={items("a", "new pane", "b")} open="b" />);
    layoutChanged();
    expect(scroller().scrollLeft).toBe(80 + 8 + 200 + 8 + 80 - STRIP);
  });

  it("when its box changes with no render at all, as when the web font lands", () => {
    widths.c = 100;
    render(<Strip chips={items("a", "b", "c")} open="c" />);
    expect(scroller().scrollLeft).toBe(0);
    widths.c = 140;
    layoutChanged();
    expect(scroller().scrollLeft).toBe(80 + 8 + 80 + 8 + 140 - STRIP);
  });

  it("but leaves a strip the user scrolled by hand where they left it while the open chip stays put", () => {
    const { rerender } = render(<Strip chips={items("a", "b", "c", "d", "e")} open="a" />);
    scroller().scrollLeft = 100;
    fireEvent.scroll(scroller());
    rerender(<Strip chips={items("a", "b", "c", "d", "e")} open="a" />);
    layoutChanged();
    expect(scroller().scrollLeft).toBe(100);
  });
});
