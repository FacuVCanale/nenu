import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PaneGone } from "./pane-gone";

// The way home from a chat whose pane is gone reads Go to Home, as from every other empty state, and
// is the 404's and a closed pane's history's large button.
describe("PaneGone", () => {
  it("offers Go to Home as the one way out when there is no pane beside it", async () => {
    const onHome = vi.fn();
    render(<PaneGone closed={false} unsure={false} onOpen={vi.fn()} onHome={onHome} />);
    const home = screen.getByRole("button", { name: "Go to Home" });
    expect(home).toHaveClass("ui-button-lg", "bg-foreground");
    await userEvent.click(home);
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("puts the pane beside a closed one first, and keeps Go to Home beside it at the same size", async () => {
    const onOpen = vi.fn();
    render(<PaneGone closed unsure={false} next={{ paneId: "w1:p2", name: "Codex" }} onOpen={onOpen} onHome={vi.fn()} />);
    const open = screen.getByRole("button", { name: "Open Codex" });
    expect(open).toHaveClass("ui-button-lg", "bg-foreground");
    expect(screen.getByRole("button", { name: "Go to Home" })).toHaveClass("ui-button-lg");
    expect(screen.getByRole("button", { name: "Go to Home" })).not.toHaveClass("bg-foreground");
    await userEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith("w1:p2");
  });
});
