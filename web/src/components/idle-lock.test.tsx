import { fireEvent, render, screen } from "@testing-library/react";

import { IdleLock } from "./idle-lock";

describe("IdleLock", () => {
  it("says Paused and offers Resume, in words that fit a desk as well as a phone", () => {
    const onUnlock = vi.fn();
    render(<IdleLock onUnlock={onUnlock} />);
    const cover = screen.getByRole("dialog", { name: "Nenu paused" });
    expect(cover).toHaveTextContent("Paused");
    expect(cover).not.toHaveTextContent(/tap/i);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onUnlock).toHaveBeenCalledOnce();
  });

  it("resumes on Enter", () => {
    const onUnlock = vi.fn();
    render(<IdleLock onUnlock={onUnlock} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onUnlock).toHaveBeenCalledOnce();
  });

  it("keeps the same button slot while catching up: disabled, busy, with a spinner and a label", () => {
    const onUnlock = vi.fn();
    render(<IdleLock onUnlock={onUnlock} catchingUp />);
    const button = screen.getByRole("button", { name: "Resuming…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector("svg")).not.toBeNull();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("never draws a lock or speaks of safety: the pause guards nothing (ADR 0007)", () => {
    const { container } = render(<IdleLock onUnlock={() => {}} />);
    expect(container.querySelector("[class*='lucide-lock']")).toBeNull();
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/lock|safe|secur/i);
  });
});
