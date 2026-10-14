import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAnsi } from "../../ansi";
import { splitLines } from "../../blocks";
import { codexAdapter } from "./index";

// Codex 0.162.1's startup screen when the operator's hooks are new or changed (HOOKS_NOTES.md).
const review = readFileSync(join(import.meta.dirname, "fixtures/hooks-review-v0162.txt"), "utf8");
const linesOf = (text: string) => splitLines(parseAnsi(text));
const promptOf = (text: string) => {
  const block = codexAdapter.buildBlocks(linesOf(text)).find((b) => b.kind === "prompt-select");
  return block?.kind === "prompt-select" ? block.prompt : null;
};

describe("Codex's hooks review", () => {
  it("lifts the three rows as a pointer walk plus the Enter the footer names, never a digit", () => {
    const prompt = promptOf(review);
    expect(prompt?.family).toBe("trust");
    expect(prompt?.question).toBe("Hooks need review");
    expect(prompt?.options).toEqual([
      { label: "Review hooks", keys: ["Enter"], keyLabel: "›" },
      { label: "Trust all and continue", keys: ["Down", "Enter"] },
      { label: "Continue without trusting (hooks won't run)", keys: ["Down", "Down", "Enter"] },
    ]);
    // What the operator is trusting stays in the signature the answer is checked against.
    expect(prompt?.signature).toContain("3 hooks are new or changed.");
    expect(prompt?.signature).toContain("Hooks can run outside the sandbox after you trust them.");
    expect(codexAdapter.composerReady!(linesOf(review))).toBe(false);
  });

  it("walks from wherever a digit left the pointer", () => {
    // A digit only moves the pointer on this screen (measured): row 2 pointed, then Up or Down.
    const moved = review.replace(/^.*1\. Review hooks.*$/m, "  1. Review hooks").replace("  2. Trust all", "› 2. Trust all");
    expect(promptOf(moved)?.options.map((o) => o.keys)).toEqual([["Up", "Enter"], ["Enter"], ["Down", "Enter"]]);
  });

  it.each([
    ["another footer", (s: string) => s.replace(/confirm.*skip/, "continue · esc skip")],
    ["a renamed row", (s: string) => s.replace("Trust all and continue", "Trust all")],
    ["a fourth row", (s: string) => s.replace(/(3\. Continue without trusting[^\n]*\n)/, "$1  4. Something else\n")],
    ["no heading", (s: string) => s.replace("Hooks need review", "Something to review")],
    ["no pointer", (s: string) => s.replace("› 1.", "  1.")],
    ["output under the footer", (s: string) => `${s}\nnew output`],
  ])("refuses %s", (_name, edit) => {
    expect(promptOf(edit(review))).toBeNull();
  });
});
