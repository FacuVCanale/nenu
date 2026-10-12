import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";

import { parseAnsi } from "@/lib/ansi";
import { splitLines } from "@/lib/blocks";
import { claudeBuildBlocks } from "@/lib/harness/claude";
import { detectMultiSelect } from "@/lib/harness/claude/multi-select";
import { detectPreviewSelect } from "@/lib/harness/claude/preview-select";
import { detectPromptSelect } from "@/lib/harness/claude/prompt-select";
import { detectWizard } from "@/lib/harness/claude/wizard";
import type { Interaction } from "@/lib/types";
import { MenuBlock } from "./menu-block";
import { MultiSelectBlock } from "./multi-select-block";
import { PreviewSelectBlock } from "./preview-select-block";
import { PromptSelectBlock } from "./prompt-select-block";
import { QuestionCard } from "./question-card";
import { WizardBlock } from "./wizard-block";

// Every dialog card draws the same kind of choice the same way (QA 1, 4, 9, 16): its options as one
// grouped list with no row filled in ink or tinted blue, a selection as the neutral row fill with the
// blue left on the control, any ink action as the Button's one large primary, a rounded-xl card, and
// text from the type scale. jsdom compiles no Tailwind, so these read the classes the bench then
// measures (redesign-shots/choice-cards).

const PANES = join(import.meta.dirname, "..", "fixtures", "panes");
const screenOf = (name: string) => splitLines(parseAnsi(readFileSync(join(PANES, name), "utf8")));
function lift<T>(model: T | null | undefined, name: string): T {
  if (!model) throw new Error(`${name} lifted nothing`);
  return model;
}

const base = { paneId: "w1:p1", agent: "claude", signature: "sig-1", revision: 1, detectedAt: 0 };
const permission: Interaction = {
  ...base, kind: "permission", family: "permission", question: "Do you want to proceed?", detailComplete: true,
  subject: { tool: "Bash", description: "Write hi into hello.txt", command: "echo hi > hello.txt", meta: ["Environment: local"] },
  terminalOnly: ["Yes, and don't ask again for these files"],
  options: [
    { index: 0, label: "Yes", role: "primary", acceptsText: true },
    { index: 1, label: "Yes, and don’t ask again for: echo *", role: "persistent" },
    { index: 2, label: "No", role: "deny", description: "Stops Claude's turn" },
    { index: 3, label: "No, and tell Codex what to do differently", role: "freeText", acceptsText: true },
  ],
};
const plan: Interaction = {
  ...base, kind: "plan", family: "plan", question: "Would you like to proceed?", context: "# Plan\n\nShip it.", detailComplete: true,
  options: [
    { index: 0, label: "Yes, and use auto mode", role: "persistent" },
    { index: 1, label: "Yes, manually approve edits", role: "primary" },
    { index: 2, label: "No, refine with Ultraplan", role: "deny" },
    { index: 3, label: "Tell Claude what to change", role: "freeText", acceptsText: true },
  ],
};
const question: Interaction = {
  ...base, kind: "question", family: "select", question: "Which fruit?", context: "Pick the one for the pie.", steps: [{ label: "Fruit", answered: false, current: true }],
  options: [
    { index: 0, label: "Apple (Recommended)", role: "neutral", description: "Crisp and red." },
    { index: 1, label: "Pear", role: "neutral", description: "Soft and sweet." },
    { index: 2, label: "Type something.", role: "freeText", acceptsText: true },
    { index: 3, label: "Chat about this", role: "deny" },
  ],
};
const multi: Interaction = {
  ...base, kind: "multi-select", family: "claude", question: "Which toppings?",
  options: [
    { index: 0, label: "Cheese", role: "neutral", checked: false, description: "Melted on top." },
    { index: 1, label: "Olives", role: "neutral", checked: true },
    { index: 2, label: "Submit", role: "primary" },
  ],
};
const review: Interaction = {
  ...base, kind: "wizard", family: "claude", question: "Review your answers", incomplete: true,
  steps: [{ label: "Focus", answered: true, current: false }, { label: "Scope", answered: false, current: false }],
  answers: [{ question: "Which focus area?", answer: "UI" }],
  options: [{ index: 0, label: "Submit answers", role: "primary" }, { index: 1, label: "Cancel", role: "deny" }],
};
const answer = () => Promise.resolve({ ok: true as const });

/** Each card, and whether it lists options (a menu's rows are the screen's text, ADR 0009; a review and
 *  the typing state list none). */
const CARDS: Array<[string, () => ReactElement, boolean]> = [
  ["thread permission", () => <QuestionCard interaction={permission} onAnswer={answer} onOpen={() => {}} onKeys={() => {}} />, true],
  ["thread plan", () => <QuestionCard interaction={plan} onAnswer={answer} onOpen={() => {}} />, true],
  ["thread question", () => <QuestionCard interaction={question} onAnswer={answer} onOpen={() => {}} onKeys={() => {}} />, true],
  ["thread multi-select", () => <QuestionCard interaction={multi} onAnswer={answer} onOpen={() => {}} />, true],
  ["thread review", () => <QuestionCard interaction={review} onAnswer={answer} onOpen={() => {}} />, false],
  ["thread typing", () => <QuestionCard interaction={{ ...plan, typing: true }} onAnswer={answer} onOpen={() => {}} />, false],
  ["thread read-only", () => <QuestionCard interaction={question} lockReason="read-only" onAnswer={answer} onOpen={() => {}} />, true],
  ["Home permission", () => <QuestionCard compact title="api" interaction={permission} onAnswer={answer} onOpen={() => {}} />, true],
  ["Home permission without its detail", () => <QuestionCard compact title="api" interaction={{ ...permission, detailComplete: false }} onAnswer={answer} onOpen={() => {}} />, true],
  ["Home question", () => <QuestionCard compact title="api" interaction={question} onAnswer={answer} onOpen={() => {}} />, true],
  ["Home multi-select", () => <QuestionCard compact title="api" interaction={multi} onAnswer={answer} onOpen={() => {}} />, true],
  ["Home menu", () => <QuestionCard compact title="api" interaction={{ ...question, kind: "menu", family: "claude" }} onAnswer={answer} onOpen={() => {}} />, false],
  ["Home read-only", () => <QuestionCard compact title="api" interaction={question} lockReason="read-only" onAnswer={answer} onOpen={() => {}} />, true],
  ["prompt-select (mirror)", () => <PromptSelectBlock prompt={lift(detectPromptSelect(screenOf("claude--permission-bash.txt")), "permission")} onAction={() => {}} />, true],
  ["plan prompt (mirror)", () => <PromptSelectBlock prompt={lift(detectPromptSelect(screenOf("claude--plan-approval.txt")), "plan")} onAction={() => {}} />, true],
  ["preview-select", () => <PreviewSelectBlock preview={lift(detectPreviewSelect(screenOf("claude--select-preview.txt")), "preview")} onAction={() => {}} />, true],
  ["multi-select block", () => <MultiSelectBlock multi={lift(detectMultiSelect(screenOf("claude--select-multiselect-checked.txt")), "multi")} onAction={() => {}} />, true],
  ["multi-select review block", () => <MultiSelectBlock multi={lift(detectMultiSelect(screenOf("claude--select-multiselect-review.txt")), "multi review")} onAction={() => {}} />, false],
  ["wizard step", () => <WizardBlock wizard={lift(detectWizard(screenOf("claude--wizard-q1-revisit.txt")), "wizard")} onAction={() => {}} />, true],
  ["wizard review", () => <WizardBlock wizard={lift(detectWizard(screenOf("claude--wizard-submit.txt")), "wizard review")} onAction={() => {}} />, false],
  ["generic menu", () => {
    const block = claudeBuildBlocks(screenOf("claude-lab--menu-rewind--w82.txt")).find((b) => b.kind === "menu");
    if (!block || block.kind !== "menu") throw new Error("the rewind fixture lifted no menu");
    return <MenuBlock menu={block.menu} lines={block.lines} onAction={() => {}} />;
  }, false],
];

const classesOf = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
/** A class that sets a size off the type scale: a fixed px, or one of Tailwind's own steps. */
const OFF_SCALE = /^(?:[\w-]+:)*text-(?:\[\d+(?:\.\d+)?px\]|xs|sm|base|lg|xl)$/;
/** A row fill or border that is an ink fill or the accent: the selection's blue belongs on its control. */
const LOUD_ROW = /^(?:bg-foreground|bg-primary(?:\/\d+)?|border-primary(?:\/\d+)?)$/;

function renderCard(make: () => ReactElement) {
  const { container } = render(make());
  const card = container.querySelector<HTMLElement>("[data-question-card], [data-dialog-card]");
  if (!card) throw new Error("no card rendered");
  return card;
}

describe.each(CARDS)("%s", (_name, make, listed) => {
  it("is a rounded-xl card", () => {
    const card = renderCard(make);
    expect(card).toHaveClass("rounded-xl");
    expect(card).not.toHaveClass("rounded-2xl");
  });

  it("takes every text size from the type scale", () => {
    const card = renderCard(make);
    const off = [card, ...card.querySelectorAll("*")].flatMap((el) => classesOf(el).filter((c) => OFF_SCALE.test(c)).map((c) => `${el.tagName.toLowerCase()} ${c}`));
    expect(off).toEqual([]);
  });

  it("fills only its one large primary with ink, never an option row", () => {
    const card = renderCard(make);
    const ink = [...card.querySelectorAll<HTMLElement>("button")].filter((b) => classesOf(b).includes("bg-foreground"));
    for (const button of ink) {
      expect(button).toHaveAttribute("data-slot", "button");
      expect(button).toHaveClass("w-full", "justify-center", "text-center", "rounded-lg");
      expect(button.closest("[data-option-list]")).toBeNull();
    }
    expect(ink.length).toBeLessThanOrEqual(1);
  });

  it("draws its options as one grouped list, no row filled or tinted blue", () => {
    const card = renderCard(make);
    const lists = card.querySelectorAll<HTMLElement>("[data-option-list]");
    expect(lists).toHaveLength(listed ? 1 : 0);
    for (const list of lists) {
      expect(list).toHaveClass("rounded-lg", "border", "divide-y");
      for (const row of list.children) expect(classesOf(row).filter((c) => LOUD_ROW.test(c)), row.textContent ?? "").toEqual([]);
    }
  });
});

describe("a choice that is selected", () => {
  const SELECTED = "bg-[var(--workbench-row-selected)]";

  it("fills a ticked multi-select row neutrally and keeps the blue on its checkbox (card and block)", () => {
    const card = renderCard(CARDS.find(([n]) => n === "thread multi-select")![1]);
    const olives = [...card.querySelectorAll("[data-option-list] > *")].find((row) => row.textContent?.includes("Olives"))!;
    expect(olives).toHaveClass(SELECTED);
    expect(olives.querySelector(".bg-primary")).not.toBeNull();
    const block = renderCard(CARDS.find(([n]) => n === "multi-select block")![1]);
    const ticked = block.querySelector('[role="checkbox"][aria-checked="true"]')!;
    expect(ticked).toHaveClass(SELECTED);
    expect(ticked.querySelector(".bg-primary")).not.toBeNull();
    expect(block.querySelector('[role="checkbox"][aria-checked="false"]')).not.toHaveClass(SELECTED);
  });

  it("fills the previewed row neutrally and keeps the blue on its radio", () => {
    const card = renderCard(CARDS.find(([n]) => n === "preview-select")![1]);
    const pointed = card.querySelector('[role="radio"][aria-checked="true"]')!;
    expect(pointed).toHaveClass(SELECTED);
    expect(pointed.querySelector(".bg-primary")).not.toBeNull();
  });

  it("fills a wizard's current answer neutrally", () => {
    const card = renderCard(CARDS.find(([n]) => n === "wizard step")![1]);
    const current = card.querySelector('[aria-label="Current answer"]')!.closest("button")!;
    expect(current).toHaveClass(SELECTED);
  });
});
