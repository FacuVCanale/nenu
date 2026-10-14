import { render } from "@testing-library/react";

import { ProjectGlyph } from "./project-glyph";

describe("ProjectGlyph", () => {
  it("draws the slug's glyph in its hue's token, decorative, at the size asked", () => {
    const { container } = render(<ProjectGlyph slug="acme-shop" size={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
    expect(svg).toHaveAttribute("width", "20");
    expect(svg).toHaveAttribute("data-glyph", "peak");
    expect(svg.style.color).toBe("var(--glyph-teal)");
  });

  it("is 16px by default and costs at most three paths, with no animation", () => {
    for (const slug of ["acme-shop", "support-bot", "onboarding", "billing-api"]) {
      const { container, unmount } = render(<ProjectGlyph slug={slug} />);
      const svg = container.querySelector("svg")!;
      expect(svg).toHaveAttribute("width", "16");
      expect(svg.querySelectorAll("*").length, slug).toBeLessThanOrEqual(3);
      expect([...svg.querySelectorAll("*")].every((node) => node.tagName === "path"), slug).toBe(true);
      expect(svg.querySelector("animate, animateTransform")).toBeNull();
      unmount();
    }
  });
});
