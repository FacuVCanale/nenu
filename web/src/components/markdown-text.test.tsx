import { render, screen } from "@testing-library/react";

import { FilePreviewContext } from "@/lib/file-preview-context";
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

describe("inline code", () => {
  const code = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll("code")].find((el) => el.textContent === text)!;

  it("keeps a short identifier on one line, moving it down whole instead of splitting it", () => {
    const { container } = render(<MarkdownText text="porque `workbench-composer` usa `--page-gutter` a los costados" />);
    for (const token of ["workbench-composer", "--page-gutter"]) {
      expect(code(container, token)).toHaveClass("whitespace-nowrap");
      expect(code(container, token)).not.toHaveClass("break-all");
    }
  });

  it("lets a span longer than any line wrap where it must, never at every letter", () => {
    const { container } = render(<MarkdownText text="sale de un solo lugar (`max(env(safe-area-inset-bottom), 8px)`)" />);
    const span = code(container, "max(env(safe-area-inset-bottom), 8px)");
    expect(span).toHaveClass("[overflow-wrap:anywhere]");
    expect(span).not.toHaveClass("whitespace-nowrap");
    expect(span).not.toHaveClass("break-all");
  });

  it("wraps file links the same way: a short path whole, a link label at word boundaries", () => {
    render(
      <FilePreviewContext.Provider value={() => {}}>
        <MarkdownText text="Saqué el padding en `index.css`, ver [las notas del rediseño](docs/notas.md) y [la guía](https://example.com/guide)." />
      </FilePreviewContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "index.css" })).toHaveClass("whitespace-nowrap");
    for (const control of [screen.getByRole("button", { name: "index.css" }), screen.getByRole("button", { name: "las notas del rediseño" }), screen.getByRole("link", { name: "la guía" })]) {
      expect(control).not.toHaveClass("break-all");
    }
  });
});
