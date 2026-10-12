import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AttachmentChips } from "./attachment-chips";

describe("AttachmentChips", () => {
  // The X stays a small 24px mark; the shared .hit-area gives a touch screen its 44px reach (the
  // workbench.css rule composer-workbench.test.tsx pins). The bench measures the 44x44 on the chip.
  it("gives Remove the app's one 44px touch reach and removes that image", async () => {
    const onRemove = vi.fn();
    render(<AttachmentChips items={[{ id: "a", url: "blob:a", status: "ready" }]} onRemove={onRemove} onRetry={vi.fn()} />);
    const remove = screen.getByRole("button", { name: "Remove Image 1" });
    expect(remove).toHaveClass("hit-area");
    await userEvent.click(remove);
    expect(onRemove).toHaveBeenCalledExactlyOnceWith("a");
  });
});
