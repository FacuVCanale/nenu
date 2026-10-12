import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { LiveStepRow, ThinkingStep, ToolStep } from "./work-log-tools";
import { FileMediaContext } from "@/lib/file-preview-context";
import type { TranscriptPart } from "@/lib/types";

type Call = Extract<TranscriptPart, { kind: "tool" }>;
const status: Call = { kind: "tool", name: "Bash", summary: "git status", result: { text: "clean" } };
const failedRead: Call = { kind: "tool", name: "Read", summary: "/file.ts", result: { text: "file contents", isError: true, truncated: true } };
const pending: Call = { kind: "tool", name: "Bash", summary: "pwd" };

function Steps({ calls, query = "", active = false, focused }: { calls: Call[]; query?: string; active?: boolean; focused?: number }) {
  return <>{calls.map((part, i) => <ToolStep key={i} id={`call-${i}`} part={part} query={query} active={active} focused={focused === i} />)}</>;
}

afterEach(() => { vi.useRealTimers(); });

it("draws a call as one line, what it did and on what, with its output behind one tap", async () => {
  render(<Steps calls={[status]} />);
  const row = screen.getByRole("button", { name: "Ran git status", expanded: false });
  expect(row).toHaveTextContent("Ran");
  expect(row).toHaveTextContent("git status");
  expect(screen.queryByText("clean")).not.toBeInTheDocument();
  await userEvent.click(row);
  expect(row).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("clean")).toBeInTheDocument();
});

it("shows a failed call as Failed on its own line, and opens its output with one tap", async () => {
  render(<Steps calls={[status, failedRead, pending]} />);
  // Every call is its own row: there is no group to open first.
  expect(screen.getAllByRole("button")).toHaveLength(3);
  expect(screen.queryByText(/tool calls?/)).not.toBeInTheDocument();
  const failed = screen.getByRole("button", { name: /^Read \/file\.ts Failed/ });
  expect(failed).toHaveTextContent("Failed");
  await userEvent.click(failed);
  expect(screen.getByText("file contents")).toBeInTheDocument();
  expect(screen.getByText(/output truncated/)).toBeInTheDocument();
});

// A tool the timeline has no verb for is named by itself, and that name can be long. On a phone it
// must give way, so the Failed chip and the chevron stay on the row.
it("keeps a failed call's chip on its row when the tool's own name is long", () => {
  render(<Steps calls={[{ kind: "tool", name: "mcp__plugin_playwright_playwright__browser_take_screenshot", summary: "home-phone.png", result: { text: "Error: Browser is not installed.", isError: true } }]} />);
  const row = screen.getByRole("button", { name: /^browser_take_screenshot home-phone\.png Failed/ });
  expect(within(row).getByText("browser_take_screenshot")).toHaveClass("min-w-0", "truncate");
  expect(within(row).getByText("Failed")).toHaveClass("shrink-0");
});

it("keeps a file's name whole and drops the temp folders in front of it", () => {
  const path = "/var/folders/zd/7_1tqb1n5s7fbmsk0dqnzsk40000gn/T/nenu-e2e-kSVt1n/web/src/hooks/use-app-viewport.ts";
  render(<Steps calls={[{ kind: "tool", name: "Edit", summary: path, result: { text: "updated" } }]} />);
  const row = screen.getByRole("button", { name: `Edited ${path}` });
  expect(screen.getByText("use-app-viewport.ts")).toBeInTheDocument();
  expect(row.textContent).not.toContain("/var/folders");
  expect(row).toHaveTextContent(/hooks\/use-app-viewport\.ts/);
});

it.each(["Read", "/file.ts", "file contents"])("opens only the rows that hold the query %s", (query) => {
  render(<Steps calls={[status, failedRead, pending]} query={query} />);
  expect(screen.getByRole("button", { name: /^Read \/file\.ts/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: /^Ran git status/ })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("file contents")).toBeInTheDocument();
});

it("keeps the tool's own name findable: a search for it opens the row that shows it", () => {
  render(<Steps calls={[status]} query="Bash" />);
  expect(screen.getByRole("button", { name: /^Ran git status/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("Bash")).toBeInTheDocument();
});

it("treats historical missing output as unknown and only active missing output as running", async () => {
  const { rerender } = render(<Steps calls={[pending]} />);
  expect(screen.getByRole("button", { name: "Ran pwd No output recorded" })).toBeEnabled();
  expect(screen.queryByText("Running…")).not.toBeInTheDocument();
  rerender(<Steps calls={[pending]} active />);
  const running = screen.getByRole("button", { name: "Running pwd" });
  expect(screen.queryByText("No output recorded")).not.toBeInTheDocument();
  await userEvent.click(running);
  expect(screen.getByText("Running…")).toBeInTheDocument();
});

it("reveals literal command/output without Markdown or HTML execution and wraps long content", () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const { container } = render(<Steps calls={[{ kind: "tool", name: "Bash", summary: "echo **literal**", result: { text: `## literal heading\n${hostile}` } }]} query="literal" />);
  expect(container.querySelector("img,script,strong,h2")).toBeNull();
  expect(container.textContent).toContain(hostile);
  const details = container.querySelectorAll("pre");
  expect(details).toHaveLength(2);
  for (const detail of details) expect(detail).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
});

it("opens a focused call without a query", () => {
  render(<Steps calls={[status, failedRead]} focused={1} />);
  expect(screen.getByRole("button", { name: /^Read \/file\.ts/ })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: /^Ran git status/ })).toHaveAttribute("aria-expanded", "false");
  for (const button of screen.getAllByRole("button")) expect(button).toHaveAttribute("data-work-toggle");
});

it("shows the image a read tool opened as a thumbnail, folded or open", async () => {
  render(<FileMediaContext.Provider value={(path) => `/api/file?path=${path}`}>
    <ToolStep id="read" owner="e1" part={{ kind: "tool", name: "Read", summary: "shots/home.png", result: { text: "" } }} query="" active={false} focused={false} />
  </FileMediaContext.Provider>);
  expect(screen.getByRole("img", { name: "home.png" })).toHaveAttribute("src", "/api/file?path=shots/home.png");
  await userEvent.click(screen.getByRole("button", { name: /^Read shots\/home\.png/ }));
  expect(screen.getByRole("img", { name: "home.png" })).toBeInTheDocument();
});

describe("ThinkingStep", () => {
  it("previews the thought's first line on one row and opens the whole of it", async () => {
    render(<ThinkingStep text={"Compare the two implementations.\nThen keep the smaller one."} query="" />);
    const row = screen.getByRole("button", { name: "Thinking", expanded: false });
    expect(row).toHaveTextContent("Compare the two implementations.");
    expect(row).not.toHaveTextContent("Then keep the smaller one.");
    await userEvent.click(row);
    expect(screen.getByText(/Then keep the smaller one\./)).toBeInTheDocument();
  });

  it("says Thinking when the thought carries no words, and offers nothing to open", () => {
    render(<ThinkingStep text="" query="" />);
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("LiveStepRow", () => {
  it("says what runs now and for how long, ticking in place", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:42Z"));
    const { container } = render(<LiveStepRow step={{ kind: "terminal", verb: "Running", target: "bun run test tab-strip", format: "code", since: "2026-09-08T12:00:30Z" }} />);
    const row = container.querySelector("[data-live-step]")!;
    expect(row).toHaveTextContent("Running");
    expect(row).toHaveTextContent("bun run test tab-strip");
    expect(screen.getByText("12s")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("13s")).toBeInTheDocument();
    expect(row.querySelector("[data-live-glyph]")).not.toBeNull();
  });

  it("shows the thought's first line while the agent thinks", () => {
    const { container } = render(<LiveStepRow step={{ kind: "thinking", verb: "Thinking", target: "Ahora ajusto el chip.", format: "thought" }} />);
    expect(container.querySelector("[data-live-step]")).toHaveTextContent("ThinkingAhora ajusto el chip.");
  });
});
