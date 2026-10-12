import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalModelPicker } from "./local-model-picker";

const rows = [
  { name: "Model A", description: "Fast tasks" },
  { name: "Model B", description: "Complex tasks" },
];

it("selects locally on click and arrows, moves focus, and applies only explicitly", async () => {
  const onApply = vi.fn().mockResolvedValue(undefined);
  render(<LocalModelPicker rows={rows} currentModel="Model A" onApply={onApply} onCancel={vi.fn()} />);
  const a = screen.getByRole("radio", { name: "Model A" });
  const b = screen.getByRole("radio", { name: "Model B" });
  expect(a).toHaveAttribute("aria-checked", "true");
  expect(within(a).getByText("Current")).toBeInTheDocument();
  await userEvent.click(b);
  expect(b).toHaveAttribute("aria-checked", "true");
  expect(within(a).getByText("Current")).toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}");
  expect(a).toHaveFocus();
  expect(a).toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{End}{Enter}");
  expect(b).toHaveFocus();
  expect(onApply).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Use model" }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith("Model B");
});

it("preserves selected names through catalog refresh and never guesses a Current badge", async () => {
  const props = { rows, currentModel: "model a", onApply: vi.fn().mockResolvedValue(undefined), onCancel: vi.fn() };
  const { rerender } = render(<LocalModelPicker {...props} />);
  expect(screen.queryByText("Current")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "Model B" }));
  rerender(<LocalModelPicker {...props} rows={[{ name: "Model B", description: "Updated" }, rows[0]!]} currentModel="Model A" />);
  expect(screen.getByRole("radio", { name: "Model B" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText("Updated")).toBeInTheDocument();
  rerender(<LocalModelPicker {...props} rows={[rows[0]!]} currentModel="Model A" />);
  expect(screen.getByRole("radio", { name: "Model A" })).toHaveAttribute("aria-checked", "true");
  await userEvent.click(screen.getByRole("button", { name: "Use model" }));
  expect(props.onApply).toHaveBeenCalledExactlyOnceWith("Model A");
});

it("applies the latest local intent when selection and apply share one React batch", async () => {
  const onApply = vi.fn().mockResolvedValue(undefined);
  render(<LocalModelPicker rows={rows} currentModel="Model A" onApply={onApply} onCancel={vi.fn()} />);
  const b = screen.getByRole("radio", { name: "Model B" });
  const apply = screen.getByRole("button", { name: "Use model" });
  await act(async () => {
    b.click();
    apply.click();
  });
  expect(onApply).toHaveBeenCalledExactlyOnceWith("Model B");
});

it("locks repeated apply and rows while pending but leaves cancel available", async () => {
  let resolve!: () => void;
  const onApply = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
  const onCancel = vi.fn();
  render(<LocalModelPicker rows={rows} onApply={onApply} onCancel={onCancel} />);
  await userEvent.dblClick(screen.getByRole("button", { name: "Use model" }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Applying…" })).toBeDisabled();
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  await act(async () => resolve());
});

it("keeps selection and exposes an inline failure for explicit retry", async () => {
  const onApply = vi.fn().mockRejectedValueOnce(new Error("Model menu changed"));
  render(<LocalModelPicker rows={rows} onApply={onApply} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole("radio", { name: "Model B" }));
  await userEvent.click(screen.getByRole("button", { name: "Use model" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Model menu changed");
  expect(screen.getByRole("radio", { name: "Model B" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("button", { name: "Use model" })).toBeEnabled();
  expect(onApply).toHaveBeenCalledTimes(1);
});

it("disables unavailable catalogs and disabled controls without disabling cancel", () => {
  const props = { onApply: vi.fn(), onCancel: vi.fn() };
  const { rerender } = render(<LocalModelPicker rows={[]} {...props} />);
  expect(screen.getByRole("button", { name: "Use model" })).toBeDisabled();
  rerender(<LocalModelPicker rows={rows} disabled {...props} />);
  for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  expect(screen.getByRole("button", { name: "Use model" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
});

it("marks the chosen row once, with a trailing check, and the others not at all", async () => {
  render(<LocalModelPicker rows={rows} currentModel="Model A" onApply={vi.fn()} onCancel={vi.fn()} />);
  const marks = (row: HTMLElement) => row.querySelectorAll('[aria-hidden="true"]');
  const a = screen.getByRole("radio", { name: "Model A" });
  const b = screen.getByRole("radio", { name: "Model B" });
  expect(marks(a)).toHaveLength(1);
  expect(marks(a)[0]).toHaveClass("lucide-check");
  expect(marks(b)).toHaveLength(0);

  await userEvent.click(b);
  expect(marks(a)).toHaveLength(0);
  expect(marks(b)).toHaveLength(1);
});
