import { renderHook, act } from "@testing-library/react";

import { clearStatus, pauseStatus, resumeStatus, setStatus, useStatus } from "./status";

// The global status channel: latest-wins, errors persist, everything else auto-clears on a TTL.
// We observe it through useStatus (the public read) and drive the TTL with fake timers.
describe("status channel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearStatus();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the latest message to subscribers", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("hello", "info"));
    expect(result.current?.text).toBe("hello");
    expect(result.current?.tone).toBe("info");
  });

  it("auto-clears a non-error after 2500ms", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("done", "success"));
    expect(result.current?.text).toBe("done");
    act(() => vi.advanceTimersByTime(2500));
    expect(result.current).toBeNull();
  });

  it("keeps an error until it is explicitly dismissed", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("boom", "error"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current?.text).toBe("boom");
    act(() => clearStatus());
    expect(result.current).toBeNull();
  });

  it("latest message wins and resets the auto-clear timer", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("first", "info"));
    act(() => vi.advanceTimersByTime(2000));
    act(() => setStatus("second", "info"));
    act(() => vi.advanceTimersByTime(2000)); // 4s since "first" but only 2s since "second"
    expect(result.current?.text).toBe("second");
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBeNull();
  });

  it("honours an explicit ttl of null (persist)", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("sticky", "info", null));
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current?.text).toBe("sticky");
  });
});


describe("notification interaction lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); clearStatus(); });
  afterEach(() => { clearStatus(); vi.useRealTimers(); });

  it("preserves a foreground error when an agent finishes in the background", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("Could not send. Your draft is safe.", "error"));
    const error = result.current;
    act(() => setStatus("Codex finished", "success", undefined, { background: true }));
    expect(result.current).toBe(error);
    act(() => setStatus("Sent", "success"));
    expect(result.current?.text).toBe("Sent");
  });

  it("resumes only the remaining visible lifetime, without extending it on repeated resume", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("Finished", "success"));
    const id = result.current!.id;
    act(() => vi.advanceTimersByTime(1000));
    act(() => pauseStatus(id));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current?.text).toBe("Finished");
    act(() => { resumeStatus(id); resumeStatus(id); });
    act(() => vi.advanceTimersByTime(1499));
    expect(result.current).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBeNull();
  });

  it("ignores stale dismissal and pause handlers after replacement", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("Old"));
    const old = result.current!.id;
    act(() => setStatus("New", "success", undefined, { description: "project · tab" }));
    act(() => { clearStatus(old); pauseStatus(old); resumeStatus(old); });
    expect(result.current?.description).toBe("project · tab");
    act(() => vi.advanceTimersByTime(2500));
    expect(result.current).toBeNull();
  });

  it("carries where a notice leads, so the toast can open it", () => {
    const { result } = renderHook(() => useStatus());
    act(() => setStatus("Working Claude needs your input", "warn", undefined, { to: "/pane/w1%3Ap1" }));
    expect(result.current?.to).toBe("/pane/w1%3Ap1");
    act(() => setStatus("Copied", "success"));
    expect(result.current).not.toHaveProperty("to");
  });
});
