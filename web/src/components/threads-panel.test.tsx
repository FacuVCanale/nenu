import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";

import { clearStatus, useStatus } from "@/lib/status";
import type { ProjectThreadView, ProjectView } from "@/lib/types";
import { server } from "@/test/setup";
import { PrList } from "./threads-panel";

const thread = (id: string, title: string, pr: ProjectThreadView["pr"], extra: Partial<ProjectThreadView> = {}): ProjectThreadView =>
  ({ id, title, parentId: "root", role: "worker", status: "open", pr, ...extra });

function renderList(threads: ProjectThreadView[]) {
  const project: ProjectView = { slug: "hub", name: "Hub", status: "active", prActions: true, threads };
  render(<PrList project={project} threads={threads} readOnly={false} onOpenPane={vi.fn()} onOpenNode={vi.fn()} onChanged={vi.fn()} now={Date.parse("2026-10-13T12:00:00Z")} />);
}

const rowTitles = (list: HTMLElement) => within(list).getAllByRole("listitem").map((item) => item.querySelector(".task-main .font-medium")?.textContent);

it("lists only the open PRs of open threads; a resolved thread's PR and a merged one wait folded in History", async () => {
  // Measured 2026-10-13: Organizations stops reading a PR once its thread is resolved, so #1618 still
  // reads open although GitHub merged it the next day.
  renderList([
    thread("T1", "Build", { number: 12, state: "open", checks: { passed: 1, failed: 0, pending: 1 } }),
    thread("T2", "Old", { number: 1618, state: "open", checks: { passed: 0, failed: 0, pending: 0 } }, { status: "resolved", updated: "2026-10-06T22:52:29Z" }),
    thread("T3", "Shipped", { number: 1621, state: "merged" }, { updated: "2026-10-07T06:55:04Z" }),
  ]);
  expect(rowTitles(screen.getByRole("list", { name: "Open pull requests" }))).toEqual(["Build"]);
  expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "History · 2" }));
  const history = screen.getByRole("list", { name: "History" });
  expect(rowTitles(history)).toEqual(["Shipped", "Old"]);
  expect(within(history).getByRole("button", { name: /^Shipped/ })).toHaveTextContent("PR #1621 · Merged");
  expect(within(history).getByRole("button", { name: /^Old/ })).toHaveTextContent("PR #1618 · Last seen open");
});

it("says nothing is open when every PR is in History", () => {
  renderList([thread("T1", "Old", { number: 7, state: "merged" }, { status: "resolved" })]);
  expect(screen.getByText("No thread has an open pull request.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "History · 1" })).toBeInTheDocument();
});

it("says what each open PR waits on, in words and with a mark of its own, what needs you first", () => {
  renderList([
    thread("A", "Wip", { number: 1, state: "draft" }),
    thread("B", "Unread", { number: 2, state: "open" }),
    thread("C", "Running", { number: 3, state: "open", checks: { passed: 1, failed: 0, pending: 2 }, mergeBlocker: "checks pending" }),
    thread("D", "Failing", { number: 4, state: "open", checks: { passed: 2, failed: 1, pending: 0 }, mergeBlocker: "1 check(s) failed" }),
    thread("E", "Changes", { number: 5, state: "open", review: "changes_requested", checks: { passed: 3, failed: 0, pending: 0 } }),
    thread("F", "Green", { number: 6, state: "open", checks: { passed: 2, failed: 0, pending: 0 } }),
    thread("G", "Review", { number: 7, state: "open", review: "review_required", checks: { passed: 3, failed: 0, pending: 0 }, mergeBlocker: "not approved" }),
    thread("H", "Approved", { number: 8, state: "open", review: "approved" }),
    thread("I", "Ready", { number: 9, state: "open", review: "approved", checks: { passed: 3, failed: 0, pending: 0 }, mergeBlocker: null }),
  ]);
  const list = screen.getByRole("list", { name: "Open pull requests" });
  expect(rowTitles(list)).toEqual(["Ready", "Approved", "Review", "Green", "Changes", "Failing", "Running", "Unread", "Wip"]);
  const line = (title: string) => within(list).getByRole("button", { name: new RegExp(`^${title}`) });
  expect(line("Ready")).toHaveTextContent("PR #9 · Ready to merge");
  expect(line("Approved")).toHaveTextContent("PR #8 · Approved");
  expect(line("Review")).toHaveTextContent("PR #7 · Needs review");
  expect(line("Green")).toHaveTextContent("PR #6 · Checks passed");
  expect(line("Changes")).toHaveTextContent("PR #5 · Changes requested");
  expect(line("Failing")).toHaveTextContent("PR #4 · 1 check failing");
  expect(line("Running")).toHaveTextContent("PR #3 · Checks running 1/3");
  expect(line("Unread")).toHaveTextContent("PR #2 · Open");
  expect(line("Wip")).toHaveTextContent("PR #1 · Draft");
  const marks = within(list).getAllByRole("listitem").map((item) => item.querySelector("[data-pr-status]")?.getAttribute("data-pr-status"));
  expect(new Set(marks).size).toBe(9);
});

it("a PR's size opens its diff beside the row, without opening the thread", async () => {
  const onOpenPane = vi.fn();
  const threads = [thread("T1", "Build", { number: 12, state: "open", mergeBlocker: null, diff: { additions: 30, deletions: 4 } }, { paneId: "w1:p1" })];
  const project: ProjectView = { slug: "hub", name: "Hub", status: "active", prActions: true, threads };
  render(<PrList project={project} threads={threads} readOnly={false} onOpenPane={onOpenPane} onOpenNode={vi.fn()} onChanged={vi.fn()} />);
  const size = screen.getByRole("button", { name: "View changes: 30 added, 4 removed" });
  expect(size.closest(".task-main")).toBeNull();
  await userEvent.click(size);
  expect(onOpenPane).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Merge Build" })).toBeInTheDocument();
});

it("says when Organizations will merge a pull request on its own", () => {
  renderList([
    thread("A", "Auto", { number: 1, state: "open", checks: { passed: 1, failed: 0, pending: 1 } }, { autoMerge: true }),
    thread("B", "Manual", { number: 2, state: "open", checks: { passed: 1, failed: 0, pending: 1 } }, { autoMerge: false }),
  ]);
  const list = screen.getByRole("list", { name: "Open pull requests" });
  expect(within(list).getByRole("button", { name: /^Auto/ })).toHaveTextContent("PR #1 · Checks running 1/2 · Auto-merge");
  expect(within(list).getByRole("button", { name: /^Manual/ })).not.toHaveTextContent("Auto-merge");
});

// ── Each PR's one button ─────────────────────────────────────────────────────────────────────────

afterEach(() => {
  clearStatus();
  vi.useRealTimers();
});

function StatusLine() {
  const status = useStatus();
  return <p data-testid="status">{status ? [status.text, status.description].filter(Boolean).join(" / ") : ""}</p>;
}

function renderActions(threads: ProjectThreadView[], { readOnly = false, onOpenPr, onOpenNode = vi.fn(), onChanged = vi.fn() }: {
  readOnly?: boolean; onOpenPr?: (thread: ProjectThreadView) => void; onOpenNode?: (id: string) => void; onChanged?: () => void;
} = {}) {
  const project: ProjectView = { slug: "hub", name: "Hub", status: "active", prActions: true, threads };
  render(<><PrList project={project} threads={threads} readOnly={readOnly} onOpenPane={vi.fn()} onOpenNode={onOpenNode} onChanged={onChanged} onOpenPr={onOpenPr} /><StatusLine /></>);
}

const rowOf = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) }).closest("li")!;
const failing = (extra: Partial<ProjectThreadView> = {}) =>
  thread("B", "Failing", { number: 2, state: "open", checks: { passed: 1, failed: 1, pending: 0 }, mergeBlocker: "1 check(s) failed" }, { prAction: "fix-ci", ...extra });

it("each PR offers the one button its first action names, a pushed branch offers Create PR, and none is offered without one", async () => {
  renderActions([
    thread("A", "Conflicts", { number: 1, state: "open", mergeable: "CONFLICTING", mergeBlocker: "a merge conflict" }, { prAction: "resolve-conflicts" }),
    failing(),
    thread("C", "Comments", { number: 3, state: "open", review: "changes_requested", commentCount: 2, mergeBlocker: "review is CHANGES_REQUESTED" }, { prAction: "address-comments" }),
    thread("D", "Ready", { number: 4, state: "open", review: "approved", mergeBlocker: null }, { prAction: "merge" }),
    thread("E", "Pushed", undefined, { prAction: "create-pr", branch: "acme/pushed" }),
    thread("F", "Waiting", { number: 6, state: "open", review: "review_required", mergeBlocker: "review is REVIEW_REQUIRED" }),
  ]);
  for (const [label, title] of [["Resolve conflicts", "Conflicts"], ["Fix CI", "Failing"], ["Address comments", "Comments"], ["Merge", "Ready"], ["Create PR", "Pushed"]]) {
    expect(screen.getByRole("button", { name: `${label} ${title}` })).toHaveTextContent(new RegExp(`^${label}$`));
  }
  expect(within(rowOf("Waiting")).getAllByRole("button")).toHaveLength(1);
  expect(rowOf("Pushed")).toHaveTextContent("No PR · Branch pushed");
  // Merge keeps its confirmation.
  await userEvent.click(screen.getByRole("button", { name: "Merge Ready" }));
  expect(await screen.findByRole("dialog", { name: /Merge/ })).toBeVisible();
});

it("a read-only device sees each PR's state but no button", () => {
  renderActions([failing(), thread("E", "Pushed", undefined, { prAction: "create-pr" })], { readOnly: true });
  expect(within(rowOf("Failing")).getAllByRole("button")).toHaveLength(1);
  expect(within(rowOf("Pushed")).getAllByRole("button")).toHaveLength(1);
});

it("asks the thread with the action alone, says Asking… then Asked for a moment, and Already asked, with who asked, when it had been", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const posted: unknown[] = [];
  let answer = () => {};
  let sent = true;
  server.use(http.post("/api/org/thread/pr-action", async ({ request }) => {
    posted.push(await request.json());
    await new Promise<void>((resolve) => { answer = resolve; });
    return HttpResponse.json({ ok: true, asked: { id: "B", action: "fix-ci", pr: "https://github.com/acme/hub/pull/2", sent, reason: sent ? "" : "auto-fix already asked it at 2026-10-15T10:00:00Z about this state of its pull request (commit 0123456)" } });
  }));
  const onChanged = vi.fn();
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderActions([failing()], { onChanged });
  const button = screen.getByRole("button", { name: "Fix CI Failing" });

  await user.click(button);
  await vi.waitFor(() => expect(button).toHaveTextContent(/^Asking…$/));
  expect(button).toBeDisabled();
  expect(posted).toEqual([{ project: "hub", id: "B", action: "fix-ci" }]);
  act(() => answer());
  await vi.waitFor(() => expect(button).toHaveTextContent(/^Asked$/));
  expect(onChanged).toHaveBeenCalledTimes(1);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(button).toHaveTextContent(/^Fix CI$/);
  expect(button).toBeEnabled();

  sent = false;
  await user.click(button);
  await vi.waitFor(() => expect(posted).toHaveLength(2));
  act(() => answer());
  await vi.waitFor(() => expect(button).toHaveTextContent(/^Already asked$/));
  // A phone shows no tooltip: who asked, and when, is a notice.
  expect(screen.getByTestId("status")).toHaveTextContent(/^auto-fix already asked it at .* \/ Fix CI · Failing$/);
});

it("shows Organizations' refusal word for word and offers the button again", async () => {
  const reason = "no check fails on its pull request (3 passed, 0 pending)";
  server.use(http.post("/api/org/thread/pr-action", () => HttpResponse.json({ ok: false, error: reason }, { status: 400 })));
  renderActions([failing()]);
  const button = screen.getByRole("button", { name: "Fix CI Failing" });
  await userEvent.click(button);
  expect(await screen.findByTestId("status")).toHaveTextContent(`${reason} / Fix CI · Failing`);
  expect(button).toHaveTextContent(/^Fix CI$/);
  expect(button).toBeEnabled();
});

it("opens a pushed branch's pull request, and its row opens the thread since there is no diff to show", async () => {
  const posted: unknown[] = [];
  server.use(http.post("/api/org/thread/pr-create", async ({ request }) => {
    posted.push(await request.json());
    return HttpResponse.json({ ok: true, created: { id: "E", pr: "https://github.com/acme/hub/pull/43" } });
  }));
  const onOpenPr = vi.fn();
  const onOpenNode = vi.fn();
  const onChanged = vi.fn();
  renderActions([thread("E", "Pushed", undefined, { prAction: "create-pr", branch: "acme/pushed" })], { onOpenPr, onOpenNode, onChanged });
  await userEvent.click(screen.getByRole("button", { name: /^Pushed/ }));
  expect(onOpenPr).not.toHaveBeenCalled();
  expect(onOpenNode).toHaveBeenCalledWith("E");

  await userEvent.click(screen.getByRole("button", { name: "Create PR Pushed" }));
  expect(await screen.findByTestId("status")).toHaveTextContent("Opened PR #43 for Pushed");
  expect(posted).toEqual([{ project: "hub", id: "E" }]);
  expect(onChanged).toHaveBeenCalled();
});
