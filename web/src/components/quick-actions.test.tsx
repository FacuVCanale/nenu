import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QuickActionsContent } from "./quick-actions";

describe("QuickActionsContent", () => {
  it("groups the replies under their names, in sentence case", () => {
    render(<QuickActionsContent onSend={vi.fn()} onClose={vi.fn()} agent="claude" isShell={false} />);
    const confirm = screen.getByRole("group", { name: "Confirm" });
    expect(within(confirm).getAllByRole("button").map((b) => b.textContent)).toEqual(["yes", "no"]);
    expect(within(screen.getByRole("group", { name: "Common" })).getByRole("button", { name: "continue" })).toBeInTheDocument();
  });

  it("sends the tapped reply and closes the dock once it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const onSend = vi.fn(async () => true);
      const onClose = vi.fn();
      render(<QuickActionsContent onSend={onSend} onClose={onClose} agent="claude" isShell={false} />);
      await userEvent.click(screen.getByRole("button", { name: "continue" }));
      expect(onSend).toHaveBeenCalledExactlyOnceWith("continue");
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce(), { timeout: 3000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the tapped reply busy while it sends, and leaves its siblings merely unavailable", async () => {
    let settle!: (ok: boolean) => void;
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    render(<QuickActionsContent onSend={onSend} onClose={vi.fn()} agent="claude" isShell={false} />);
    const [tapped, sibling] = screen.getAllByRole("button") as [HTMLButtonElement, HTMLButtonElement];

    await userEvent.click(tapped);
    // Busy, not unavailable: the button keeps its filled look instead of the disabled tokens.
    expect(tapped).toBeDisabled();
    expect(tapped).toHaveAttribute("aria-busy", "true");
    expect(sibling).toBeDisabled();
    expect(sibling).not.toHaveAttribute("aria-busy");

    settle(true);
    await waitFor(() => expect(tapped).not.toHaveAttribute("aria-busy"));
  });
});
