import { describe, expect, test } from "bun:test";

import { stableBun } from "./bun-path.ts";

// A command written into Claude's settings must outlive a Bun upgrade. Homebrew's
// /opt/homebrew/bin/bun survives `brew upgrade bun`; the versioned keg it points into does not, and
// that keg is what process.execPath resolves to.
describe("stableBun", () => {
  test("is the bun on PATH as found, not the binary it resolves to", () => {
    expect(stableBun(() => "/opt/homebrew/bin/bun", "/opt/homebrew/Cellar/bun/1.3.14/bin/bun")).toBe("/opt/homebrew/bin/bun");
  });

  test("falls back to the running binary when PATH has no bun", () => {
    expect(stableBun(() => null, "/home/me/.bun/bin/bun")).toBe("/home/me/.bun/bin/bun");
  });
});
