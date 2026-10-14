import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CollieHome } from "./collie-home";

describe("CollieHome", () => {
  it("returns home when tapped", async () => {
    const onHome = vi.fn();
    render(<CollieHome onHome={onHome} />);
    await userEvent.click(screen.getByRole("button", { name: "Nenu home" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("shows the static app icon at rest", () => {
    const { container } = render(<CollieHome />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/nenu-mark.png");
    expect(container.querySelector("img")?.className).not.toMatch(/grayscale/);
  });

  it("rests on the muted static icon once the outage escalates to lost", () => {
    const { container } = render(<CollieHome lost />);
    const icon = container.querySelector("img");
    expect(icon).toHaveAttribute("src", "/nenu-mark.png");
    expect(icon?.className).toMatch(/grayscale/);
    expect(screen.getByRole("button", { name: "Nenu home — not connected" })).toBeInTheDocument();
  });
});
