import { isConnecting, linkPhrase, linkProblemOf } from "./connection";

describe("isConnecting (poll-truth — navigator.onLine is never an input)", () => {
  it("is false when the snapshot path is healthy (data is live)", () => {
    expect(isConnecting({ bridge: "connected", error: false })).toBe(false);
  });

  it("has no onLine gate at all — a healthy snapshot stays live no matter what the browser claims", () => {
    // Regression guard: onLine used to force isConnecting true. It's gone from ConnState now, so a
    // phone whose onLine flag lies (airplane-mode stuck true, OR stuck false after an airplane cycle
    // while the network is actually fine) can't manufacture a phantom outage while polls succeed. The
    // signature literally has no `online` to pass — a healthy snapshot is the only thing that matters.
    expect(isConnecting({ bridge: "connected", error: false })).toBe(false);
  });

  it("is true on a fetch error, before the first snapshot, and when Herdr is disconnected", () => {
    expect(isConnecting({ bridge: "connected", error: true })).toBe(true);
    expect(isConnecting({ bridge: undefined, error: false })).toBe(true);
    expect(isConnecting({ bridge: "disconnected", error: false })).toBe(true);
  });
});

it("names each problem with one phrase, the one the banner, History and the boot splash quote", () => {
  expect(linkProblemOf({ bridge: "connected", error: false, authError: false })).toBeNull();
  expect(linkProblemOf({ bridge: "connected", error: true, authError: true })).toBe("refused");
  expect(linkProblemOf({ bridge: "connected", error: true, authError: false })).toBe("nenu");
  expect(linkProblemOf({ bridge: undefined, error: true, authError: false })).toBe("nenu");
  expect(linkProblemOf({ bridge: "disconnected", error: false, authError: false })).toBe("herdr");
  expect(linkPhrase("herdr")).toBe("Herdr isn’t responding");
  expect(linkPhrase("nenu")).toBe("Can’t reach Nenu");
  expect(linkPhrase("nenu", "nenu.tail.ts.net")).toBe("Can’t reach Nenu at nenu.tail.ts.net");
  expect(linkPhrase("refused")).toBe("Access refused");
});
