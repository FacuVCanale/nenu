import { thirdScrollTop } from "./find-bar";

// Find leaves the current match a third of the way down what the reader can see, under any chrome
// drawn over the list, so the lines before it give it context and the eye lands in the same place on
// every step (T31). jsdom lays nothing out, so the arithmetic is tested here and the bench measures it.
describe("thirdScrollTop", () => {
  it("scrolls the match to a third of the visible list", () => {
    // List from 100 to 700 on screen, match drawn at 900 while scrolled to 50.
    expect(thirdScrollTop({ scrollTop: 50, viewTop: 100, viewBottom: 700, hitTop: 900 })).toBe(650);
  });

  it("measures the third from below chrome drawn over the list", () => {
    // The chrome covers the list's top 80 px, so the reader sees 180 to 700: a third down is 353.
    expect(thirdScrollTop({ scrollTop: 0, viewTop: 100, viewBottom: 700, hitTop: 600, inset: 80 })).toBe(247);
  });

  it("never asks for a scroll above the top", () => {
    expect(thirdScrollTop({ scrollTop: 0, viewTop: 100, viewBottom: 700, hitTop: 150 })).toBe(0);
  });
});
