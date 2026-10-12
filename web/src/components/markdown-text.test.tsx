import { act, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

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

  it("sets a table one step below the prose, with figures that line up", () => {
    const { container } = render(<MarkdownText text={"| Pantalla | Antes |\n| --- | ---: |\n| iPhone | 412 px |"} />);
    expect(container.querySelector("table")).toHaveClass("text-footnote", "tabular-nums");
  });

  it("keeps every heading level at or above the body step", () => {
    render(<MarkdownText text={"# One\n\n## Two\n\n### Three\n\n#### Four"} />);
    for (const name of ["One", "Two"]) expect(screen.getByText(name)).toHaveClass("text-headline");
    for (const name of ["Three", "Four"]) expect(screen.getByText(name)).toHaveClass("text-body", "font-semibold");
  });
});

describe("inline code", () => {
  const code = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll("code")].find((el) => el.textContent === text)!;

  // A short span sits in an inline box capped at the line: it moves down whole when it does not fit
  // what is left of the line, and breaks inside itself only when it is wider than a whole line (page
  // zoom narrows the bubble to about 194px on a 390px phone at 150%). Nothing may forbid that break.
  it("moves a short identifier down whole, and splits it only when it is wider than the line", () => {
    const { container } = render(<MarkdownText text="porque `workbench-composer` usa `--page-gutter` a los costados" />);
    for (const token of ["workbench-composer", "--page-gutter"]) {
      const whole = code(container, token).closest(".inline-block");
      expect(whole).toHaveClass("max-w-full", "[overflow-wrap:anywhere]");
      expect(code(container, token)).not.toHaveClass("break-all");
    }
    expect(container.querySelector(".whitespace-nowrap")).toBeNull();
  });

  it("lets a span longer than any line wrap where it must, never at every letter", () => {
    const { container } = render(<MarkdownText text="sale de un solo lugar (`max(env(safe-area-inset-bottom), 8px)`)" />);
    const span = code(container, "max(env(safe-area-inset-bottom), 8px)");
    expect(span).toHaveClass("[overflow-wrap:anywhere]");
    expect(span.closest(".inline-block")).toBeNull();
    expect(span).not.toHaveClass("whitespace-nowrap");
    expect(span).not.toHaveClass("break-all");
  });

  it("wraps file links the same way: a short path whole, a link label at word boundaries", () => {
    render(
      <FilePreviewContext.Provider value={() => {}}>
        <MarkdownText text="Saqué el padding en `index.css`, ver [las notas del rediseño](docs/notas.md) y [la guía](https://example.com/guide)." />
      </FilePreviewContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "index.css" })).toHaveClass("inline-block", "max-w-full", "[overflow-wrap:anywhere]");
    expect(screen.getByRole("button", { name: "index.css" })).not.toHaveClass("whitespace-nowrap");
    for (const control of [screen.getByRole("button", { name: "index.css" }), screen.getByRole("button", { name: "las notas del rediseño" }), screen.getByRole("link", { name: "la guía" })]) {
      expect(control).not.toHaveClass("break-all");
    }
  });
});

describe("code blocks", () => {
  const SOURCE = "export function ComposerShell() {\n  return <div className=\"workbench-composer\" />;\n}";
  const BLOCK = "Así queda:\n\n```tsx\n" + SOURCE + "\n```";
  const writeText = vi.fn<(text: string) => Promise<void>>();
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("names its language and copies its exact text with one tap", async () => {
    const { container } = render(<MarkdownText text={BLOCK} />);
    expect(screen.getByText("tsx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(SOURCE);
    expect(container.querySelector("pre")).toHaveTextContent(SOURCE.replace(/\s+/g, " "));
  });

  // "Failed" is no wider than "Copied", so the button the header reserves for both never grows and
  // Wrap stays under the finger (the bench measures the widths).
  it("says so when the clipboard refuses, and offers Copy again", async () => {
    vi.useFakeTimers();
    try {
      writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
      render(<MarkdownText text={BLOCK} />);
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await act(async () => {});
      expect(screen.getByRole("button", { name: "Failed" })).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2500));
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies even a block with no language, and keeps its header controls in touch reach", () => {
    render(<MarkdownText text={"```\nbun run test\n```"} />);
    const copy = screen.getByRole("button", { name: "Copy" });
    const wrap = screen.getByRole("button", { name: "Wrap" });
    for (const control of [copy, wrap]) expect(control).toHaveClass("hit-area");
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith("bun run test");
  });

  it("wraps long lines on request instead of scrolling them", () => {
    const { container } = render(<MarkdownText text={BLOCK} />);
    const wrap = screen.getByRole("button", { name: "Wrap" });
    const pre = container.querySelector("pre")!;
    expect(wrap).toHaveAttribute("aria-pressed", "false");
    expect(pre).toHaveClass("whitespace-pre");
    fireEvent.click(wrap);
    expect(wrap).toHaveAttribute("aria-pressed", "true");
    expect(pre).toHaveClass("whitespace-pre-wrap");
    expect(pre).not.toHaveClass("whitespace-pre");
  });

  it("fades its right edge only while code is hidden past it", () => {
    const sizes = { scrollWidth: 986, clientWidth: 352, scrollLeft: 0 };
    const spies = (Object.keys(sizes) as (keyof typeof sizes)[]).map((key) =>
      vi.spyOn(HTMLElement.prototype, key, "get").mockImplementation(() => sizes[key]));
    try {
      const { container } = render(<MarkdownText text={BLOCK} />);
      const pre = container.querySelector("pre")!;
      expect(pre).toHaveAttribute("data-clipped");
      sizes.scrollLeft = 634;
      fireEvent.scroll(pre);
      expect(pre).not.toHaveAttribute("data-clipped");
      sizes.scrollLeft = 300;
      fireEvent.scroll(pre);
      expect(pre).toHaveAttribute("data-clipped");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("does not fade a block that fits", () => {
    const { container } = render(<MarkdownText text={"```sh\nls\n```"} />);
    expect(container.querySelector("pre")).not.toHaveAttribute("data-clipped");
  });
});

describe("find hits", () => {
  const TEXT = "El `workbench-composer` tapaba el composer.\n\n```css\n.workbench-composer { margin: 0 }\n```";

  it("marks every hit, and names none of them current outside the current match", () => {
    const { container } = render(<MarkdownText text={TEXT} query="composer" />);
    const marks = [...container.querySelectorAll("mark")];
    expect(marks).toHaveLength(3);
    for (const mark of marks) expect(mark).not.toHaveAttribute("aria-current");
  });

  it("gives the current match's hits, prose, code and block alike, their own solid fill", () => {
    const { container } = render(<><MarkdownText text={TEXT} query="composer" current /><MarkdownText text={TEXT} query="composer" /></>);
    const [current, other] = [...container.children].map((root) => [...root.querySelectorAll("mark")]);
    expect(current).toHaveLength(3);
    for (const mark of current!) expect(mark).toHaveAttribute("aria-current", "true");
    expect(current![0]!.className).not.toBe(other![0]!.className);
  });
});
