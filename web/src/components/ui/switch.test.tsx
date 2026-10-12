import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Switch, switchSlot } from "./switch";

describe("Switch", () => {
  it("toggles through its role and aria-checked", async () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Haptics" />);
    await userEvent.click(screen.getByRole("switch", { name: "Haptics" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("is 51 by 31 on a coarse pointer and 40 by 24 on a fine one, with a 44px touch target", () => {
    render(<Switch checked onCheckedChange={vi.fn()} aria-label="Haptics" />);
    expect(screen.getByRole("switch")).toHaveClass("h-6", "w-10", "coarse:h-[31px]", "coarse:w-[51px]", "hit-area");
  });

  it("gives a slot that stands in for it (a spinner while loading) exactly its footprint", () => {
    render(<Switch checked onCheckedChange={vi.fn()} aria-label="Haptics" />);
    const size = [...screen.getByRole("switch").classList].filter((c) => /^(coarse:)?[hw]-/.test(c));
    expect(size).toHaveLength(4);
    expect(switchSlot.split(" ")).toEqual(expect.arrayContaining(size));
  });

  it("keeps a white thumb in both themes, on and off", () => {
    for (const checked of [true, false]) {
      const { unmount } = render(<Switch checked={checked} onCheckedChange={vi.fn()} aria-label="Haptics" />);
      const thumb = screen.getByRole("switch").firstElementChild!;
      expect(thumb).toHaveClass("bg-white");
      expect(thumb).not.toHaveClass("bg-background");
      unmount();
    }
  });

  it("marks off with a solid track and a ring, not a hollow outline", () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} aria-label="Haptics" />);
    const track = screen.getByRole("switch");
    expect(track).toHaveClass("bg-switch-off");
    expect(track).not.toHaveClass("border-2");
  });
});
