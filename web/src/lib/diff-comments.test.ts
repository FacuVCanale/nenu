import { diffCommentsCarried, diffCommentsFor, forgetDiffComments, saveDiffComment, withDiffComments, type DiffComment } from "./diff-comments";

// Comments on a diff's lines wait in this browser, per pane, until the message carrying them is sent.
// Each test names its own pane: the store is module state, like the drafts.

const cart = { path: "app/cart.ts", side: "+", line: 21, quote: "  const discount = applyCoupon(input.coupon, input.total);" } as const;
const checkout = { path: "app/checkout.tsx", side: "-", line: 41, quote: "  const value40 = input.items.filter((item) => item.checkout > 40).length;" } as const;

afterEach(() => vi.restoreAllMocks());

describe("the comments of a pane", () => {
  it("keeps one comment a line: saving again replaces it, saving nothing removes it", () => {
    saveDiffComment("w9:p1", undefined, cart, "Check the expiry");
    saveDiffComment("w9:p1", undefined, cart, "  Check the coupon's   expiry\nfirst ");
    expect(diffCommentsFor("w9:p1")).toEqual([{ ...cart, text: "Check the coupon's expiry first" }]);
    saveDiffComment("w9:p1", undefined, cart, "   ");
    expect(diffCommentsFor("w9:p1")).toEqual([]);
  });

  it("tells an added line from a removed one with the same number", () => {
    saveDiffComment("w9:p2", undefined, { ...cart, side: "-" }, "Why was this removed?");
    saveDiffComment("w9:p2", undefined, cart, "Name it couponDiscount");
    expect(diffCommentsFor("w9:p2").map((c) => `${c.side}${c.line} ${c.text}`)).toEqual(["+21 Name it couponDiscount", "-21 Why was this removed?"]);
  });

  it("belongs to its pane and its session, never another's", () => {
    saveDiffComment("w9:p3", undefined, cart, "For p3");
    saveDiffComment("w9:p4", undefined, checkout, "For p4");
    saveDiffComment("w9:p3", "work", checkout, "For p3 on work");
    expect(diffCommentsFor("w9:p3").map((c) => c.text)).toEqual(["For p3"]);
    expect(diffCommentsFor("w9:p4").map((c) => c.text)).toEqual(["For p4"]);
    expect(diffCommentsFor("w9:p3", "work").map((c) => c.text)).toEqual(["For p3 on work"]);
  });

  it("lists them in file and line order, whichever was written first", () => {
    saveDiffComment("w9:p5", undefined, checkout, "Second file");
    saveDiffComment("w9:p5", undefined, { ...cart, line: 30 }, "Later line");
    saveDiffComment("w9:p5", undefined, cart, "Earlier line");
    expect(diffCommentsFor("w9:p5").map((c) => c.text)).toEqual(["Earlier line", "Later line", "Second file"]);
  });

  it("forgets the comments a message carried, but not one edited since", () => {
    saveDiffComment("w9:p6", undefined, cart, "Sent");
    saveDiffComment("w9:p6", undefined, checkout, "Also sent");
    const carried = diffCommentsFor("w9:p6");
    saveDiffComment("w9:p6", undefined, checkout, "Edited while sending");
    forgetDiffComments("w9:p6", undefined, carried);
    expect(diffCommentsFor("w9:p6").map((c) => c.text)).toEqual(["Edited while sending"]);
  });

  it("survives a reload of the page, and ignores what it cannot read back", async () => {
    saveDiffComment("w9:p7", undefined, cart, "Kept across a reload");
    vi.resetModules();
    const fresh = await import("./diff-comments");
    expect(fresh.diffCommentsFor("w9:p7")).toEqual([{ ...cart, text: "Kept across a reload" }]);

    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      if (sessionStorage.getItem(key)!.includes("Kept across a reload")) sessionStorage.setItem(key, '[{"path":1},"x"');
    }
    vi.resetModules();
    expect((await import("./diff-comments")).diffCommentsFor("w9:p7")).toEqual([]);
  });

  it("still holds them when the browser refuses to store them", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
    saveDiffComment("w9:p8", undefined, cart, "In memory only");
    expect(diffCommentsFor("w9:p8").map((c) => c.text)).toEqual(["In memory only"]);
  });
});

describe("the message", () => {
  const comments: DiffComment[] = [{ ...cart, text: "Check the coupon's expiry first." }, { ...checkout, text: "Keep filter here." }];

  it("puts the comments first, one a line with file:line and the line quoted, then the draft", () => {
    expect(withDiffComments(comments, "Please address these.")).toBe([
      "Comments on the diff:",
      "- app/cart.ts:21 `+ const discount = applyCoupon(input.coupon, input.total);` Check the coupon's expiry first.",
      "- app/checkout.tsx:41 `- const value40 = input.items.filter((item) => item.checkout > 40).length;` Keep filter here.",
      "",
      "Please address these.",
    ].join("\n"));
  });

  it("is the comments alone when nothing was typed, and the draft alone without comments", () => {
    expect(withDiffComments(comments.slice(0, 1), "")).toBe("Comments on the diff:\n- app/cart.ts:21 `+ const discount = applyCoupon(input.coupon, input.total);` Check the coupon's expiry first.");
    expect(withDiffComments([], "Just this")).toBe("Just this");
  });

  it("leaves a slash command alone, and the comments for the next message", () => {
    expect(withDiffComments(comments, "/compact")).toBe("/compact");
    expect(diffCommentsCarried("/compact", comments)).toEqual([]);
    expect(diffCommentsCarried(withDiffComments(comments, "Go"), comments)).toBe(comments);
  });

  it("quotes a line holding backticks so it stays one code span, and clips a long one", () => {
    const [ticks] = [{ ...cart, quote: "const s = `a ${b}`", text: "Use a plain string" }];
    expect(withDiffComments([ticks], "")).toContain("- app/cart.ts:21 `` + const s = `a ${b}` `` Use a plain string");
    const long = withDiffComments([{ ...cart, quote: "x".repeat(400), text: "Too long" }], "");
    expect(long).toContain(`\`+ ${"x".repeat(159)}…\` Too long`);
  });
});
