import { Profiler } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIdleLock, setLocked } from "@/lib/idle";
import { WorkActivityLabel } from "./work-activity-label";

let hidden = false;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:05Z"));
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  resetIdleLock();
});
afterEach(() => { cleanup(); resetIdleLock(); vi.restoreAllMocks(); vi.useRealTimers(); });
const startedAt = "2026-09-08T12:00:00Z";
function visibility(value: boolean) {
  act(() => { hidden = value; document.dispatchEvent(new Event("visibilitychange")); });
}

describe("WorkActivityLabel", () => {
  it("updates only the elapsed text, once a minute, without causing React commits for the surrounding transcript", () => {
    const committed = vi.fn();
    render(<Profiler id="transcript" onRender={committed}><WorkActivityLabel startedAt={startedAt} /></Profiler>);
    expect(screen.getByText("Working for <1m")).toBeVisible();
    const initialCommits = committed.mock.calls.length;
    act(() => { vi.advanceTimersByTime(54_000); });
    expect(screen.getByText("Working for <1m")).toBeVisible();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Working for 1m")).toBeVisible();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Working for 2m")).toBeVisible();
    expect(committed).toHaveBeenCalledTimes(initialCommits);
  });

  it("pauses while hidden and catches up on visibility without creating duplicate timers", () => {
    render(<WorkActivityLabel startedAt={startedAt} />);
    expect(vi.getTimerCount()).toBe(1);
    visibility(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(screen.getByText("Working for <1m")).toBeInTheDocument();
    visibility(false);
    expect(screen.getByText("Working for 2m")).toBeInTheDocument();
    visibility(false);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(55_000); });
    expect(screen.getByText("Working for 3m")).toBeInTheDocument();
  });

  it("does not start a timer in a hidden tab", () => {
    hidden = true;
    render(<WorkActivityLabel startedAt={startedAt} />);
    expect(vi.getTimerCount()).toBe(0);
    visibility(false);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pauses under the idle lock and catches up when the user unlocks", () => {
    render(<WorkActivityLabel startedAt={startedAt} />);
    act(() => setLocked(true));
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Working for <1m")).toBeInTheDocument();
    act(() => setLocked(false));
    expect(screen.getByText("Working for 1m")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("cleans up intervals and visibility listeners on unmount", () => {
    const { unmount } = render(<WorkActivityLabel startedAt={startedAt} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    visibility(false);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.queryByText(/^Working/)).not.toBeInTheDocument();
  });

  it.each([undefined, "", "not-a-date"])("avoids a fake duration and timer for missing/invalid start %s", (start) => {
    render(<WorkActivityLabel startedAt={start} />);
    expect(screen.getByText("Working…")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces the old interval when the next activity starts", () => {
    const { rerender } = render(<WorkActivityLabel startedAt={startedAt} />);
    rerender(<WorkActivityLabel startedAt="2026-09-08T11:58:10Z" />);
    expect(screen.getByText("Working for 1m")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText("Working for 2m")).toBeInTheDocument();
  });

  // A pulse on the words was the only live signal, and reduced motion took it away; a spinner then
  // cost CPU for the whole turn. The mark is a steady dot in the working colour, for everyone.
  it("marks the live state with a still dot beside the words, with nothing that moves", () => {
    const { container } = render(<WorkActivityLabel startedAt={startedAt} />);
    const glyph = container.querySelector("[data-live-glyph]");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveClass("text-status-working");
    expect(glyph?.querySelector("svg")).toBeNull();
    expect(container.querySelector("[class*='animate-']")).toBeNull();
  });
});
