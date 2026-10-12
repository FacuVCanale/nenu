import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { QuickActionsContent } from "./quick-actions";

describe("QuickActionsContent", () => {
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
