import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { parseAnsi } from "@/lib/ansi";
import { splitLines, type PreviewSelectModel } from "@/lib/blocks";
import { detectPreviewSelect } from "@/lib/harness/claude/preview-select";
import { PreviewSelectBlock } from "./preview-select-block";

// Presentational contract only — the choreography engine has its own tests (preview-action.test.ts)
// and the component never touches the network: taps resolve to intents on the injected handler.

const PANES_DIR = join(import.meta.dirname, "..", "fixtures", "panes");
function fixtureModel(name: string): PreviewSelectModel {
  const text = readFileSync(join(PANES_DIR, name), "utf8");
  const model = detectPreviewSelect(splitLines(parseAnsi(text)));
  if (!model) throw new Error(`fixture ${name} did not detect a preview dialog`);
  return model;
}

describe("PreviewSelectBlock — presentation", () => {
  it("draws the question as a card: rows, the pointed row's preview, Choose, and a way to add a note", () => {
    const model = fixtureModel("claude--select-preview.txt");
    const { container } = render(<PreviewSelectBlock preview={model} onAction={vi.fn()} />);

    const card = screen.getByRole("region", { name: "Which widget design should we use?" });
    expect(within(card).getByText("Waiting on you")).toBeInTheDocument();
    // The rows are one choice, announced as radios: the pointed row is the checked one, the one
    // previewed, and the one Choose commits.
    const rows = within(card).getByRole("radiogroup", { name: model.question });
    for (const label of ["Boxy", "Rounded", "Minimal"]) {
      expect(within(rows).getByRole("radio", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: /^Boxy/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^Rounded/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Choose Boxy" })).toBeInTheDocument();
    expect(screen.getByText(model.question)).toBeInTheDocument();
    // No terminal-style caption above the card: the header says what it is.
    expect(screen.queryByText("Choose an option")).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Preview of Boxy" })).getByText(/WIDGET/)).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
    expect(container.textContent).not.toContain("┌──");
    expect(screen.getByRole("button", { name: /Add a note/ })).toBeInTheDocument();
    // Single-question: no stepper navigation.
    expect(screen.queryByRole("button", { name: "Next step" })).not.toBeInTheDocument();
  });

  // The agent's "(Recommended)" suffix is the badge every card draws, never raw text in a row or in
  // the Choose button (fixture: a wrapped three-line label that ends in the suffix).
  it("draws (Recommended) as the badge on the row and leaves it out of Choose", () => {
    const model = fixtureModel("claude--wizard-preview-wrapped-label.txt");
    render(<PreviewSelectBlock preview={model} onAction={vi.fn()} />);
    const row = screen.getByRole("radio", { name: /^Grid of equal-width cards with a fixed gutter/ });
    expect(row).not.toHaveTextContent("(Recommended)");
    expect(within(row).getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose Grid of equal-width cards with a fixed gutter" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Preview of Grid of equal-width cards with a fixed gutter" })).toBeInTheDocument();
  });

  it("shows an attached note with edit and remove controls", () => {
    const model = fixtureModel("claude--select-preview-note-attached.txt");
    render(<PreviewSelectBlock preview={model} onAction={vi.fn()} />);
    expect(screen.getByText("prefer subtle shadows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove note" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add a note/ })).not.toBeInTheDocument();
  });

  it("locks everything behind the terminal-editing banner while the TUI input is focused", () => {
    const model = fixtureModel("claude--select-preview-note-input.txt");
    render(<PreviewSelectBlock preview={model} onAction={vi.fn()} />);
    expect(screen.getByText(/being edited in the agent session/)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("renders the wizard stepper (chips + nav) for a wizard step, question included", () => {
    const model = fixtureModel("claude--wizard-preview-q1.txt");
    render(<PreviewSelectBlock preview={model} onAction={vi.fn()} />);
    const chips = screen.getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual(["Card layout", "Dark mode", "Submit"]);
    expect(chips[0]).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Which card layout should we use?")).toBeInTheDocument();
    // First question current → Back clamps (disabled), Next stays live.
    expect(screen.getByRole("button", { name: "Previous step" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next step" })).not.toBeDisabled();
  });

  it("disables every control when disabled (read-only device / gone pane)", () => {
    const model = fixtureModel("claude--select-preview.txt");
    render(<PreviewSelectBlock preview={model} onAction={vi.fn()} disabled />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});

describe("PreviewSelectBlock — intents", () => {
  it("tapping another row only points at it, so its preview shows before anything is chosen", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const model = fixtureModel("claude--select-preview.txt");
    render(<PreviewSelectBlock preview={model} onAction={onAction} />);

    await user.click(screen.getByRole("radio", { name: /^Rounded/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith({ kind: "point", option: model.options[1] });
  });

  it("tapping the row already pointed at sends nothing", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const model = fixtureModel("claude--select-preview.txt");
    render(<PreviewSelectBlock preview={model} onAction={onAction} />);

    await user.click(screen.getByRole("radio", { name: /^Boxy/ }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("while a note is being written, Choose waits for it to be saved or dropped", async () => {
    const user = userEvent.setup();
    const model = fixtureModel("claude--select-preview.txt");
    render(<PreviewSelectBlock preview={model} onAction={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /Add a note/ }));
    expect(screen.queryByRole("button", { name: "Choose Boxy" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Choose Boxy" })).toBeInTheDocument();
  });

  it("Choose commits the pointed row", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const model = fixtureModel("claude--select-preview.txt");
    render(<PreviewSelectBlock preview={model} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Choose Boxy" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "choose", option: model.options[0] });
  });

  it("adding a note opens the editor and saves the typed text as a note intent", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const model = fixtureModel("claude--select-preview.txt");
    render(<PreviewSelectBlock preview={model} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: /Add a note/ }));
    const input = screen.getByRole("textbox", { name: "Note text" });
    // Empty notes can't be saved (removal is the attached card's explicit control).
    expect(screen.getByRole("button", { name: /Save note/ })).toBeDisabled();
    await user.type(input, "prefer bolder borders");
    await user.click(screen.getByRole("button", { name: /Save note/ }));
    expect(onAction).toHaveBeenCalledWith({ kind: "note", text: "prefer bolder borders" });
    // The editor closes after the save resolves (the revalidated model shows the truth).
    expect(screen.queryByRole("textbox", { name: "Note text" })).not.toBeInTheDocument();
  });

  it("editing prefills the current note; removing raises an empty note intent", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const model = fixtureModel("claude--select-preview-note-attached.txt");
    render(<PreviewSelectBlock preview={model} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Edit note" }));
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveValue(
      "prefer subtle shadows",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Remove note" }));
    expect(onAction).toHaveBeenCalledWith({ kind: "note", text: "" });
  });

  it("wizard step navigation raises nav intents with the wizard's Left/Right keys", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    const model = fixtureModel("claude--wizard-preview-q1.txt");
    render(<PreviewSelectBlock preview={model} onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Next step" }));
    expect(onAction).toHaveBeenLastCalledWith({ kind: "nav", keys: ["Right"] });
  });
});
