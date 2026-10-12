import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchPopover } from "./workbench-popover";

function Harness({ onDismiss = vi.fn() }: { onDismiss?: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={anchorRef} onClick={() => setOpen((value) => !value)}>Inspect</button>
    <textarea aria-label="Draft" defaultValue="Keep writing" />
    <WorkbenchPopover open={open} onDismiss={(reason) => { onDismiss(reason); setOpen(false); }} anchorRef={anchorRef} label="Inspector">
      <button>Panel action</button>
    </WorkbenchPopover>
  </>;
}

it("does not lock the page or take focus when opened and dismisses once to the clicked input", async () => {
  const dismiss = vi.fn();
  const overflow = document.body.style.overflow;
  render(<Harness onDismiss={dismiss} />);
  await userEvent.click(screen.getByRole("button", { name: "Inspect" }));
  expect(screen.getByRole("button", { name: "Inspect" })).toHaveFocus();
  expect(document.body.style.overflow).toBe(overflow);
  expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-modal", "true");
  const draft = screen.getByRole("textbox");
  await userEvent.click(draft);
  expect(dismiss).toHaveBeenCalledExactlyOnceWith("outside");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(draft).toHaveFocus();
  await userEvent.type(draft, " more");
  expect(draft).toHaveValue("Keep writing more");
});

it("closes on focus leaving the inspector without returning focus to its trigger", async () => {
  const dismiss = vi.fn();
  render(<Harness onDismiss={dismiss} />);
  await userEvent.click(screen.getByRole("button", { name: "Inspect" }));
  await userEvent.click(screen.getByRole("button", { name: "Panel action" }));
  fireEvent.focusIn(screen.getByRole("textbox"));
  expect(dismiss).toHaveBeenCalledExactlyOnceWith("outside");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("closes on Escape and X and restores the trigger only from inside the panel", async () => {
  const dismiss = vi.fn();
  render(<Harness onDismiss={dismiss} />);
  const trigger = screen.getByRole("button", { name: "Inspect" });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Panel action" }));
  await userEvent.keyboard("{Escape}");
  expect(dismiss).toHaveBeenCalledExactlyOnceWith("escape");
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Close Inspector" }));
  expect(dismiss).toHaveBeenLastCalledWith("close");
  expect(dismiss).toHaveBeenCalledTimes(2);
  expect(trigger).toHaveFocus();
});

it("ignores an IME Escape and lets the same anchor toggle the panel closed", async () => {
  const dismiss = vi.fn();
  render(<Harness onDismiss={dismiss} />);
  const trigger = screen.getByRole("button", { name: "Inspect" });
  await userEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape", isComposing: true });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.click(trigger);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(dismiss).not.toHaveBeenCalled();
});
