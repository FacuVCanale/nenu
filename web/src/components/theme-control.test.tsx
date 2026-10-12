import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// use-theme holds module-scope state, so each case re-imports both the hook and this component to
// get a clean slate (see use-theme.test.ts for why the state lives there).

const STORAGE_KEY = "collie:theme:v1";

async function load(stored: string | null) {
  localStorage.clear();
  if (stored !== null) localStorage.setItem(STORAGE_KEY, stored);
  document.documentElement.className = "";
  vi.resetModules();
  return import("./theme-control");
}

describe("ThemeControl", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  it("renders three options with the stored one selected", async () => {
    const { ThemeControl } = await load("dark");
    render(<ThemeControl />);

    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => o.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
  });

  it("defaults to System when nothing is stored", async () => {
    const { ThemeControl } = await load(null);
    render(<ThemeControl />);
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  });

  it("pins a theme on selection, stamping the class and persisting it", async () => {
    const { ThemeControl } = await load(null);
    render(<ThemeControl />);

    await userEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect([...document.documentElement.classList]).toEqual(["light"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
  });

  it("un-pins back to System, clearing both the class and the key", async () => {
    const { ThemeControl } = await load("dark");
    render(<ThemeControl />);

    await userEvent.click(screen.getByRole("radio", { name: "System" }));

    expect([...document.documentElement.classList]).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("is one tab stop: only the selected option takes Tab", async () => {
    const { ThemeControl } = await load("light");
    render(<ThemeControl />);
    expect(screen.getAllByRole("radio").map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("moves the selection with the arrow keys, wrapping at the ends, and keeps focus on it", async () => {
    const { ThemeControl } = await load(null);
    render(<ThemeControl />);
    const user = userEvent.setup();

    screen.getByRole("radio", { name: "System" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();
  });

  it("leaves a modified arrow to the browser, so Alt+Left still goes back", async () => {
    const { ThemeControl } = await load(null);
    render(<ThemeControl />);
    const system = screen.getByRole("radio", { name: "System" });
    system.focus();

    for (const modifier of ["altKey", "metaKey", "ctrlKey"] as const) {
      // fireEvent returns false when the handler called preventDefault.
      expect(fireEvent.keyDown(system, { key: "ArrowLeft", [modifier]: true })).toBe(true);
      expect(system).toHaveAttribute("aria-checked", "true");
    }
  });
});
