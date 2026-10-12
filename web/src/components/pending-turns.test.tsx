import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PendingTurns } from "./pending-turns";
import type { LocalSend, LocalSendActions } from "@/lib/local-sends";

const actions = (): LocalSendActions => ({
  retry: vi.fn(), edit: vi.fn(), remove: vi.fn(), sendNow: vi.fn(), readNow: vi.fn(), openTerminal: vi.fn(),
});

const queued: LocalSend = {
  id: "s1", text: "after this turn", state: "queued", queueId: "q1", queueState: "queued",
  deliveryMode: "afterTurn", agent: "claude",
};

describe("PendingTurns", () => {
  it("marks a queued message with a Queued badge and keeps Send now, Edit and Remove behind one ⋯", async () => {
    const user = userEvent.setup();
    const handlers = actions();
    render(<PendingTurns sends={[queued]} actions={handlers} />);

    expect(screen.getByText("after this turn")).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(within(status).getByText("Queued")).toBeInTheDocument();
    expect(status).toHaveTextContent("Queued It goes when Claude finishes this turn.");
    // Nothing to tap on the line itself: the row's management lives in its menu.
    expect(screen.queryByRole("button", { name: "Send now" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Queued message actions" }));
    const menu = screen.getByRole("dialog", { name: "Queued message" });
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(["Send now", "Edit", "Remove"]);
    await user.click(within(menu).getByRole("button", { name: "Remove" }));
    expect(handlers.remove).toHaveBeenCalledExactlyOnceWith(queued);
    expect(screen.queryByRole("dialog", { name: "Queued message" })).toBeNull();
  });

  it("keeps a failed send's remedy on the line, where the failure is", async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const failed: LocalSend = { id: "s2", text: "ship it", state: "failed", error: "Not sent" };
    render(<PendingTurns sends={[failed]} actions={handlers} />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(handlers.retry).toHaveBeenCalledExactlyOnceWith(failed);
    await user.click(screen.getByRole("button", { name: "Queued message actions" }));
    expect(within(screen.getByRole("dialog", { name: "Queued message" })).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("says Sending… with nothing to tap while the send is in flight", () => {
    render(<PendingTurns sends={[{ id: "s3", text: "on its way", state: "sending" }]} actions={actions()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Sending…");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
