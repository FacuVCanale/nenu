import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DisplayPrefsContent } from "./display-prefs";
import { useChatText } from "@/hooks/use-display-prefs";

const prefs = { wrap: true, fontSize: 12, rawTerminal: false, tapToFocus: true };

function renderDock(surface: "chat" | "terminal") {
  return render(<DisplayPrefsContent surface={surface} prefs={prefs} setWrap={vi.fn()} stepFontSize={vi.fn()} setTapToFocus={vi.fn()} />);
}

describe("DisplayPrefsContent", () => {
  beforeEach(() => localStorage.clear());
  // Chat text is app-wide state; put it back so the next test starts at Default.
  afterEach(() => {
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("default"));
  });

  // 0.65.0 offered the mirror's Wrap lines, Tap to type and Text size over the chat too, where none
  // of them changes anything on screen (bench: tabs-display-copy-shots/repro.ts). A chat's Display
  // holds only what sizes the chat.
  it("over the chat, offers its Text size as Small, Default and Large, and the pick sizes the conversation", async () => {
    const user = userEvent.setup();
    renderDock("chat");
    expect(screen.queryByRole("switch", { name: "Wrap lines" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Tap to type" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Increase font size" })).toBeNull();
    const group = screen.getByRole("radiogroup", { name: "Text size" });
    const sizes = within(group).getAllByRole("radio");
    expect(sizes.map((radio) => radio.textContent)).toEqual(["Small", "Default", "Large"]);
    expect(within(group).getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(group).getByRole("radio", { name: "Large" }));
    expect(within(group).getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.chatText).toBe("large");
  });

  it("over the terminal, offers the mirror's own settings and not the chat's size", () => {
    renderDock("terminal");
    expect(screen.getByRole("switch", { name: "Wrap lines" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Tap to type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decrease font size" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });
});
