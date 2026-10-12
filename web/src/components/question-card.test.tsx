import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnswerOutcome, Interaction } from "@/lib/types";
import { lockReasonOf, QuestionCard } from "./question-card";

// Shapes as bridge/interactions.ts serves them for the fixture corpus (claude--permission-bash,
// claude--plan-approval, claude--v2285-ask-question, claude--select-multiselect-checked).
const base = { paneId: "w1:p1", agent: "claude", signature: "sig-1", revision: 1, detectedAt: 0 };

const permission: Interaction = {
  ...base, kind: "permission", family: "permission", question: "Do you want to proceed?",
  context: "Bash command\nmkfifo fixture-fifo",
  options: [
    { index: 0, label: "Yes", role: "primary" },
    { index: 1, label: "Yes, and don’t ask again for: mkfifo fixture-fifo *", role: "persistent" },
    { index: 2, label: "No", role: "deny", description: "Stops Claude's turn" },
  ],
  detailComplete: false,
};

const plan: Interaction = {
  ...base, kind: "plan", family: "plan", question: "Would you like to proceed?",
  options: [
    { index: 0, label: "Yes, and use auto mode", role: "persistent" },
    { index: 1, label: "Yes, manually approve edits", role: "primary" },
    { index: 2, label: "No, refine with Ultraplan", role: "deny" },
    { index: 3, label: "Tell Claude what to change", role: "freeText", acceptsText: true },
  ],
};

const question: Interaction = {
  ...base, kind: "question", family: "select", question: "Which fruit?",
  options: [
    { index: 0, label: "Apple", role: "neutral" },
    { index: 1, label: "No", role: "neutral" },
    { index: 2, label: "Type something.", role: "freeText" },
    { index: 3, label: "Chat about this", role: "deny" },
  ],
};

const multi: Interaction = {
  ...base, kind: "multi-select", family: "claude", question: "Which toppings?",
  options: [
    { index: 0, label: "Cheese", role: "neutral", checked: false },
    { index: 1, label: "Olives", role: "neutral", checked: true },
    { index: 2, label: "Submit", role: "primary" },
  ],
};

const ok = (): Promise<AnswerOutcome> => Promise.resolve({ ok: true });

function setup(props: Partial<Parameters<typeof QuestionCard>[0]> = {}) {
  const onAnswer = vi.fn(ok);
  const onOpen = vi.fn();
  render(<QuestionCard interaction={question} onAnswer={onAnswer} onOpen={onOpen} {...props} />);
  return { onAnswer: (props.onAnswer as typeof onAnswer | undefined) ?? onAnswer, onOpen, user: userEvent.setup() };
}

describe("QuestionCard", () => {
  it("shows Waiting on you, the question and the request detail in mono", () => {
    setup({ interaction: permission });
    expect(screen.getByText("Waiting on you")).toBeVisible();
    expect(screen.getByText("Do you want to proceed?")).toBeVisible();
    const detail = screen.getByLabelText("Request details");
    expect(detail.tagName).toBe("PRE");
    expect(detail).toHaveClass("font-mono");
  });

  it("clamps the compact detail on an unpadded box, so no fourth line peeks into the padding", () => {
    setup({ interaction: { ...permission, context: "a\nb\nc\nd\ne" }, compact: true });
    const detail = screen.getByLabelText("Request details");
    expect(detail).toHaveClass("line-clamp-3");
    expect(detail.className).not.toMatch(/(^|\s)p[xy]?-/);
    expect(detail.parentElement).toHaveClass("py-2");
  });

  it("never clamps a command Home lets you approve", () => {
    setup({ interaction: { ...permission, detailComplete: true, context: "a\nb\nc\nd\nrm -rf build" }, compact: true });
    const detail = screen.getByLabelText("Request details");
    expect(detail).not.toHaveClass("line-clamp-3");
    expect(detail).toHaveTextContent("rm -rf build");
    expect(screen.getByRole("button", { name: /^Yes$/ })).toBeVisible();
  });

  it("folds a long subject behind Show all instead of a scroll box inside the thread", async () => {
    const rows = Array.from({ length: 12 }, (_, n) => `line ${n + 1}`).join("\n");
    const { user } = setup({ interaction: { ...permission, context: rows } });
    const detail = screen.getByLabelText("Request details");
    expect(detail.parentElement?.className ?? "").not.toMatch(/overflow-y-auto/);
    expect(detail).not.toHaveTextContent("line 12");
    await user.click(screen.getByRole("button", { name: "Show all 12 lines" }));
    expect(screen.getByLabelText("Request details")).toHaveTextContent("line 12");
  });

  it("answers with one call naming the option by index", async () => {
    const { onAnswer, user } = setup();
    await user.click(screen.getByRole("button", { name: /Apple/ }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(question.options[0], {});
  });

  it("treats a question's No as an answer and its escape row as deny", () => {
    setup();
    expect(screen.getByRole("button", { name: /^No$/ })).toHaveAttribute("data-role", "neutral");
    expect(screen.getByRole("button", { name: /Chat about this/ })).toHaveAttribute("data-role", "deny");
  });

  it("sends a text row without a recipe to the terminal's keys, as a secondary action", async () => {
    const onKeys = vi.fn();
    const { onAnswer, onOpen, user } = setup({ onKeys });
    expect(screen.queryByRole("button", { name: /Type something/ })).not.toBeInTheDocument();
    const own = screen.getByRole("button", { name: "Type your own answer in the terminal" });
    expect(own.closest("[data-secondary-actions]")).not.toBeNull();
    await user.click(own);
    expect(onKeys).toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("keeps a question's escape out of the answers, next to the terminal", () => {
    setup();
    const answers = screen.getByRole("group", { name: "Answers" });
    expect(within(answers).getByRole("button", { name: /Apple/ })).toBeVisible();
    expect(within(answers).queryByRole("button", { name: /Chat about this/ })).not.toBeInTheDocument();
    const secondary = document.querySelector<HTMLElement>("[data-secondary-actions]")!;
    expect(within(secondary).getByRole("button", { name: "Chat about this" })).toHaveAttribute("data-role", "deny");
    expect(within(secondary).getByRole("button", { name: "Terminal" })).toBeVisible();
  });

  it("keeps a permission's No among the answers", () => {
    setup({ interaction: permission });
    const no = screen.getByRole("button", { name: /^No/ });
    expect(no.closest("[data-secondary-actions]")).toBeNull();
  });

  it("marks the recommended answer with a quiet badge instead of its label suffix", () => {
    setup({ interaction: { ...question, options: [
      { index: 0, label: "Acá en la terminal (Recommended)", role: "neutral", description: "Te muestro de a 4 casos." },
      ...question.options.slice(1),
    ] } });
    const row = screen.getByRole("button", { name: /Acá en la terminal/ });
    expect(row).not.toHaveTextContent("(Recommended)");
    expect(within(row).getByText("Recommended")).toBeVisible();
    expect(within(row).getByText("Te muestro de a 4 casos.")).toBeVisible();
  });

  it("names a lone question by its header chip", () => {
    setup({ interaction: { ...question, steps: [{ label: "Fruit", answered: false, current: true }] } });
    expect(screen.getByText("Fruit")).toBeVisible();
    expect(screen.queryByRole("list", { name: "Questions" })).not.toBeInTheDocument();
  });

  it("shows where a wizard stands: its questions and which one is on screen", () => {
    setup({ interaction: { ...question, kind: "wizard", steps: [
      { label: "Focus area", answered: true, current: false },
      { label: "Scope", answered: false, current: true },
      { label: "Workflow", answered: false, current: false },
    ] } });
    expect(screen.getByText("2 of 3")).toBeVisible();
    const steps = screen.getByRole("list", { name: "Questions" });
    expect(within(steps).getByText("Scope").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(steps).getByText("Focus area").closest("li")).toHaveAccessibleName(/answered/);
  });

  it("says Review when no question is on screen", () => {
    setup({ interaction: { ...question, kind: "wizard", steps: [
      { label: "Focus area", answered: false, current: false },
      { label: "Scope", answered: false, current: false },
    ] } });
    expect(screen.getByText("Review")).toBeVisible();
    expect(screen.queryByText(/of 2/)).not.toBeInTheDocument();
  });

  it("keeps Codex's Recommended marker on Home's one-line options", () => {
    setup({ compact: true, interaction: { ...question, options: [{ index: 0, label: "Tabs (Recommended)", role: "neutral" }, question.options[3]!] } });
    expect(screen.getByRole("button", { name: /Tabs/ })).toHaveTextContent(/Recommended/);
  });

  it("lists a review's answers instead of echoing them as code", () => {
    setup({ interaction: { ...base, kind: "wizard", family: "claude", question: "Review your answers",
      context: "Which focus area? → UI\nWhat scope? → Medium",
      answers: [{ question: "Which focus area?", answer: "UI" }, { question: "What scope?", answer: "v1 → v2" }],
      options: [{ index: 0, label: "Submit answers", role: "primary" }, { index: 1, label: "Cancel", role: "deny" }] } });
    expect(screen.queryByLabelText("Request details")).not.toBeInTheDocument();
    const answers = screen.getByRole("list", { name: "Your answers" });
    expect(within(answers).getByText("Which focus area?")).toBeVisible();
    expect(within(answers).getByText("UI")).toBeVisible();
    expect(within(answers).getByText("v1 → v2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Submit answers" })).toBeVisible();
  });

  it("shows a question's own detail as text and only a command in mono", () => {
    setup({ interaction: { ...question, context: "Question 1/2 (2 unanswered)" } });
    expect(screen.getByText("Question 1/2 (2 unanswered)").tagName).not.toBe("PRE");
  });

  it("names the terminal for a text row on Home, where the card's own Open leads there", () => {
    setup({ compact: true });
    const row = document.querySelector<HTMLElement>("[data-in-terminal]")!;
    expect(row).toHaveTextContent("Type something. Answer in the terminal.");
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeVisible();
  });

  it("asks to confirm a persistent option in place, keeping its label, and sends confirm on the second tap", async () => {
    const { onAnswer, user } = setup({ interaction: permission });
    await user.click(screen.getByRole("button", { name: /don’t ask again/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    const armed = screen.getByRole("button", { name: /^Confirm/ });
    expect(armed).toHaveTextContent("Yes, and don’t ask again for: mkfifo fixture-fifo *");
    expect(armed).toHaveTextContent("Applies to future prompts");
    expect(armed).not.toHaveTextContent(/Tap again/);
    await user.click(armed);
    expect(onAnswer).toHaveBeenCalledWith(permission.options[1], { confirm: true });
  });

  it("arms the row when the bridge asks for a confirm, without a notice repeating it", async () => {
    const onAnswer = vi.fn((): Promise<AnswerOutcome> => Promise.resolve({ ok: false, error: "This answer changes a setting. Confirm it.", code: "confirm_required" }));
    const { user } = setup({ interaction: permission, onAnswer });
    await user.click(screen.getByRole("button", { name: /^Yes$/ }));
    expect(await screen.findByRole("button", { name: "Confirm: Yes" })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirm it\./)).not.toBeInTheDocument();
  });

  it("while the terminal's text box has focus, says so instead of offering answers, and opens the terminal", async () => {
    const { onOpen, user } = setup({ interaction: { ...plan, typing: true } });
    expect(screen.getByText("The terminal's text box has focus")).toBeVisible();
    expect(screen.getByText("Answers come back when typing ends")).toBeVisible();
    expect(screen.queryByText(/Someone is typing/)).not.toBeInTheDocument();
    for (const name of [/auto mode/, /manually approve/, /Ultraplan/, /Tell Claude what to change/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Open terminal" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("offers the plan's text row by its own words and sends the feedback text", async () => {
    const { onAnswer, user } = setup({ interaction: plan });
    expect(screen.queryByRole("button", { name: "Reply…" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tell Claude what to change…" }));
    await user.type(screen.getByRole("textbox", { name: "Tell Claude what to change" }), "Split it in two");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onAnswer).toHaveBeenCalledWith(plan.options[3], { text: "Split it in two" });
  });

  it("types a multi-select's Type something row from the card", async () => {
    const withText: Interaction = { ...multi, options: [...multi.options.slice(0, 2), { index: 2, label: "Type something", role: "freeText", acceptsText: true }, { ...multi.options[2]!, index: 3 }] };
    const { onAnswer, user } = setup({ interaction: withText });
    await user.click(screen.getByRole("button", { name: "Type something…" }));
    const box = screen.getByRole("textbox", { name: "Type something" });
    expect(box).toHaveAttribute("maxLength", "240");
    await user.type(box, "Pineapple");
    expect(screen.getByText("9/240")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onAnswer).toHaveBeenCalledWith(withText.options[2], { text: "Pineapple" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  describe("what a permission asks for", () => {
    const bash: Interaction = {
      ...permission, context: "Bash command\nWrite hi into hello.txt\necho hi > hello.txt",
      subject: { tool: "Bash", description: "Write hi into hello.txt", command: "echo hi > hello.txt" },
    };

    it("shows the tool, then what it is for, then the command as code", () => {
      setup({ interaction: bash });
      expect(screen.getByText("Bash")).toBeVisible();
      expect(screen.getByText("Write hi into hello.txt")).toBeVisible();
      const command = screen.getByLabelText("Command");
      expect(command.tagName).toBe("PRE");
      expect(command).toHaveTextContent("echo hi > hello.txt");
      expect(command).toHaveClass("font-mono", "text-[13px]", "[overflow-wrap:anywhere]");
      expect(screen.queryByLabelText("Request details")).not.toBeInTheDocument();
    });

    it("shows a file and its preview lines with their numbers apart from the text", () => {
      setup({ interaction: { ...permission, question: "Do you want to create hello.txt?", subject: { tool: "Create file", file: "hello.txt", preview: "1 hello\n2 world" } } });
      expect(screen.getByLabelText("File")).toHaveTextContent("hello.txt");
      const preview = screen.getByLabelText("Preview");
      expect(within(preview).getByText("hello")).toBeVisible();
      expect(within(preview).getByText("2")).toHaveAttribute("aria-hidden", "true");
    });

    it("names Codex's facts and the options only the terminal answers", () => {
      setup({ interaction: { ...permission, agent: "codex", subject: { description: "Allow it?", command: "touch x", meta: ["Environment: local"] }, terminalOnly: ["Yes, and don't ask again for these files"] } });
      expect(screen.getByText("Environment: local")).toBeVisible();
      expect(screen.getByText("Also in the terminal:", { exact: false })).toHaveTextContent("Also in the terminal: Yes, and don't ask again for these files");
    });
  });

  describe("a plan", () => {
    const written: Interaction = { ...plan, context: "# Plan: Add haiku.txt\n\n## Context\n\nThe user wants a **haiku**.", detailComplete: true };

    it("reads as formatted text, not raw markdown", () => {
      setup({ interaction: written });
      expect(screen.getByText("Plan: Add haiku.txt")).toBeVisible();
      expect(screen.queryByText(/^#/)).not.toBeInTheDocument();
      expect(screen.getByText("haiku").tagName).toBe("STRONG");
    });

    it("folds a long plan behind Read the full plan, with no scroll box of its own", async () => {
      const tall = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
      const roomy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(240);
      try {
        const { user } = setup({ interaction: written });
        const body = screen.getByLabelText("Plan");
        expect(body.className).not.toMatch(/overflow-y-auto/);
        await user.click(screen.getByRole("button", { name: "Read the full plan" }));
        expect(screen.queryByRole("button", { name: "Read the full plan" })).not.toBeInTheDocument();
      } finally {
        tall.mockRestore();
        roomy.mockRestore();
      }
    });
  });

  describe("a review", () => {
    const reviewing: Interaction = {
      ...base, kind: "wizard", family: "claude", question: "Review your answers",
      answers: [{ question: "Which focus area?", answer: "UI" }],
      options: [{ index: 0, label: "Submit answers", role: "primary" }, { index: 1, label: "Cancel", role: "deny" }],
    };

    it("warns when a question has no answer and says Submit sends it anyway", () => {
      setup({ interaction: { ...reviewing, incomplete: true } });
      expect(screen.getByText("Some questions have no answer")).toBeVisible();
      expect(screen.getByRole("button", { name: "Submit anyway" })).toBeVisible();
    });

    it("keeps the plain Submit when every question is answered", () => {
      setup({ interaction: reviewing });
      expect(screen.queryByText("Some questions have no answer")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeVisible();
    });
  });

  it("steps a wizard Back and Next with the arrows the bridge serves", async () => {
    const stepping: Interaction = { ...question, kind: "wizard", steps: [
      { label: "Focus area", answered: true, current: false },
      { label: "Scope", answered: false, current: true },
      { label: "Workflow", answered: false, current: false },
    ], options: [...question.options, { index: 4, label: "Back", role: "nav" }, { index: 5, label: "Next", role: "nav" }] };
    const { onAnswer, user } = setup({ interaction: stepping });
    expect(within(screen.getByRole("group", { name: "Answers" })).queryByRole("button", { name: /Back|Next/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous question" }));
    expect(onAnswer).toHaveBeenCalledWith(stepping.options[4], {});
    await user.click(screen.getByRole("button", { name: "Next question" }));
    expect(onAnswer).toHaveBeenLastCalledWith(stepping.options[5], {});
  });

  it("counts what a multi-select's Submit sends", () => {
    setup({ interaction: multi });
    const submit = screen.getByRole("button", { name: "Submit 1" });
    expect(submit).toHaveAttribute("data-role", "primary");
    expect(submit).not.toHaveAttribute("data-quiet");
  });

  it("on a wizard's checkbox step, Next says how many are ticked, never a number that reads as a question", () => {
    // claude--wizard-multiselect-checked: question 1 of 2, its advance row is Next.
    const step: Interaction = { ...multi, steps: [{ label: "Pizza", answered: false, current: true }, { label: "Sides", answered: false, current: false }],
      options: [multi.options[0]!, multi.options[1]!, { index: 2, label: "Next", role: "primary" }] };
    setup({ interaction: step });
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next · 1 selected" })).toHaveAttribute("data-role", "primary");
  });

  it("on a wizard's checkbox step with nothing ticked, Next says so and stays quiet", () => {
    const step: Interaction = { ...multi, steps: [{ label: "Pizza", answered: false, current: true }, { label: "Sides", answered: false, current: false }],
      options: [multi.options[0]!, { ...multi.options[1]!, checked: false }, { index: 2, label: "Next", role: "primary" }] };
    setup({ interaction: step });
    expect(screen.getByRole("button", { name: "Next · none selected" })).toHaveAttribute("data-quiet", "true");
    expect(screen.queryByText(/without answers/)).not.toBeInTheDocument();
  });

  it("offers Submit without answers as a quiet action when nothing is ticked", () => {
    setup({ interaction: { ...multi, options: [{ ...multi.options[0]! }, { ...multi.options[1]!, checked: false }, multi.options[2]!] } });
    expect(screen.getByRole("button", { name: "Submit without answers" })).toHaveAttribute("data-quiet", "true");
  });

  describe("a note on an answer that accepts text (Tab-amend, Codex notes)", () => {
    const amend: Interaction = {
      ...permission, detailComplete: true,
      options: [
        { index: 0, label: "Yes", role: "primary", acceptsText: true },
        permission.options[1]!,
        { index: 2, label: "No", role: "deny", acceptsText: true },
      ],
    };

    it("still answers in one tap without a note", async () => {
      const { onAnswer, user } = setup({ interaction: amend });
      await user.click(screen.getByRole("button", { name: /^Yes$/ }));
      expect(onAnswer).toHaveBeenCalledWith(amend.options[0], {});
    });

    it("sends the note with the tapped answer, capped at 240 characters", async () => {
      const { onAnswer, user } = setup({ interaction: amend });
      await user.click(screen.getByRole("button", { name: "Add a note…" }));
      const box = screen.getByRole("textbox", { name: "Note with your answer" });
      expect(box).toHaveAttribute("maxLength", "240");
      await user.type(box, "  use the test db instead ");
      await user.click(screen.getByRole("button", { name: /^No/ }));
      expect(onAnswer).toHaveBeenCalledWith(amend.options[2], { text: "use the test db instead" });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("never drops a typed note into an answer that cannot carry it", async () => {
      const { user } = setup({ interaction: amend });
      expect(screen.getByRole("button", { name: /don’t ask again/ })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Add a note…" }));
      await user.type(screen.getByRole("textbox"), "why");
      expect(screen.getByRole("button", { name: /don’t ask again/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /^Yes$/ })).toBeEnabled();
    });

    it("sends the note and confirm together on a persistent answer that accepts text", async () => {
      const persistent: Interaction = { ...amend, options: [amend.options[0]!, { ...permission.options[1]!, acceptsText: true }, amend.options[2]!] };
      const { onAnswer, user } = setup({ interaction: persistent });
      await user.click(screen.getByRole("button", { name: "Add a note…" }));
      await user.type(screen.getByRole("textbox"), "only here");
      await user.click(screen.getByRole("button", { name: /don’t ask again/ }));
      await user.click(screen.getByRole("button", { name: /^Confirm/ }));
      expect(onAnswer).toHaveBeenCalledWith(persistent.options[1], { text: "only here", confirm: true });
    });

    it("never drops a typed note into a question's escape", async () => {
      const noted: Interaction = { ...question, options: [{ ...question.options[0]!, acceptsText: true }, question.options[3]!] };
      const { user } = setup({ interaction: noted });
      await user.click(screen.getByRole("button", { name: "Add a note…" }));
      await user.type(screen.getByRole("textbox"), "why");
      expect(screen.getByRole("button", { name: "Chat about this" })).toBeDisabled();
    });

    it("offers no note where no answer accepts text", () => {
      setup({ interaction: permission });
      expect(screen.queryByRole("button", { name: "Add a note…" })).not.toBeInTheDocument();
    });
  });

  it("shows checkbox state and toggles a multi-select row", async () => {
    const { onAnswer, user } = setup({ interaction: multi });
    expect(screen.getByRole("button", { name: /Olives/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Cheese/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /Cheese/ }));
    expect(onAnswer).toHaveBeenCalledWith(multi.options[0], {});
  });

  it("says in the bridge's words that the question changed, under the answers, and brings that line into view", async () => {
    const seen: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) { seen.push(this); });
    const error = "The question changed in the terminal. Nothing was sent.";
    const onAnswer = vi.fn((): Promise<AnswerOutcome> => Promise.resolve({ ok: false, error, code: "interaction_changed" }));
    const { user } = setup({ onAnswer });
    await user.click(screen.getByRole("button", { name: /Apple/ }));
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(error);
    expect(notice).not.toHaveTextContent(/Refreshing/);
    expect(seen).toContain(notice);
    // Right under the answers, above the secondary row, not at the card's foot.
    const secondary = document.querySelector("[data-secondary-actions]")!;
    expect(notice.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Apple/ })).toHaveAttribute("data-failed", "true");
  });

  it("opens with the refusal its pane's last tap met, so a card that replaced the tapped one says why nothing was sent", () => {
    setup({ refused: "The question changed in the terminal. Nothing was sent." });
    expect(screen.getByRole("status")).toHaveTextContent("The question changed in the terminal. Nothing was sent.");
  });

  it("a Submit the terminal never reached says so, and offers to try again beside the card's one way to the terminal", async () => {
    const error = "Couldn't reach Submit in the terminal. Nothing was submitted.";
    const onAnswer = vi.fn()
      .mockResolvedValueOnce({ ok: false, error, code: "not_reached" })
      .mockResolvedValueOnce({ ok: true });
    const { onOpen, user } = setup({ interaction: multi, onAnswer });
    await user.click(screen.getByRole("button", { name: /^Submit/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(error);
    expect(screen.getAllByRole("button", { name: /terminal/i })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Terminal" }));
    expect(onOpen).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onAnswer).toHaveBeenLastCalledWith(multi.options[2], {});
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a lock without a known reason never blames the device", () => {
    setup({ readOnly: true });
    expect(screen.getByText("Answers are paused right now.")).toBeVisible();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apple/ })).toBeDisabled();
  });

  it.each([
    ["offline", "Answers are paused until Nenu reconnects."],
    ["herdr", "Herdr isn't responding. Answers are paused."],
    ["refused", "Sign in again to answer."],
  ] as const)("says why answers are paused (%s), and keeps the buttons", (lockReason, line) => {
    setup({ interaction: { ...permission, detailComplete: true }, lockReason });
    expect(screen.getByText(line)).toBeVisible();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    const yes = screen.getByRole("button", { name: /^Yes$/ });
    expect(yes).toBeDisabled();
    // A disabled primary loses its ink fill instead of fading into a grey slab.
    expect(yes).not.toHaveClass("bg-foreground");
  });

  it("a read-only device sees the options as a list it cannot press, and one line saying why", () => {
    setup({ lockReason: "read-only" });
    expect(screen.getByText("Read-only on this device. Answer from an authorised one.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Apple/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Options" })).getByText("Apple")).toBeVisible();
  });

  it.each([
    [{ readOnly: true, error: false, authError: false, bridge: "connected" }, "read-only"],
    [{ readOnly: false, error: true, authError: true, bridge: "connected" }, "refused"],
    [{ readOnly: false, error: true, authError: false, bridge: "connected" }, "offline"],
    [{ readOnly: false, error: false, authError: false, bridge: "disconnected" }, "herdr"],
    [{ readOnly: false, error: false, authError: false, bridge: "connected" }, undefined],
  ] as const)("names the lock from the snapshot: %j", (snapshot, reason) => {
    expect(lockReasonOf(snapshot as Parameters<typeof lockReasonOf>[0])).toBe(reason);
  });

  it("shows the optimistic receipt once answered, naming what was approved", () => {
    setup({ interaction: undefined, receipt: { paneId: "w1:p1", signature: "sig-1", label: "Yes", summary: "Approved · echo hi > hello.txt", at: 0 } });
    expect(screen.getByRole("status")).toHaveTextContent("Approved · echo hi > hello.txt");
  });

  describe("compact (Home)", () => {
    it("keeps approval off a permission without its full detail and offers Review in thread", async () => {
      const { onOpen, user } = setup({ interaction: permission, compact: true, title: "panel depo" });
      expect(screen.queryByRole("button", { name: /^Yes$/ })).not.toBeInTheDocument();
      // The command may well be whole on the card, only unverified: no line claims it is missing.
      expect(screen.queryByText(/full request/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /don’t ask again/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^No/ })).toBeEnabled();
      expect(screen.getByText("panel depo", { exact: false })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Review in thread" }));
      expect(onOpen).toHaveBeenCalled();
    });

    it("never offers Yes on a command folded past eight lines; Review in thread until it is shown whole", async () => {
      const command = Array.from({ length: 12 }, (_, n) => `step ${n + 1}`).join("\n");
      const { user } = setup({ interaction: { ...permission, detailComplete: true, subject: { tool: "Bash", command } }, compact: true });
      expect(screen.queryByRole("button", { name: /^Yes$/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Review in thread" })).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Show all 12 lines" }));
      expect(screen.getByLabelText("Command")).toHaveTextContent("step 12");
      expect(screen.getByRole("button", { name: /^Yes$/ })).toBeVisible();
    });

    it("puts the whole command on screen before the button that approves it", () => {
      setup({ interaction: { ...permission, detailComplete: true, subject: { tool: "Bash", command: "echo hi > hello.txt" } }, compact: true });
      const command = screen.getByLabelText("Command");
      const yes = screen.getByRole("button", { name: /^Yes$/ });
      expect(command).toHaveTextContent("echo hi > hello.txt");
      expect(command.compareDocumentPosition(yes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("never approves a plan it has not shown whole (ADR 0057 §4)", async () => {
      const { onOpen, user } = setup({ interaction: { ...plan, context: "# Plan\n\nShip it." }, compact: true });
      expect(screen.queryByRole("button", { name: /manually approve/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /auto mode/ })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Review in thread" }));
      expect(onOpen).toHaveBeenCalled();
    });

    it("approves a whole plan only once it is unfolded", async () => {
      const tall = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
      const roomy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
      try {
        const { user } = setup({ interaction: { ...plan, context: "# Plan\n\nShip it.", detailComplete: true }, compact: true });
        expect(screen.queryByRole("button", { name: /manually approve/ })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Read the full plan" }));
        expect(screen.getByRole("button", { name: /manually approve/ })).toBeVisible();
      } finally {
        tall.mockRestore();
        roomy.mockRestore();
      }
    });

    it("approves a permission whose full detail is on the card", async () => {
      const { onAnswer, user } = setup({ interaction: { ...permission, detailComplete: true }, compact: true });
      await user.click(screen.getByRole("button", { name: /^Yes$/ }));
      expect(onAnswer).toHaveBeenCalledWith(permission.options[0], {});
      expect(document.querySelector("[data-question-card]")).toHaveAttribute("data-question-card", "compact");
    });
  });
});
