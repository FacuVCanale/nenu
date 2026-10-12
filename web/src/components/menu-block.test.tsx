import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { parseAnsi } from "@/lib/ansi";
import { splitLines } from "@/lib/blocks";
import { claudeBuildBlocks } from "@/lib/harness/claude";
import { MenuBlock } from "./menu-block";

// The generic fallback uses real captured content with a non-model title so its verified
// navigation/footer behavior stays covered independently of the native model renderer.

const PICKER = readFileSync(
  join(import.meta.dirname, "..", "fixtures", "panes", "claude--menu-model-picker.txt"),
  "utf8",
);

function menuBlock() {
  const block = claudeBuildBlocks(splitLines(parseAnsi(PICKER))).find((b) => b.kind === "menu");
  if (!block || block.kind !== "menu") throw new Error("the picker fixture lifted no menu block");
  return block;
}

function renderMenu(onAction = vi.fn()) {
  const block = menuBlock();
  render(<MenuBlock menu={{ ...block.menu, title: "Settings" }} lines={block.lines} onAction={onAction} />);
  return onAction;
}

describe("MenuBlock generic fallback", () => {
  it("renders the footer's actions, the cancel, and the nav the screen advertised", () => {
    renderMenu();
    expect(screen.getByRole("button", { name: "Set as default" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this session only" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move down" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /right — adjust/i })).toBeInTheDocument();
  });

  it("draws the menu as the card: its title as the question, one filled commit, Cancel with the utilities", () => {
    renderMenu();
    const card = screen.getByRole("region", { name: "Settings" });
    expect(within(card).getByText("Waiting on you")).toBeInTheDocument();
    // No terminal-style caption: the title reads as the card's question.
    expect(within(card).getByText("Settings")).not.toHaveClass("uppercase");
    expect(screen.getByRole("button", { name: "Cancel" }).closest("[data-secondary-actions]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Set as default" }).closest("[data-secondary-actions]")).toBeNull();
  });

  // The arrows are unreadable on their own — the cluster has to say WHAT it adjusts, both visibly and
  // in the accessible names, and that text is the row's live value.
  it("labels the ←/→ cluster with the value it adjusts", () => {
    renderMenu();
    expect(
      screen.getByRole("button", { name: "Left — adjust (◐ Medium effort)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Right — adjust (◐ Medium effort)" }),
    ).toBeInTheDocument();
    // …and visibly, between them.
    expect(screen.getAllByText("◐ Medium effort").length).toBeGreaterThan(0);
  });

  // The generic body keeps option descriptions visible as native text; footer controls must
  // remain grounded in the full context even when the row grammar is unknown.
  it("keeps the menu subject readable above the controls", () => {
    renderMenu();
    expect(screen.getByText(/Most capable for your hardest/)).toBeInTheDocument();
  });

  // .adr/0009 at the UI edge: a digit tap here would confirm AND persist the user's default model.
  it("offers no digit buttons", () => {
    renderMenu();
    for (const button of screen.getAllByRole("button")) {
      expect(/^\d+$/.test(button.textContent ?? ""), button.textContent ?? "").toBe(false);
    }
  });

  it("sends a footer key as a committing action and an arrow as nav", async () => {
    const user = userEvent.setup();
    const onAction = renderMenu();

    await user.click(screen.getByRole("button", { name: "Use this session only" }));
    expect(onAction).toHaveBeenCalledWith({ keys: ["s"], nav: false });

    await user.click(screen.getByRole("button", { name: "Move down" }));
    expect(onAction).toHaveBeenCalledWith({ keys: ["Down"], nav: true });
  });

  it("renders but refuses taps when disabled", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const block = menuBlock();
    render(<MenuBlock menu={block.menu} lines={block.lines} onAction={onAction} disabled />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAction).not.toHaveBeenCalled();
  });
});
