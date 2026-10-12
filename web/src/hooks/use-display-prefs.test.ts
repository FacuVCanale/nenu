import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderHook, act } from "@testing-library/react";

import { cssRules } from "@/test/css-rules";
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

// Chat text sizes the conversation's turns: the hook puts the choice on the root, and the chat
// stylesheet hands a step around the root's own body size to the turns only. The app's row titles
// keep their body size, and the terminal mirror keeps its own Text size.
describe("useChatText", () => {
  const CHAT_TEXT_KEY = "collie:chat-text:v1";
  const root = document.documentElement;

  beforeEach(async () => {
    localStorage.clear();
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("default"));
    localStorage.clear();
  });

  it("starts at Default, with nothing on the root", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    expect(result.current[0]).toBe("default");
    expect(root.dataset.chatText).toBeUndefined();
  });

  it("puts Small or Large on the root and never overrides the app's own body size", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("large"));
    expect(result.current[0]).toBe("large");
    expect(root.dataset.chatText).toBe("large");
    act(() => result.current[1]("small"));
    expect(root.dataset.chatText).toBe("small");
    expect(root.style.getPropertyValue("--text-body")).toBe("");
    expect(root.style.getPropertyValue("--text-body--line-height")).toBe("");
    act(() => result.current[1]("default"));
    expect(root.dataset.chatText).toBeUndefined();
  });

  it("is saved, and applied again as soon as the app loads", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    act(() => result.current[1]("large"));
    expect(localStorage.getItem(CHAT_TEXT_KEY)).toBe("large");

    delete root.dataset.chatText;
    vi.resetModules();
    await import("./use-display-prefs");
    expect(root.dataset.chatText).toBe("large");
  });

  it("ignores a stored value it does not know", async () => {
    localStorage.setItem(CHAT_TEXT_KEY, "huge");
    vi.resetModules();
    const { useChatText } = await import("./use-display-prefs");
    const { result } = renderHook(() => useChatText());
    expect(result.current[0]).toBe("default");
    expect(root.dataset.chatText).toBeUndefined();
  });

  it("keeps every mounted reader in step", async () => {
    const { useChatText } = await import("./use-display-prefs");
    const a = renderHook(() => useChatText());
    const b = renderHook(() => useChatText());
    act(() => a.result.current[1]("small"));
    expect(b.result.current[0]).toBe("small");
  });
});

describe("the chat stylesheet's Chat text", () => {
  const rules = cssRules(readFileSync(resolve(import.meta.dirname, "../styles/chat.css"), "utf8"));
  const decls = (selector: string) => rules.find((rule) => rule.selectors.includes(selector))?.decls ?? {};

  it("steps one px under or two over the root's own body size, so it follows the pointer and the stylesheet", () => {
    expect(decls(':root[data-chat-text="small"]')).toMatchObject({
      "--chat-text": "calc(var(--text-body) - 1px)",
      "--chat-text--line-height": "calc(var(--text-body--line-height) - 2px)",
    });
    expect(decls(':root[data-chat-text="large"]')).toMatchObject({
      "--chat-text": "calc(var(--text-body) + 2px)",
      "--chat-text--line-height": "calc(var(--text-body--line-height) + 2px)",
    });
  });

  it("hands that size to the conversation's turns only: the thread's, this device's pending ones and the queue's", () => {
    expect(decls(":root[data-chat-text] :is([data-speaker], [data-pending-send], [data-queue-row])")).toEqual({
      "--text-body": "var(--chat-text)",
      "--text-body--line-height": "var(--chat-text--line-height)",
    });
    const rootBody = rules.filter((rule) => rule.selectors.some((s) => s.startsWith(":root") && !s.includes(" ")) && "--text-body" in rule.decls);
    expect(rootBody).toEqual([]);
  });
});
