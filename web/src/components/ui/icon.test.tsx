import { render, screen } from "@testing-library/react";

import { Check, ChatCircle, Search, Sparkle } from "./icon";

it("draws a stroked glyph at 1.5 on a 24 grid, named by its class", () => {
  const { container } = render(<Search className="size-4" />);
  const svg = container.querySelector("svg")!;
  expect(svg).toHaveClass("icon", "icon-search", "size-4");
  expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  expect(svg).toHaveAttribute("stroke-width", "1.5");
  expect(svg).toHaveAttribute("fill", "none");
  expect(svg.querySelectorAll("path")).toHaveLength(1);
});

it("draws the agent and its messages as Phosphor fills, with no stroke to thicken", () => {
  for (const Glyph of [Sparkle, ChatCircle]) {
    const { container, unmount } = render(<Glyph strokeWidth={3} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 256 256");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).not.toHaveAttribute("stroke-width");
    unmount();
  }
});

it("is decorative unless it is given a name", () => {
  const { container } = render(<><Check /><Check aria-label="Sending" /></>);
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByLabelText("Sending")).not.toHaveAttribute("aria-hidden");
});

it("passes size and weight through, as the screens set them", () => {
  const { container } = render(<Check size={14} strokeWidth={2.5} />);
  const svg = container.querySelector("svg")!;
  expect(svg).toHaveAttribute("width", "14");
  expect(svg).toHaveAttribute("stroke-width", "2.5");
});
