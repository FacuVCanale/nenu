import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import type { OrgStatus } from "@/lib/api";
import type { AgentView, OrgTask, PaneDiff, ProjectThreadView, ProjectView } from "@/lib/types";
import { server } from "@/test/setup";
import { ProjectPanel, type ProjectSection } from "./project-panel";

const thread = (id: string, title: string, extra: Partial<ProjectThreadView> = {}): ProjectThreadView =>
  ({ id, title, parentId: "root", role: "worker", status: "open", updated: "2026-10-10T13:50:00Z", ...extra });

const threads: ProjectThreadView[] = [
  thread("t-0011", "Payments webhook", { group: "waiting-on-you" }),
  thread("t-0013", "Cart badge", { group: "ready-for-review", pr: { number: 41, state: "open", review: "approved", checks: { passed: 6, failed: 0, pending: 0 }, mergeBlocker: null, diff: { additions: 64, deletions: 12 } } }),
  thread("t-0012", "Checkout flow", { group: "working", paneId: "w1:flow", liveStatus: "working", branch: "acme-t-0012",
    pr: { number: 42, state: "open", review: "review_required", checks: { passed: 4, failed: 0, pending: 2 }, mergeBlocker: "checks pending", diff: { additions: 44, deletions: 16 } } }),
  thread("t-0001", "Search index", { status: "resolved", group: "resolved", pr: { number: 30, state: "merged" } }),
];
const project: ProjectView = {
  slug: "acme", name: "Acme Shop", goal: "Storefront, checkout and the admin panel", status: "active", prActions: true,
  coordinator: { paneId: "w1:coord", agent: "claude", liveStatus: "idle" }, threads,
};
const panes = [
  { paneId: "w1:coord", agent: "claude", status: "idle" },
  { paneId: "w1:flow", agent: "claude", status: "working" },
] as unknown as AgentView[];

const owner = (kind: OrgTask["owner"]["kind"], profile = "", name = "") => ({ kind, profile, machine: "", name });
const tasks: OrgTask[] = [
  { list: "Checkout", title: "Payments webhook", owner: owner("agent", "claude"), thread: "t-0011", description: "" },
  { list: "Checkout", title: "Cart badge", owner: owner("agent", "claude"), thread: "t-0013", description: "" },
  { list: "Checkout", title: "Checkout flow", owner: owner("agent", "claude"), thread: "t-0012", description: "" },
  { list: "Backlog", title: "Gift cards at checkout", owner: owner("unassigned"), thread: "", description: "Needs the payments webhook first.\nKeep cents." },
  { list: "Backlog", title: "Admin export to CSV", owner: owner("me"), thread: "", description: "" },
  { list: "Backlog", title: "Coupon codes", owner: owner("person", "", "Dana"), thread: "", description: "" },
  { list: "Done", title: "Search index", owner: owner("agent", "codex"), thread: "t-0001", description: "" },
];

// What `project status` says of the same project: a task per TASKS.md line, then the threads no task names.
const item = (id: string, title: string, state: OrgStatus["items"][number]["state"], extra: Partial<OrgStatus["items"][number]> = {}): OrgStatus["items"][number] =>
  ({ kind: "task", id, title, state, owner: owner("agent", "claude"), thread: "", ...extra });
const status: OrgStatus = {
  items: [
    item("task:3", "Payments webhook", "waiting", { thread: "t-0011" }),
    item("task:4", "Cart badge", "review", { thread: "t-0013" }),
    item("task:5", "Checkout flow", "working", { thread: "t-0012" }),
    item("task:8", "Gift cards at checkout", "todo", { owner: owner("unassigned") }),
    item("task:11", "Admin export to CSV", "todo", { owner: owner("me") }),
    item("task:12", "Refund flow", "todo", { owner: owner("person", "", "blocked on design") }),
    item("task:15", "Search index", "done", { owner: owner("agent", "codex"), thread: "t-0001" }),
    item("task:16", "Product images on the CDN", "done", { owner: owner("unassigned") }),
    { kind: "thread", id: "t-0015", title: "Order confirmation email", state: "landing", owner: null, thread: "t-0015" },
    { kind: "thread", id: "t-0014", title: "Login hotfix", state: "idle", owner: null, thread: "t-0014" },
  ],
  problems: [
    { rule: "handoff-over-limit", line: 0, task: "", thread: "", detail: "9412 characters, this digest shows the first 8000" },
    { rule: "status-in-owner", line: 12, task: "Refund flow", thread: "", detail: "the owner \"blocked on design\" is status text" },
    { rule: "done-not-deleted", line: 16, task: "Product images on the CDN", thread: "", detail: "checked done but still listed" },
  ],
};

const diff: PaneDiff = {
  ok: true, base: "main", head: "acme-t-0012", source: "worktree", totals: { files: 1, additions: 3, deletions: 1 },
  files: [{ path: "app/cart.ts", status: "modified", additions: 3, deletions: 1, hunks: [{ header: "@@ -1 +1 @@", oldStart: 1, newStart: 1, lines: ["-a", "+b"] }] }],
};

let reads: string[] = [];
let sent: Array<{ pane: string; text: string }> = [];
let taskList: OrgTask[] | null = tasks;
/** `project status`: null is an Organizations without the command, a string a run that failed. */
let projectStatus: OrgStatus | null | string = null;
let context: Record<string, unknown> = {};

beforeEach(() => {
  reads = [];
  sent = [];
  taskList = tasks;
  projectStatus = null;
  context = { ok: true, detail: null, routines: null };
  server.use(
    http.get("/api/org/status", ({ request }) => {
      reads.push(`status?${new URL(request.url).searchParams}`);
      return typeof projectStatus === "string"
        ? HttpResponse.json({ ok: false, error: projectStatus }, { status: 502 })
        : HttpResponse.json({ ok: true, status: projectStatus });
    }),
    http.get("/api/org/tasks", ({ request }) => {
      reads.push(`tasks?${new URL(request.url).searchParams}`);
      return HttpResponse.json({ ok: true, tasks: taskList });
    }),
    http.get("/api/org/context", ({ request }) => {
      reads.push(`context?${new URL(request.url).searchParams}`);
      return HttpResponse.json(context);
    }),
    http.get("/api/pane/:id/diff", ({ params, request }) => {
      reads.push(`diff ${String(params.id)}?${new URL(request.url).searchParams}`);
      return HttpResponse.json(diff);
    }),
    http.get("/api/pane/:id/activity", ({ params }) => {
      reads.push(`activity ${String(params.id)}`);
      return HttpResponse.json({ available: true, sessionKey: "k", workflows: [], tasks: [], artifacts: [], truncated: false });
    }),
    http.post("/api/pane/:id/send", async ({ params, request }) => {
      const body = await request.json() as { text: string; requestId: string };
      sent.push({ pane: String(params.id), text: body.text });
      return HttpResponse.json({ ok: true, requestId: body.requestId, ack: "submitted" });
    }),
  );
});

function Panel({ initial = "notes", readOnly = false, onOpenPane = vi.fn(), view = project }: { initial?: ProjectSection; readOnly?: boolean; onOpenPane?: (id: string) => void; view?: ProjectView }) {
  const [section, setSection] = useState<ProjectSection>(initial);
  return <ProjectPanel project={view} threads={view.threads} panes={panes} currentPaneId="w1:coord" readOnly={readOnly} activityPaneId="w1:coord"
    section={section} onSection={setSection} onOpenPane={onOpenPane} onOpenNode={vi.fn()} onChanged={vi.fn()} now={Date.parse("2026-10-10T14:00:00Z")} />;
}

const group = (name: string) => screen.getByRole("region", { name });
const titles = (region: HTMLElement) => within(region).getAllByRole("listitem").map((item) => item.querySelector("[data-task-title]")?.textContent);

it("names the project and offers Notes, Agents, PRs and Context, with counts where they help", () => {
  render(<Panel />);
  expect(screen.getByRole("heading", { name: "Acme Shop" })).toBeInTheDocument();
  const tabs = within(screen.getByRole("tablist", { name: "Project sections" })).getAllByRole("tab").map((tab) => tab.textContent);
  expect(tabs).toEqual(["Notes", "Agents3", "PRs2", "Context"]);
});

it("Notes is the project's status by state, one quiet row per item, read only while it is on screen", async () => {
  projectStatus = status;
  const onOpenPane = vi.fn();
  render(<Panel onOpenPane={onOpenPane} />);
  await screen.findByRole("region", { name: "Needs you" });
  expect(reads).toEqual(["status?project=acme"]);
  expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label")))
    .toEqual(["Needs you", "Working", "Ready for review", "Landing", "Idle", "To do"]);
  expect(titles(group("Needs you"))).toEqual(["Payments webhook"]);
  expect(titles(group("Working"))).toEqual(["Checkout flow"]);
  expect(titles(group("Ready for review"))).toEqual(["Cart badge"]);
  expect(titles(group("Landing"))).toEqual(["Order confirmation email"]);
  expect(titles(group("Idle"))).toEqual(["Login hotfix"]);
  expect(titles(group("To do"))).toEqual(["Gift cards at checkout", "Admin export to CSV", "Refund flow"]);
  // The name, then in the same line what it is doing and whose it is.
  expect(within(group("Ready for review")).getByRole("button", { name: "Cart badge PR #41 · approved · checks passed · claude" })).toBeInTheDocument();
  expect(within(group("To do")).getByRole("button", { name: "Admin export to CSV you" })).toBeInTheDocument();
  // A row opens its thread, as it did.
  await userEvent.click(within(group("Working")).getByRole("button", { name: /^Checkout flow/ }));
  expect(onOpenPane).toHaveBeenCalledWith("w1:flow");
  // Done is history, checked off and folded until asked for: Organizations knows a checked task is done.
  expect(screen.queryByText("Product images on the CDN")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Done · 2" }));
  const done = screen.getByRole("list", { name: "Done" });
  expect(titles(done)).toEqual(["Search index", "Product images on the CDN"]);
  expect(within(done).getByText("PR #30 merged · codex")).toBeInTheDocument();
  expect(within(done).queryByRole("button", { name: /^Mark done/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/newer Herdr Organizations/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: "Context" }));
  await waitFor(() => expect(reads).toEqual(["status?project=acme", "context?project=acme"]));
});

it("a line above Notes counts its problems and opens them", async () => {
  projectStatus = status;
  render(<Panel />);
  const line = await screen.findByRole("button", { name: "3 problems" });
  expect(line).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("checked done but still listed")).not.toBeInTheDocument();
  await userEvent.click(line);
  const problems = screen.getByRole("list", { name: "Problems" });
  expect(within(problems).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
    "HANDOFF.md9412 characters, this digest shows the first 8000",
    "Refund flowthe owner \"blocked on design\" is status text",
    "Product images on the CDNchecked done but still listed",
  ]);
  await userEvent.click(line);
  expect(screen.queryByRole("list", { name: "Problems" })).not.toBeInTheDocument();
});

it("without problems or items, Notes says there is nothing to track yet", async () => {
  projectStatus = { items: [], problems: [] };
  render(<Panel />);
  expect(await screen.findByText("Nothing to track yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /problems?$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

it("marking a task from the project's status asks the coordinator the same way", async () => {
  projectStatus = status;
  render(<Panel />);
  await screen.findByRole("region", { name: "To do" });
  expect(screen.queryByRole("button", { name: "Mark done: Login hotfix" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Mark done: Refund flow" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ask the coordinator" }));
  await waitFor(() => expect(sent).toEqual([{ pane: "w1:coord", text: 'Please mark as done the task "Refund flow" in TASKS.md. (Sent from Nenu.)' }]));
  expect(await screen.findByText("Asked the coordinator")).toBeInTheDocument();
});

it("when `project status` fails, Notes shows the task list and says why", async () => {
  projectStatus = "herdr-organizations failed (1): no project `acme`";
  render(<Panel />);
  await screen.findByRole("region", { name: "Not started" });
  expect(reads).toEqual(["status?project=acme", "tasks?project=acme"]);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not read the project's status: herdr-organizations failed (1): no project `acme`");
});

it("without `project status`, Notes is the coordinator's task list by state, read only while it is on screen", async () => {
  render(<Panel />);
  await screen.findByRole("region", { name: "Needs you" });
  expect(reads).toEqual(["status?project=acme", "tasks?project=acme"]);
  expect(titles(group("Needs you"))).toEqual(["Payments webhook"]);
  expect(titles(group("Ready to merge"))).toEqual(["Cart badge"]);
  expect(titles(group("In progress"))).toEqual(["Checkout flow"]);
  expect(titles(group("Not started"))).toEqual(["Gift cards at checkout", "Admin export to CSV", "Coupon codes"]);
  const notStarted = group("Not started");
  expect(within(notStarted).getByText("Needs the payments webhook first.")).toBeInTheDocument();
  expect(within(notStarted).getByText("you")).toBeInTheDocument();
  expect(within(notStarted).getByText("Dana")).toBeInTheDocument();
  // Done is history: folded until asked for.
  expect(screen.queryByText("Search index")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Done · 1" }));
  expect(screen.getByText("Search index")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("tab", { name: "Context" }));
  await waitFor(() => expect(reads).toEqual(["status?project=acme", "tasks?project=acme", "context?project=acme"]));
});

it("marking a task asks the coordinator through the guarded send, never the file", async () => {
  render(<Panel />);
  await screen.findByRole("region", { name: "Not started" });
  await userEvent.click(screen.getByRole("button", { name: "Mark done: Admin export to CSV" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Ask the coordinator" }));
  await waitFor(() => expect(sent).toEqual([{ pane: "w1:coord", text: 'Please mark as done the task "Admin export to CSV" in TASKS.md. (Sent from Nenu.)' }]));
  expect(await screen.findByText("Asked the coordinator")).toBeInTheDocument();
});

it("cannot mark a task without a running coordinator, or from a read-only device", async () => {
  const { unmount } = render(<Panel view={{ ...project, coordinator: undefined }} />);
  await screen.findByRole("region", { name: "Not started" });
  expect(screen.getByRole("button", { name: "Mark done: Admin export to CSV" })).toBeDisabled();
  unmount();
  render(<Panel readOnly />);
  await screen.findByRole("region", { name: "Not started" });
  expect(screen.getByRole("button", { name: "Mark done: Admin export to CSV" })).toBeDisabled();
});

it("without `task list`, Notes shows the threads by state and says where the list comes from, with no error", async () => {
  taskList = null;
  render(<Panel />);
  await screen.findByRole("region", { name: "Needs you" });
  expect(titles(group("Needs you"))).toEqual(["Payments webhook"]);
  expect(titles(group("Ready to merge"))).toEqual(["Cart badge"]);
  expect(titles(group("In progress"))).toEqual(["Checkout flow"]);
  expect(screen.queryByRole("region", { name: "Not started" })).not.toBeInTheDocument();
  expect(screen.getByText(/the coordinator's task list appears here with a newer Herdr Organizations/)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Mark done/ })).not.toBeInTheDocument();
});

it("PRs groups ready to merge and in flight; a PR opens its diff in the panel, its thread is a second action", async () => {
  const onOpenPane = vi.fn();
  render(<Panel initial="prs" onOpenPane={onOpenPane} />);
  expect(titles(group("Ready to merge"))).toEqual(["Cart badge"]);
  expect(titles(group("In flight"))).toEqual(["Checkout flow"]);
  expect(screen.getByRole("button", { name: "Merge Cart badge" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /^Checkout flow/ }));
  expect(onOpenPane).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: /app\/cart\.ts/ })).toBeInTheDocument();
  expect(reads).toEqual(["diff w1:flow?pr=42"]);
  await userEvent.click(screen.getByRole("button", { name: "Open thread" }));
  expect(onOpenPane).toHaveBeenCalledWith("w1:flow");

  await userEvent.click(screen.getByRole("button", { name: "Back to pull requests" }));
  await userEvent.click(screen.getByRole("button", { name: "Open thread: Checkout flow" }));
  expect(onOpenPane).toHaveBeenCalledTimes(2);
});

it("Context shows what every thread receives, its repos, routines and agents", async () => {
  context = {
    ok: true,
    detail: {
      instructions: "Run the cart tests before review.\n", memory: "# Memory\nStay fast.\n", memoryFiles: [{ name: "payments.md", text: "Retries back off.\n" }],
      repos: [{ path: "/srv/acme/shop", machine: "" }, { path: "/srv/acme/admin", machine: "build-box" }],
      coordinatorProfile: "claude", threadProfile: "codex", maxParallelThreads: 10,
    },
    routines: [{ name: "nightly-deps", trigger: "schedule", schedule: "daily 03:00", events: [], enabled: true, nextRun: "" },
      { name: "pr-followup", trigger: "pr", schedule: "", events: ["opened"], enabled: false, nextRun: "" }],
  };
  render(<Panel initial="context" />);
  expect(screen.getByText("Storefront, checkout and the admin panel")).toBeInTheDocument();
  await screen.findByRole("region", { name: "Every thread receives" });
  const shared = group("Every thread receives");
  expect(within(shared).getByRole("button", { name: /PROJECT\.md/ })).toBeInTheDocument();
  expect(within(shared).getByRole("button", { name: /MEMORY\.md/ })).toBeInTheDocument();
  await userEvent.click(within(shared).getByRole("button", { name: /memory\/payments\.md/ }));
  expect(within(shared).getByText("Retries back off.")).toBeInTheDocument();
  expect(within(group("Repositories")).getByText("/srv/acme/admin")).toBeInTheDocument();
  expect(within(group("Repositories")).getByText("build-box")).toBeInTheDocument();
  expect(within(group("Routines")).getByText("daily 03:00 · on")).toBeInTheDocument();
  expect(within(group("Routines")).getByText("pull requests · off")).toBeInTheDocument();
  expect(within(group("Agents")).getByText("Coordinator · claude")).toBeInTheDocument();
  expect(within(group("Agents")).getByText("Max 10 in parallel")).toBeInTheDocument();
});

it("without `project show`, Context says so quietly and keeps the goal and the branches", async () => {
  render(<Panel initial="context" />);
  await screen.findByText(/Memory and instructions appear here with a newer Herdr Organizations/);
  expect(screen.getByText("Storefront, checkout and the admin panel")).toBeInTheDocument();
  expect(within(group("Branches")).getByText("acme-t-0012")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("Agents lists the coordinator and its threads; its background work loads only when opened", async () => {
  render(<Panel initial="agents" />);
  expect(screen.getAllByText("Coordinator").length).toBeGreaterThan(0);
  expect(screen.getByText("Checkout flow")).toBeInTheDocument();
  expect(reads).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: /^Background work/ }));
  await waitFor(() => expect(reads).toEqual(["activity w1:coord"]));
});
