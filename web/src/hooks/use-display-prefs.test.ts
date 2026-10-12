import { renderHook, act } from "@testing-library/react";
import { useDisplayPrefs } from "./use-display-prefs";

// Minimal localStorage stub — Vitest/jsdom includes a real one but this ensures it's clean per test.
const STORAGE_KEY = "collie:display-prefs:v5";
const RAW_STORAGE_KEY = "collie:raw-terminal-scopes:v1";

describe("useDisplayPrefs", () => {
  beforeEach(() => localStorage.clear());

  it("returns defaults when localStorage is empty", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ wrap: true, fontSize: 12, rawTerminal: false, tapToFocus: true });
  });

  it("persists wrap=true and reloads it on mount", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.setWrap(true));
    expect(result.current.prefs.wrap).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).wrap).toBe(true);
  });

  it("persists wrap=false and reloads it on mount", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.setWrap(false));
    expect(result.current.prefs.wrap).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).wrap).toBe(false);
  });

  it("loads persisted prefs from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ wrap: false, fontSize: 14, tapToFocus: false }));
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ wrap: false, fontSize: 14, rawTerminal: false, tapToFocus: false });
  });

  it("persists rawTerminal only for the current pane scope", () => {
    const { result } = renderHook(() => useDisplayPrefs("pane-a"));
    expect(result.current.prefs.rawTerminal).toBe(false);
    act(() => result.current.setRawTerminal(true));
    expect(result.current.prefs.rawTerminal).toBe(true);
    expect(JSON.parse(localStorage.getItem(RAW_STORAGE_KEY)!)["pane-a"]).toBe(true);
    const { result: reloaded } = renderHook(() => useDisplayPrefs("pane-a"));
    expect(reloaded.current.prefs.rawTerminal).toBe(true);
    const { result: other } = renderHook(() => useDisplayPrefs("pane-b"));
    expect(other.current.prefs.rawTerminal).toBe(false);
  });

  it("persists tapToFocus and reloads it on mount", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs.tapToFocus).toBe(true);
    act(() => result.current.setTapToFocus(false));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).tapToFocus).toBe(false);
    const { result: reloaded } = renderHook(() => useDisplayPrefs());
    expect(reloaded.current.prefs.tapToFocus).toBe(false);
  });

  it("migrates common v4 prefs but drops its global raw-terminal choice", () => {
    localStorage.setItem("collie:display-prefs:v4", JSON.stringify({ wrap: false, fontSize: 15, rawTerminal: true }));
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ wrap: false, fontSize: 15, rawTerminal: false, tapToFocus: true });
  });

  it("setFontSize clamps below minimum to 9", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.setFontSize(3));
    expect(result.current.prefs.fontSize).toBe(9);
  });

  it("setFontSize clamps above maximum to 16", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.setFontSize(99));
    expect(result.current.prefs.fontSize).toBe(16);
  });

  it("stepFontSize increments within range", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.stepFontSize(2)); // 12 + 2 = 14
    expect(result.current.prefs.fontSize).toBe(14);
  });

  it("stepFontSize does not exceed max", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.stepFontSize(10)); // 12 + 10 = 22 → clamp to 16
    expect(result.current.prefs.fontSize).toBe(16);
  });

  it("stepFontSize does not go below min", () => {
    const { result } = renderHook(() => useDisplayPrefs());
    act(() => result.current.stepFontSize(-10)); // 12 - 10 = 2 → clamp to 9
    expect(result.current.prefs.fontSize).toBe(9);
  });

  it("falls back to defaults on malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{{");
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ wrap: true, fontSize: 12, rawTerminal: false, tapToFocus: true });
  });

  it("falls back to defaults when stored value is not an object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(42));
    const { result } = renderHook(() => useDisplayPrefs());
    expect(result.current.prefs).toEqual({ wrap: true, fontSize: 12, rawTerminal: false, tapToFocus: true });
  });
});

// Chat text drives the type scale's body step, so the prose (and anything else set in text-body)
// follows it; the terminal mirror keeps its own Text size.
describe("useChatText", () => {
  const CHAT_TEXT_KEY = "collie:chat-text:v1";
  const root = document.documentElement;
  const token = (name: string) => root.style.getPropertyValue(name);

  beforeEach(async () => {
    localStorage.clear();
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("default"));
    localStorage.clear();
  });

  it("starts at Default and leaves --text-body to the stylesheet", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    expect(result.current[0]).toBe("default");
    expect(token("--text-body")).toBe("");
    expect(token("--text-body--line-height")).toBe("");
  });

  it("Large sets body two px over the pointer's own size, Small one under, Default clears it", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    // jsdom reports a fine pointer, whose body step is 15px.
    act(() => result.current[1]("large"));
    expect(result.current[0]).toBe("large");
    expect(token("--text-body")).toBe("1.0625rem");
    expect(token("--text-body--line-height")).toBe("1.625rem");
    act(() => result.current[1]("small"));
    expect(token("--text-body")).toBe("0.875rem");
    expect(token("--text-body--line-height")).toBe("1.375rem");
    act(() => result.current[1]("default"));
    expect(token("--text-body")).toBe("");
    expect(token("--text-body--line-height")).toBe("");
  });

  it("is saved, and applied again as soon as the app loads", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("large"));
    expect(localStorage.getItem(CHAT_TEXT_KEY)).toBe("large");

    root.style.removeProperty("--text-body");
    vi.resetModules();
    await import("./use-display-prefs");
    expect(token("--text-body")).toBe("1.0625rem");
  });

  it("ignores a stored value it does not know", async () => {
    localStorage.setItem(CHAT_TEXT_KEY, "huge");
    vi.resetModules();
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    expect(result.current[0]).toBe("default");
    expect(token("--text-body")).toBe("");
  });

  it("keeps every mounted reader in step", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const a = renderHook(() => useChatText());
    const b = renderHook(() => useChatText());
    act(() => a.result.current[1]("small"));
    expect(b.result.current[0]).toBe("small");
  });
});
