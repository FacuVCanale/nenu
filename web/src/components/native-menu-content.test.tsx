import { render, screen } from "@testing-library/react";
import { parseAnsi } from "@/lib/ansi";
import { splitLines, type MenuModel } from "@/lib/blocks";
import { NativeMenuContent } from "./native-menu-content";

const menu: MenuModel = {
  title: "Review changes", signature: "screen", nav: { upDown: true },
  actions: [{ label: "Apply", keys: ["Enter"] }, { label: "Cancel", keys: ["Escape"], cancel: true }],
};

it("retains the subject and command context as native text without inventing clickable options", () => {
  const lines = splitLines(parseAnsi("▔▔▔▔▔▔\nReview changes\nThis affects production settings.\n  config: { enabled: false }\n❯ 1. Keep settings  Leave the current value\n  2. Apply settings  Change the saved value\nEnter to apply · Esc to cancel\n▔▔▔▔▔▔"));
  const { container } = render(<NativeMenuContent menu={menu} lines={lines} />);
  expect(container.querySelector("pre")).toBeNull();
  expect(container.textContent).not.toContain("▔");
  expect(screen.getByText("This affects production settings.")).toBeInTheDocument();
  expect(screen.getByText("config: { enabled: false }")).toBeInTheDocument();
  expect(screen.getByText("Leave the current value")).toBeInTheDocument();
  expect(screen.getByLabelText("Highlighted")).toBeInTheDocument();
  expect(screen.queryByText("Enter to apply · Esc to cancel")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});

it("retains unsupported footer hints and treats embedded markup as literal text", () => {
  const footer = "Enter to apply · 1 to save permanently · Esc to cancel";
  const lines = splitLines(parseAnsi(`Review changes\n<img src=x onerror=alert(1)>\n${footer}`));
  const { container } = render(<NativeMenuContent menu={menu} lines={lines} />);
  expect(screen.getByText(footer)).toBeInTheDocument();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
});

// Drawn inside the card, the screen's lines read as the card's text, not as a terminal: the card sits
// in the conversation's scroller, so no scroller of its own; the screen's indent survives as a hanging
// indent (a wrapped row lines up under itself); and the highlighted row is marked, not filled like a
// button, because tapping it does nothing.
it("reads as the card's text: no scroller, the screen's indent kept as a hanging indent, the highlighted row marked without a fill", () => {
  const lines = splitLines(parseAnsi("Review changes\n  This affects production settings and every session that reads them.\n    config: { enabled: false }\n  ❯ Keep settings\n    Apply settings\nEnter to apply · Esc to cancel"));
  const { container } = render(<NativeMenuContent menu={menu} lines={lines} />);
  for (const el of container.querySelectorAll("*")) expect(el.getAttribute("class") ?? "").not.toMatch(/overflow-(y-)?(auto|scroll)|max-h-/);
  const prose = screen.getByText("This affects production settings and every session that reads them.");
  expect(prose.textContent).toBe("This affects production settings and every session that reads them.");
  const nested = screen.getByText("config: { enabled: false }");
  expect(nested.textContent).toBe("config: { enabled: false }");
  expect(nested).toHaveStyle({ paddingLeft: "2ch" });
  expect(screen.getByText("Apply settings").closest("[data-row]")).toHaveStyle({ paddingLeft: "2ch" });
  const highlighted = screen.getByLabelText("Highlighted").closest("[data-row]")!;
  expect(highlighted).toHaveTextContent("Keep settings");
  expect(highlighted.getAttribute("class") ?? "").not.toMatch(/\bbg-/);
});
