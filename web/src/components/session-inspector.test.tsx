import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it } from "vitest";

import type { PaneDiff } from "@/lib/types";
import { server } from "@/test/setup";
import { InspectorToggle, panelLink, SessionInspector, useSessionInspector, type SessionPr } from "./session-inspector";
// Loaded up front, as a desk has it cached: the lazy import then resolves at once.
import "./inspector-panels";

const branch: PaneDiff = {
  ok: true, base: "main", head: "feat/checkout", source: "worktree",
  totals: { files: 2, additions: 3, deletions: 1 },
  files: [
    { path: "app/cart.ts", status: "modified", additions: 3, deletions: 1, hunks: [
      { header: "@@ -1,3 +1,5 @@", oldStart: 1, newStart: 1, lines: [" a", "-b", "+bee", "+c", "+d"] },
    ] },
    { path: "notes.txt", status: "added", additions: 0, deletions: 0, omitted: "untracked" },
  ],
};
const uncommitted: PaneDiff = { ...branch, source: "uncommitted", base: "feat/checkout", totals: { files: 1, additions: 0, deletions: 0 }, files: [branch.files[1]!] };

let seen: string[] = [];
const desk = window.matchMedia;
function deskWidth(on: boolean) {
  window.matchMedia = ((query: string) => ({ matches: on && query === "(min-width: 1024px)", media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

beforeEach(() => {
  seen = [];
  deskWidth(true);
  server.use(
    http.get("/api/pane/:id/diff", ({ request }) => {
      const scope = new URL(request.url).searchParams.get("scope");
      seen.push(`diff?scope=${scope}`);
      return HttpResponse.json(scope === "uncommitted" ? uncommitted : branch);
    }),
    http.get("/api/pane/:id/files", ({ request }) => {
      seen.push(`files?${new URL(request.url).searchParams.toString()}`);
      return HttpResponse.json({ path: ".", files: [{ name: "app", path: "app", kind: "directory", size: 0, updatedAt: "" }], truncated: false });
    }),
    http.get("/api/pane/:id/history", () => {
      seen.push("history");
      return HttpResponse.json({ available: true, entries: [], total: 0, hasMore: false, fileTruncated: false });
    }),
    http.get("/api/pane/:id/activity", () => {
      seen.push("activity");
      return HttpResponse.json({ available: false });
    }),
  );
});
afterEach(() => {
  window.matchMedia = desk;
});

function Desk({ pr, project, artifacts = true }: { pr?: SessionPr; project?: React.ReactNode; artifacts?: boolean }) {
  const inspector = useSessionInspector();
  if (!inspector.desk) return <p>phone</p>;
  return <>
    {!inspector.open && <InspectorToggle inspector={inspector} pr={pr} />}
    {inspector.open && <SessionInspector inspector={inspector} paneId="w1:p1" artifacts={artifacts} pr={pr} project={project} />}
  </>;
}
const panel = () => screen.getByRole("complementary", { name: "Session panel" });

it("reads only the tab on screen: Changes first, Files and Artifacts when picked", async () => {
  render(<Desk />);
  // The panel is a chunk of its own; React resolves it once, on the first render.
  await screen.findByRole("complementary", { name: "Session panel" });
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
  expect(seen).toEqual(["diff?scope=branch"]);

  await userEvent.click(within(panel()).getByRole("tab", { name: /Files/ }));
  await within(panel()).findByText("app");
  expect(seen).toEqual(["diff?scope=branch", "files?path=."]);

  await userEvent.click(within(panel()).getByRole("tab", { name: /Artifacts/ }));
  await within(panel()).findByText("No artifacts in this conversation");
  expect(seen.slice(2).sort()).toEqual(["activity", "history"]);
});

it("shows a session's changes without a pull request, Branch or Uncommitted", async () => {
  render(<Desk />);
  expect(await within(panel()).findByText(/This session's worktree on/)).toBeInTheDocument();
  expect(within(panel()).queryByRole("link", { name: /Open on GitHub/ })).not.toBeInTheDocument();
  expect(within(panel()).getByText("Untracked, not in git yet")).toBeInTheDocument();

  const scope = within(panel()).getByRole("radiogroup", { name: "Diff scope" });
  expect(within(scope).getByRole("radio", { name: "Branch" })).toHaveAttribute("aria-checked", "true");
  await userEvent.click(within(scope).getByRole("radio", { name: "Uncommitted" }));
  expect(await within(panel()).findByText(/What is not committed on/)).toBeInTheDocument();
  expect(seen).toEqual(["diff?scope=branch", "diff?scope=uncommitted"]);

  // The file opens in place, its lines as text.
  await userEvent.click(within(scope).getByRole("radio", { name: "Branch" }));
  await userEvent.click(await within(panel()).findByRole("button", { name: /app\/cart\.ts/ }));
  expect(within(panel()).getByText("bee")).toBeInTheDocument();
});

it("leads Changes with the pull request: number, branches, checks, review and GitHub", async () => {
  const pr: SessionPr = { number: 42, title: "Checkout flow", url: "https://github.com/acme/shop/pull/42", head: "feat/checkout", base: "main",
    review: "review_required", checks: { passed: 6, failed: 0, pending: 0 }, diff: { additions: 44, deletions: 16 } };
  render(<Desk pr={pr} />);
  const summary = await within(panel()).findByRole("region", { name: "Pull request #42" });
  expect(within(summary).getByText("Checkout flow")).toBeInTheDocument();
  expect(within(summary).getByText("feat/checkout → main")).toBeInTheDocument();
  expect(within(summary).getByText("CI 6/6")).toBeInTheDocument();
  expect(within(summary).getByText("Review required")).toBeInTheDocument();
  expect(within(summary).getByRole("link", { name: /Open on GitHub/ })).toHaveAttribute("href", pr.url);
});

it("folds with ⌘⌥B or its button, and a desk remembers it and the width", async () => {
  const { unmount } = render(<Desk pr={{ number: 42, title: "Checkout flow", diff: { additions: 44, deletions: 16 } }} />);
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
  // Typing in a field, the shortcut folds the panel and leaves the cursor there.
  const field = document.body.appendChild(document.createElement("textarea"));
  field.focus();
  fireEvent.keyDown(field, { key: "∫", code: "KeyB", metaKey: true, altKey: true });
  expect(screen.queryByRole("complementary", { name: "Session panel" })).not.toBeInTheDocument();
  expect(field).toHaveFocus();
  field.remove();
  const toggle = screen.getByRole("button", { name: "Show session panel" });
  expect(toggle).toHaveTextContent("+44 −16");

  await userEvent.click(toggle);
  const separator = within(panel()).getByRole("separator", { name: "Resize session panel" });
  expect(separator).toHaveAttribute("aria-valuenow", "460");
  fireEvent.keyDown(separator, { key: "ArrowLeft" });
  expect(separator).toHaveAttribute("aria-valuenow", "476");
  await userEvent.click(within(panel()).getByRole("button", { name: "Hide session panel" }));
  expect(screen.getByRole("button", { name: "Show session panel" })).toHaveFocus();
  unmount();

  render(<Desk />);
  expect(screen.queryByRole("complementary", { name: "Session panel" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Show session panel" }));
  expect(within(panel()).getByRole("separator", { name: "Resize session panel" })).toHaveAttribute("aria-valuenow", "476");
});

it("still opens and folds when the browser refuses storage", async () => {
  const original = Storage.prototype.getItem;
  const set = Storage.prototype.setItem;
  Storage.prototype.getItem = () => { throw new Error("blocked"); };
  Storage.prototype.setItem = () => { throw new Error("blocked"); };
  try {
    render(<Desk />);
    expect(panel()).toBeInTheDocument();
    await userEvent.click(within(panel()).getByRole("button", { name: "Hide session panel" }));
    expect(screen.getByRole("button", { name: "Show session panel" })).toBeInTheDocument();
  } finally {
    Storage.prototype.getItem = original;
    Storage.prototype.setItem = set;
  }
});

it("keeps the project one click away behind ⋯ Project, and a tab brings the session back", async () => {
  render(<Desk project={<p>Threads list</p>} />);
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
  const more = within(panel()).getByRole("button", { name: "Project: Threads, PRs, Activity, Memory" });
  await userEvent.click(more);
  expect(more).toHaveAttribute("aria-pressed", "true");
  expect(within(panel()).getByText("Threads list")).toBeInTheDocument();
  expect(within(panel()).getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "false");

  await userEvent.click(within(panel()).getByRole("tab", { name: /Changes/ }));
  expect(within(panel()).queryByText("Threads list")).not.toBeInTheDocument();
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
});

it("offers no ⋯ Project outside a project, and no Artifacts for a shell", async () => {
  render(<Desk artifacts={false} />);
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
  expect(within(panel()).queryByRole("button", { name: /^Project/ })).not.toBeInTheDocument();
  expect(within(panel()).queryByRole("tab", { name: /Artifacts/ })).not.toBeInTheDocument();
});

it("has no panel and no shortcut on a phone", async () => {
  deskWidth(false);
  render(<Desk />);
  expect(screen.getByText("phone")).toBeInTheDocument();
  act(() => { fireEvent.keyDown(window, { key: "∫", code: "KeyB", metaKey: true, altKey: true }); });
  await waitFor(() => expect(seen).toEqual([]));
});

/** A desk whose chat reads the panel's link the way agent-chat.tsx does. */
function LinkedDesk({ project, keep }: { project?: React.ReactNode; keep?: () => boolean }) {
  const inspector = useSessionInspector();
  const link = panelLink(inspector);
  if (keep) link.leaving.current = keep;
  return <>
    <p data-testid="slots">{link.terminal ? `mirror:${link.terminal.mirror.isConnected} controls:${link.terminal.controls.isConnected}` : "none"}</p>
    <button type="button" onClick={link.showTerminal}>Show terminal</button>
    {!inspector.open && <InspectorToggle inspector={inspector} />}
    {inspector.open && <SessionInspector inspector={inspector} paneId="w1:p1" artifacts project={project} />}
  </>;
}

it("adds Terminal after Artifacts, and lends its places to the chat only while it is on screen", async () => {
  render(<LinkedDesk />);
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
  expect(within(panel()).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Changes", "Files", "Artifacts", "Terminal"]);
  expect(screen.getByTestId("slots")).toHaveTextContent("none");

  await userEvent.click(within(panel()).getByRole("tab", { name: /Terminal/ }));
  expect(screen.getByTestId("slots")).toHaveTextContent("mirror:true controls:true");
  // A tab of its own reads nothing: the chat draws the mirror and the controls into it.
  expect(seen).toEqual(["diff?scope=branch"]);

  await userEvent.click(within(panel()).getByRole("button", { name: "Hide session panel" }));
  expect(screen.getByTestId("slots")).toHaveTextContent("none");
  await userEvent.click(screen.getByRole("button", { name: "Show terminal" }));
  expect(within(panel()).getByRole("tab", { name: /Terminal/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("slots")).toHaveTextContent("mirror:true controls:true");
});

it("asks the chat before Terminal leaves the screen: another tab, ⋯ Project, its button or ⌘⌥B", async () => {
  let keep = true;
  render(<LinkedDesk project={<p>Threads list</p>} keep={() => !keep} />);
  await within(panel()).findByRole("button", { name: /app\/cart\.ts/ });
  await userEvent.click(within(panel()).getByRole("tab", { name: /Terminal/ }));
  const terminal = () => within(panel()).getByRole("tab", { name: /Terminal/ });

  keep = true;
  await userEvent.click(within(panel()).getByRole("tab", { name: /Changes/ }));
  await userEvent.click(within(panel()).getByRole("button", { name: /^Project/ }));
  await userEvent.click(within(panel()).getByRole("button", { name: "Hide session panel" }));
  act(() => { fireEvent.keyDown(window, { key: "∫", code: "KeyB", metaKey: true, altKey: true }); });
  expect(terminal()).toHaveAttribute("aria-selected", "true");

  keep = false;
  await userEvent.click(within(panel()).getByRole("tab", { name: /Changes/ }));
  expect(within(panel()).getByRole("tab", { name: /Changes/ })).toHaveAttribute("aria-selected", "true");
});
