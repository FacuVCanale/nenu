import { dropIndex, moveKey, shiftFor, type ReorderSlot } from "./strip-reorder";

// Three 92px chips 8px apart, as a strip lays out three short names.
const slots: ReorderSlot[] = [
  { key: "a", start: 0, width: 92 },
  { key: "b", start: 100, width: 92 },
  { key: "c", start: 200, width: 92 },
];

describe("dropIndex", () => {
  it("keeps a chip in its slot until its middle crosses a neighbour's", () => {
    expect(dropIndex(slots, 1, 0)).toBe(1);
    expect(dropIndex(slots, 1, 99)).toBe(1);
    expect(dropIndex(slots, 1, 101)).toBe(2);
    expect(dropIndex(slots, 1, -101)).toBe(0);
  });

  it("stops at either end however far the chip goes", () => {
    expect(dropIndex(slots, 0, 5000)).toBe(2);
    expect(dropIndex(slots, 2, -5000)).toBe(0);
  });
});

describe("moveKey", () => {
  it("takes the key out and puts it at the new index", () => {
    expect(moveKey(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveKey(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("shiftFor", () => {
  it("slides the chips between the two slots by the dragged chip and a gap, toward where it was", () => {
    expect([0, 1, 2].map((i) => shiftFor(slots, 0, 2, i))).toEqual([0, -100, -100]);
    expect([0, 1, 2].map((i) => shiftFor(slots, 2, 0, i))).toEqual([100, 100, 0]);
    expect([0, 1, 2].map((i) => shiftFor(slots, 1, 1, i))).toEqual([0, 0, 0]);
  });
});
