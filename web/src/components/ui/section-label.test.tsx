import { render, screen } from "@testing-library/react";

import { SectionLabel } from "./section-label";

// jsdom compiles no Tailwind, so this reads the classes; the bench measures the rendered 13px/500 and
// its contrast (redesign-shots/labels-type-reach).
describe("SectionLabel", () => {
  it("names a group in sentence case at the footnote size, weight 500, in the tertiary tone", () => {
    render(<SectionLabel>Keys</SectionLabel>);
    const label = screen.getByText("Keys");
    expect(label).toHaveClass("text-footnote", "font-medium", "text-subtle-foreground");
    expect(label.className).not.toMatch(/\buppercase\b|\btracking-/);
  });
});
