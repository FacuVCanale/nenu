import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { ProjectThreadView, ProjectView } from "@/lib/types";
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
