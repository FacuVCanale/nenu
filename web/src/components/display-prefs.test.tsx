import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DisplayPrefsContent } from "./display-prefs";
import { useChatText } from "@/hooks/use-display-prefs";

const prefs = { wrap: true, fontSize: 12, rawTerminal: false, tapToFocus: true };

function renderDock() {
  return render(<DisplayPrefsContent prefs={prefs} setWrap={vi.fn()} stepFontSize={vi.fn()} setTapToFocus={vi.fn()} />);
}

describe("DisplayPrefsContent", () => {
  beforeEach(() => localStorage.clear());
  // Chat text is app-wide state; put it back so the next test starts at Default.
  afterEach(() => {
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("default"));
  });

  it("offers Chat text as Small, Default and Large, and the pick sizes the conversation", async () => {
    const user = userEvent.setup();
    renderDock();
    const group = screen.getByRole("radiogroup", { name: "Chat text" });
    const sizes = within(group).getAllByRole("radio");
    expect(sizes.map((radio) => radio.textContent)).toEqual(["Small", "Default", "Large"]);
    expect(within(group).getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "true");

    await user.click(within(group).getByRole("radio", { name: "Large" }));
    expect(within(group).getByRole("radio", { name: "Large" })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: "Default" })).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.dataset.chatText).toBe("large");
  });

  it("puts the mirror's own settings under Terminal view", () => {
    renderDock();
    const terminal = screen.getByRole("region", { name: "Terminal view" });
    expect(within(terminal).getByRole("switch", { name: "Wrap lines" })).toBeInTheDocument();
    expect(within(terminal).getByRole("switch", { name: "Tap to type" })).toBeInTheDocument();
    expect(within(terminal).getByRole("button", { name: "Decrease font size" })).toBeInTheDocument();
    expect(within(terminal).queryByRole("radiogroup", { name: "Chat text" })).toBeNull();
  });
});
