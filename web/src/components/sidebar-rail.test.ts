import { railMonograms, railHue } from "./sidebar-rail";

describe("railMonograms", () => {
  it("gives the audit's herd two word initials each, none shared", () => {
    const names = ["nenu", "api", "acme-enterprise-billing-platform-migration", "data-pipeline-backfill-2026-q4-customer-events", "personal-site",
      ...["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"].map((word) => `client-${word}-portal`)];
    expect(railMonograms(names)).toEqual(["NE", "AP", "AE", "DP", "PS", "CA", "CB", "CC", "CD", "CE", "CF"]);
  });

  it("reads words across spaces, punctuation and camelCase", () => {
    expect(railMonograms(["AWAM Comercio SaaS", "myProject", "psag", "Rediseño_mobile", "x"])).toEqual(["AC", "MP", "PS", "RM", "X"]);
  });

  it("lets the first of a colliding pair keep its initials and moves the other to letters of its own", () => {
    expect(railMonograms(["client-api", "client-alpha", "cardiff-api"])).toEqual(["CA", "AL", "AP"]);
    expect(railMonograms(["ops", "ops", "operations"])).toEqual(["OP", "OS", "OE"]);
    // An unshared first choice is never taken away by another tile's fallback.
    expect(railMonograms(["client-api", "client-alpha", "alpine"])).toEqual(["CA", "CL", "AL"]);
  });

  it("stays unique for names that are the same, and for names with no letters at all", () => {
    const shown = railMonograms(["nenu", "nenu", "nenu", "—", "—"]);
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("draws a name of only emoji as its whole first emoji, never half of one", () => {
    expect(railMonograms(["🚀", "🛸", "nenu"])).toEqual(["🚀", "🛸", "NE"]);
    expect(railMonograms(["🚀", "🚀 🛸"])).toEqual(["🚀", "🚀2"]);
  });
});

describe("railHue", () => {
  it("keeps a name's hue, and spreads names across the palette", () => {
    expect(railHue("client-alpha-portal")).toBe(railHue("client-alpha-portal"));
    const hues = new Set(["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"].map((word) => railHue(`client-${word}-portal`)));
    expect(hues.size).toBeGreaterThan(3);
  });
});
