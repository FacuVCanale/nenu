import { render } from "@testing-library/react";

import { MarkdownText } from "./markdown-text";

// jsdom computes no Tailwind, so these read the classes the type scale and the wrapping rules hang
// on; the bench (redesign-shots/chat-text) measures the rendered sizes and line boxes.

describe("prose size", () => {
  it("sets agent prose in the body step, the size the composer types in", () => {
    const { container } = render(<MarkdownText text="El composer tapaba el último mensaje." />);
    expect(container.firstElementChild).toHaveClass("text-body");
    expect(container.firstElementChild).not.toHaveClass("text-sm");
  });

  it("lets a caller pick a quieter step for secondary text", () => {
    const { container } = render(<MarkdownText text="Thinking about it." className="text-subhead" />);
    expect(container.firstElementChild).toHaveClass("text-subhead");
    expect(container.firstElementChild).not.toHaveClass("text-body");
  });

  it("keeps every heading level at or above the body step", () => {
    const { container } = render(<MarkdownText text={"# One\n\n## Two\n\n### Three\n\n#### Four"} />);
    const headings = [...container.querySelectorAll(".font-semibold")];
    expect(headings).toHaveLength(4);
    for (const heading of headings) expect(heading.className).toMatch(/\btext-(body|headline)\b/);
  });
});
