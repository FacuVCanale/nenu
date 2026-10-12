import { revealScrollLeft } from "./strip-reveal";

// A strip 300px wide over 1000px of chips: where it scrolls so the open tab or pane shows whole,
// clear of the 40px fade on an edge it can still scroll toward.
const strip = { width: 300, max: 700, fade: 40 };

describe("revealScrollLeft", () => {
  it("leaves the strip alone when the chip already shows whole", () => {
    expect(revealScrollLeft({ ...strip, scrollLeft: 0, start: 4, end: 120 })).toBeNull();
    expect(revealScrollLeft({ ...strip, scrollLeft: 100, start: 140, end: 360 })).toBeNull();
  });

  it("brings a chip past the right edge in, clear of that edge's fade", () => {
    expect(revealScrollLeft({ ...strip, scrollLeft: 0, start: 400, end: 520 })).toBe(520 - 300 + strip.fade);
  });

  it("brings a chip past the left edge in, clear of that edge's fade", () => {
    expect(revealScrollLeft({ ...strip, scrollLeft: 500, start: 300, end: 420 })).toBe(300 - strip.fade);
  });

  it("lines a chip wider than the strip up by its start, where its name begins", () => {
    expect(revealScrollLeft({ ...strip, scrollLeft: 0, start: 400, end: 800 })).toBe(400 - strip.fade);
  });

  it("never scrolls past either end", () => {
    expect(revealScrollLeft({ ...strip, scrollLeft: 300, start: 10, end: 90 })).toBe(0);
    expect(revealScrollLeft({ ...strip, scrollLeft: 0, start: 900, end: 996 })).toBe(700);
  });
});
