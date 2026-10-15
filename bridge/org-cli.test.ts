import { describe, expect, it } from "bun:test";

import {
  createProject,
  listProfiles,
  listRoutines,
  listTemplates,
  mergeThread,
  openProject,
  OrgCliError,
  orgEnv,
  OrgValidationError,
  prAction,
  prCreate,
  readOverview,
  readProjectDetail,
  readRoutines,
  readTasks,
  replaceCoordinator,
  resolveNode,
  setThreadFlags,
  startNode,
  type OrgRun,
} from "./org-cli.ts";

const templateRecord = {
  name: "review-worker",
  scope: "project",
  project: "nenu",
  description: "Review a change",
  role: "worker",
  can_spawn: true,
  harness: "claude",
  model: "sonnet",
  reasoning_effort: "high",
  permission_profile: "write",
  rules_chars: 40,
  memory_chars: 15,
  updated: "2026-09-30T10:00:00Z",
  dir: "/private/templates/review-worker",
};
const globalTemplateRecord = { ...templateRecord, name: "shared-review", scope: "global", project: null };

function fakeRun(result: { code: number; stdout: string; stderr: string }) {
  const calls: Array<{ argv: string[]; opts: Parameters<OrgRun>[1] }> = [];
  const run: OrgRun = async (argv, opts) => {
    calls.push({ argv, opts });
    return result;
  };
  return { run, calls };
}

describe("herdr-organizations CLI adapter", () => {
  it("lists valid templates with exact argv and drops invalid records", async () => {
    const { run, calls } = fakeRun({
      code: 0,
      stdout: JSON.stringify([templateRecord, globalTemplateRecord, { ...templateRecord, can_spawn: "yes" }]),
      stderr: "",
    });

    expect(await listTemplates(run, "nenu")).toEqual([{
      name: "review-worker",
      scope: "project",
      description: "Review a change",
      role: "worker",
      canSpawn: true,
      harness: "claude",
      model: "sonnet",
      reasoningEffort: "high",
      rulesChars: 40,
      memoryChars: 15,
      updated: "2026-09-30T10:00:00Z",
    }, {
      name: "shared-review",
      scope: "global",
      description: "Review a change",
      role: "worker",
      canSpawn: true,
      harness: "claude",
      model: "sonnet",
      reasoningEffort: "high",
      rulesChars: 40,
      memoryChars: 15,
      updated: "2026-09-30T10:00:00Z",
    }]);
    expect(calls).toEqual([{
      argv: ["template", "list", "--project", "nenu", "--json"],
      opts: { timeoutMs: 10_000 },
    }]);
  });

  it("returns an empty list when the installed CLI does not know templates", async () => {
    const { run, calls } = fakeRun({ code: 2, stdout: "", stderr: "unrecognized subcommand: template" });

    expect(await listTemplates(run, "nenu")).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("starts a template with the task on stdin and the Herdr socket in the environment", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ id: "t-1234", parent_id: "root", role: "worker" }), stderr: "" });
    const task = "Review the accessibility changes.";

    expect(await startNode(run, "/tmp/herdr.sock", {
      project: "nenu", template: "review-worker", title: "Review accessibility", parent: "root", task,
    }, () => false)).toEqual({ id: "t-1234", project: "nenu", title: "Review accessibility", parent: "root", role: "worker", profile: "", template: "review-worker" });
    expect(calls).toEqual([{
      argv: ["node", "start", "nenu", "--template=review-worker", "--parent=root", "--title=Review accessibility", "--task-file", "-"],
      opts: { stdin: task, env: { HERDR_SOCKET_PATH: "/tmp/herdr.sock" }, timeoutMs: 30_000 },
    }]);
  });

  it("starts a coordinator under another coordinator with the profile it names", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ id: "t-0042", parent_id: "t-0010", role: "coordinator", profile: "codex" }), stderr: "" });

    expect(await startNode(run, "/tmp/herdr.sock", {
      project: "acme", title: "-Billing", parent: "t-0010", task: "Coordinate billing.", role: "coordinator", profile: "codex",
    }, () => false)).toMatchObject({ id: "t-0042", role: "coordinator", parent: "t-0010", profile: "codex" });
    expect(calls[0]!.argv).toEqual(["node", "start", "acme", "--role=coordinator", "--parent=t-0010", "--title=-Billing", "--profile=codex", "--task-file", "-"]);
  });

  it("starts a top-level thread through upstream herdr-projects and refuses what it cannot do", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ id: "t-0007", kind: "tab", profile: "", agent: "claude", branch: "", pane_id: "w1:p3" }), stderr: "" });
    const thread = { project: "acme", title: "Hotfix", parent: "root", task: "Fix the login." };

    expect(await startNode(run, "/tmp/herdr.sock", thread, () => true)).toMatchObject({ id: "t-0007", role: "worker", parent: "root" });
    expect(calls[0]!.argv).toEqual(["thread", "start", "acme", "--title=Hotfix", "--task-file", "-"]);
    for (const refused of [{ role: "coordinator" }, { parent: "t-0001" }, { template: "review-worker" }]) {
      await expect(startNode(run, "/tmp/herdr.sock", { ...thread, ...refused }, () => true)).rejects.toThrow("need Herdr Organizations");
    }
    expect(calls).toHaveLength(1);
  });

  it("lists the profile names and none when the CLI cannot say", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: "claude\ncodex\n-bad\nsonnet.fast\n", stderr: "" });
    expect(await listProfiles(run)).toEqual(["claude", "codex", "sonnet.fast"]);
    expect(calls[0]).toEqual({ argv: ["profile", "list", "--names"], opts: { timeoutMs: 10_000 } });
    expect(await listProfiles(fakeRun({ code: 2, stdout: "", stderr: "unrecognized subcommand 'profile'" }).run)).toEqual([]);
  });

  it("opens a project's coordinator in the bridge's Herdr session", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: "started codex as hp-acme", stderr: "" });

    expect(await openProject(run, "/tmp/herdr.sock", { project: "acme" })).toEqual({ message: "started codex as hp-acme" });
    expect(calls).toEqual([{ argv: ["open", "acme"], opts: { env: { HERDR_SOCKET_PATH: "/tmp/herdr.sock" }, timeoutMs: 60_000 } }]);
    await expect(openProject(fakeRun({ code: 1, stdout: "", stderr: "error: `acme` is archived" }).run, "/s", { project: "acme" })).rejects.toThrow("is archived");
  });

  it("rejects invalid input before running the CLI", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: "[]", stderr: "" });
    const valid = { project: "nenu", title: "Review accessibility", parent: "root", task: "Review the change." };
    const start = (input: Record<string, unknown>) => startNode(run, "/tmp/herdr.sock", { ...valid, ...input }, () => false);

    await expect(listTemplates(run, "bad..slug")).rejects.toThrow("Project must use lowercase");
    await expect(listTemplates(run, "Uppercase")).rejects.toThrow("Project must use lowercase");
    await expect(start({ template: "Review" })).rejects.toThrow("Template must use lowercase");
    await expect(start({ title: "First line\nSecond line" })).rejects.toThrow("Title cannot contain line breaks");
    await expect(start({ task: "  " })).rejects.toThrow("Task is required");
    await expect(start({ role: "admin" })).rejects.toThrow("Role must be worker or coordinator");
    await expect(start({ profile: "--yolo" })).rejects.toThrow("Profile must be a profile name");
    await expect(start({ template: "review-worker", profile: "codex" })).rejects.toThrow("carries its own profile");
    await expect(start({ parent: "../t-1" })).rejects.toThrow("Node ID must look like t-1234");
    await expect(openProject(run, "/s", { project: "../acme" })).rejects.toThrow("Project must use lowercase");
    await expect(resolveNode(run, "/tmp/herdr.sock", { project: "nenu", id: "t-1" })).rejects.toThrow("Node ID must look like t-1234");
    expect(calls).toEqual([]);
  });

  it("resolves a node with the close-view flag", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: "", stderr: "" });

    await resolveNode(run, "/tmp/herdr.sock", { project: "nenu", id: "t-1234" }, () => false);

    expect(calls).toEqual([{
      argv: ["node", "resolve", "nenu", "t-1234", "--close-view"],
      opts: { env: { HERDR_SOCKET_PATH: "/tmp/herdr.sock" }, timeoutMs: 30_000 },
    }]);
  });

  it("replaces the project coordinator on the chosen profile and passes on what Organizations says", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: "stopped 1 coordinator agent(s) and started a new one on codex\n", stderr: "" });

    expect(await replaceCoordinator(run, "/tmp/herdr.sock", { project: "acme", profile: "codex" }))
      .toEqual({ message: "stopped 1 coordinator agent(s) and started a new one on codex" });
    expect(calls).toEqual([{
      argv: ["coordinator", "replace", "acme", "--profile=codex"],
      opts: { env: { HERDR_SOCKET_PATH: "/tmp/herdr.sock" }, timeoutMs: 60_000 },
    }]);
    await expect(replaceCoordinator(run, "/s", { project: "acme", profile: "" })).rejects.toThrow("Choose the agent the new coordinator runs on.");
    await expect(replaceCoordinator(run, "/s", { project: "acme", profile: "--yolo" })).rejects.toThrow("Profile must be a profile name");
    await expect(replaceCoordinator(run, "/s", { project: "../acme", profile: "codex" })).rejects.toThrow("Project must use lowercase");
    expect(calls).toHaveLength(1);
    await expect(replaceCoordinator(fakeRun({ code: 1, stdout: "", stderr: "error: no Herdr session to start the coordinator in" }).run, "/s", { project: "acme", profile: "codex" }))
      .rejects.toThrow("no Herdr session");
  });

  it("closes a thread through upstream herdr-projects, keeping its worktree", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: "", stderr: "" });

    await resolveNode(run, "/tmp/herdr.sock", { project: "acme", id: "t-0042" }, () => true);

    expect(calls.map((call) => call.argv)).toEqual([["thread", "resolve", "acme", "t-0042", "--keep-worktree"]]);
  });
});

const overviewThread = {
  id: "t-0002", title: "Fix CI", parent_id: "t-0001", role: "worker", can_spawn: false, status: "open",
  kind: "worktree", group: "ready-for-review", group_label: "Ready for review", rank: 1, note: "done",
  agent: "codex", branch: "hp/fix-ci", workspace_id: "w1", tab_id: "w1:t2", pane_id: "w1:p2",
  cwd: "/work/demo/wt", updated: "2026-10-10T00:00:00Z", has_report: true, report_unacked: true,
  auto_fix_ci: false, auto_merge: true,
  pr: {
    url: "https://github.com/acme/demo/pull/42", state: "OPEN", review: "APPROVED",
    checks: { passed: 5, pending: 0, failed: 1 }, additions: 120, deletions: 8, failing: ["lint"],
    comment_count: 2, draft: false, mergeable: "MERGEABLE", merge_blocker: "1 check(s) failed",
  },
};

describe("herdr-organizations --json contract", () => {
  it("reads overview with the bridge's projects root and keeps unknown fields out", async () => {
    const { run, calls } = fakeRun({
      code: 0,
      stdout: JSON.stringify({ schema_version: 1, projects: [{ slug: "demo", name: "Demo", goal: "", status: "active", dir: "/x", counts: {}, threads: [overviewThread] }] }),
      stderr: "",
    });

    const [project] = (await readOverview(run, "/root"))!;
    expect(calls).toEqual([{ argv: ["overview", "--json"], opts: { env: { HERDR_PROJECTS_ROOT: "/root" }, timeoutMs: 10_000 } }]);
    expect(project?.threads[0]).toMatchObject({ id: "t-0002", auto_merge: true, report_unacked: true, pr: { checks: { passed: 5, pending: 0, failed: 1 }, additions: 120, merge_blocker: "1 check(s) failed" } });
    expect(project?.threads[0]).not.toHaveProperty("kind");
  });

  it("treats a failing command, bad JSON or another schema version as no contract", async () => {
    for (const result of [
      { code: 2, stdout: "", stderr: "unexpected argument '--json'" },
      { code: 0, stdout: "not json", stderr: "" },
      { code: 0, stdout: JSON.stringify({ schema_version: 2, projects: [] }), stderr: "" },
    ]) {
      expect(await readOverview(fakeRun(result).run, "/root")).toBeUndefined();
    }
  });

  it("keeps an unread pull request's unknown numbers as null, never zero", async () => {
    const unread = { ...overviewThread, pr: { url: overviewThread.pr.url, state: "", review: "", checks: null, additions: null, deletions: null, failing: [], comment_count: null, draft: null, mergeable: null, merge_blocker: "the ticker has not read this pull request yet" } };
    const { run } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, projects: [{ slug: "demo", name: "Demo", goal: "", status: "active", threads: [unread] }] }), stderr: "" });

    const pr = (await readOverview(run, "/root"))![0]!.threads[0]!.pr!;
    expect(pr).toMatchObject({ checks: null, additions: null, deletions: null, comment_count: null });
  });
});

const routineRecord = {
  name: "nightly-deps", trigger: "schedule", schedule: "daily 03:00", events: [], enabled: true,
  command: "bun outdated", command_status: "approved", prompt: "Check the dependencies.",
  last_run: "2026-10-09T03:00:00Z", next_run: "2026-10-10T03:00:00Z", skipped_unhandled: 0, skipped_no_coordinator: 0,
};
const prRoutineRecord = {
  ...routineRecord, name: "pr-follow-up", trigger: "pr", schedule: "", events: ["checks-failed", "review"],
  command: "", command_status: "none", last_run: "", next_run: "",
};

describe("herdr-organizations routine list", () => {
  it("reads a project's routines with exact argv, keeping only what a list shows", async () => {
    const { run, calls } = fakeRun({
      code: 0,
      stdout: JSON.stringify({ schema_version: 1, project: "demo", routine_commands: true, routines: [routineRecord, prRoutineRecord], broken: [{ file: "routines/x.md", error: "bad" }] }),
      stderr: "",
    });

    expect(await listRoutines(run, "demo")).toEqual({
      available: true,
      broken: 1,
      routines: [
        { name: "nightly-deps", trigger: "schedule", schedule: "daily 03:00", events: [], enabled: true, lastRun: "2026-10-09T03:00:00Z", nextRun: "2026-10-10T03:00:00Z" },
        { name: "pr-follow-up", trigger: "pr", schedule: "", events: ["checks-failed", "review"], enabled: true, lastRun: "", nextRun: "" },
      ],
    });
    expect(calls).toEqual([{ argv: ["routine", "list", "demo", "--json"], opts: { timeoutMs: 10_000 } }]);
  });

  it("drops a malformed routine rather than showing a half-read one", async () => {
    const { run } = fakeRun({
      code: 0,
      stdout: JSON.stringify({ schema_version: 1, routines: [routineRecord, { ...routineRecord, trigger: "cron" }, { ...routineRecord, name: 3 }, { ...routineRecord, enabled: "yes" }], broken: [] }),
      stderr: "",
    });

    expect((await listRoutines(run, "demo")).routines.map((routine) => routine.name)).toEqual(["nightly-deps"]);
  });

  it("says it cannot list routines when the installed CLI has no routine list --json", async () => {
    for (const result of [
      { code: 2, stdout: "", stderr: "error: unexpected argument '--json' found" },
      { code: 2, stdout: "", stderr: "error: unrecognized subcommand 'routine'" },
      { code: 0, stdout: JSON.stringify({ schema_version: 2, routines: [] }), stderr: "" },
    ]) {
      expect(await listRoutines(fakeRun(result).run, "demo")).toEqual({ available: false, routines: [], broken: 0 });
    }
  });

  it("validates the slug before running anything and reports a real failure", async () => {
    const { run, calls } = fakeRun({ code: 1, stdout: "", stderr: "error: no project demo" });

    await expect(listRoutines(run, "../etc")).rejects.toThrow("Project must use lowercase");
    expect(calls).toHaveLength(0);
    await expect(listRoutines(run, "demo")).rejects.toThrow("herdr-organizations failed (1): error: no project demo");
  });
});

describe("herdr-organizations PR actions and project creation", () => {
  it("builds merge argv from validated values and checks the reply", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, id: "t-0002", pr: "https://github.com/acme/demo/pull/42", merged: true }), stderr: "" });

    expect(await mergeThread(run, { project: "demo", id: "t-0002" })).toEqual({ id: "t-0002", pr: "https://github.com/acme/demo/pull/42" });
    expect(calls[0]!.argv).toEqual(["thread", "merge", "demo", "t-0002", "--method=squash", "--json"]);
    await expect(mergeThread(run, { project: "demo", id: "t-0002", method: "--admin" })).rejects.toThrow("Merge method must be");
    expect(calls).toHaveLength(1);
  });

  it("passes Organizations' refusal through as the error", async () => {
    const { run } = fakeRun({ code: 1, stdout: "", stderr: "error: refusing to merge: 1 check(s) failed" });

    await expect(mergeThread(run, { project: "demo", id: "t-0002" })).rejects.toThrow("refusing to merge: 1 check(s) failed");
  });

  it("asks a thread about its PR with an action from the closed list, and says whether it was sent", async () => {
    const reply = (sent: boolean, reason = "") => ({ code: 0, stdout: JSON.stringify({ schema_version: 1, ok: true, id: "t-0002", action: "fix-ci", pr: "https://github.com/acme/demo/pull/42", sent, message: sent ? "Fix the failing check." : "", reason }), stderr: "" });
    const { run, calls } = fakeRun(reply(true));

    expect(await prAction(run, { project: "demo", id: "t-0002", action: "fix-ci" })).toEqual({ id: "t-0002", action: "fix-ci", pr: "https://github.com/acme/demo/pull/42", sent: true, reason: "" });
    expect(calls).toEqual([{ argv: ["thread", "pr-action", "demo", "t-0002", "fix-ci", "--json"], opts: { timeoutMs: 90_000 } }]);
    // Merge and Create PR have their own commands; nothing else, and no flag, reaches the argv.
    for (const action of ["merge", "create-pr", "--admin", "fix-ci --force", undefined, 1]) {
      await expect(prAction(run, { project: "demo", id: "t-0002", action })).rejects.toThrow("Action must be resolve-conflicts, fix-ci or address-comments.");
    }
    await expect(prAction(run, { project: "../demo", id: "t-0002", action: "fix-ci" })).rejects.toThrow("Project must use");
    await expect(prAction(run, { project: "demo", id: "t-2", action: "fix-ci" })).rejects.toThrow("Node ID must");
    expect(calls).toHaveLength(1);

    const already = "auto-fix already asked it at 2026-10-15T10:00:00Z about this state of its pull request (commit 0123456)";
    expect(await prAction(fakeRun(reply(false, already)).run, { project: "demo", id: "t-0002", action: "fix-ci" })).toMatchObject({ sent: false, reason: already });
  });

  it("passes a PR action's refusal through word for word, and anything else as the CLI's failure", async () => {
    const reason = "no check fails on its pull request (3 passed, 0 pending)";
    const refused = { code: 1, stdout: JSON.stringify({ schema_version: 1, ok: false, id: "t-0002", action: "fix-ci", pr: "https://github.com/acme/demo/pull/42", sent: false, message: "", reason }), stderr: `error: ${reason}` };
    const error = await prAction(fakeRun(refused).run, { project: "demo", id: "t-0002", action: "fix-ci" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OrgValidationError);
    expect((error as Error).message).toBe(reason);

    const broken = await prAction(fakeRun({ code: 1, stdout: "", stderr: "error: no project `demo`" }).run, { project: "demo", id: "t-0002", action: "fix-ci" }).catch((caught: unknown) => caught);
    expect(broken).toBeInstanceOf(OrgCliError);
    expect((broken as Error).message).toBe("herdr-organizations failed (1): error: no project `demo`");
    // A reply about another thread or action is no answer to this press.
    const other = { code: 0, stdout: JSON.stringify({ schema_version: 1, ok: true, id: "t-0003", action: "fix-ci", pr: "", sent: true, message: "", reason: "" }), stderr: "" };
    await expect(prAction(fakeRun(other).run, { project: "demo", id: "t-0002", action: "fix-ci" })).rejects.toThrow("invalid pr-action response");
  });

  it("opens a thread's pull request, or says why Organizations would not", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, ok: true, id: "t-0007", pr: "https://github.com/acme/demo/pull/43", reason: "" }), stderr: "" });

    expect(await prCreate(run, { project: "demo", id: "t-0007" })).toEqual({ id: "t-0007", pr: "https://github.com/acme/demo/pull/43" });
    expect(calls).toEqual([{ argv: ["thread", "pr-create", "demo", "t-0007", "--json"], opts: { timeoutMs: 90_000 } }]);
    await expect(prCreate(run, { project: "demo", id: "--help" })).rejects.toThrow("Node ID must");
    expect(calls).toHaveLength(1);

    const reason = "its agent is not idle (working)";
    const refused = { code: 1, stdout: JSON.stringify({ schema_version: 1, ok: false, id: "t-0007", pr: "", reason }), stderr: `error: ${reason}` };
    await expect(prCreate(fakeRun(refused).run, { project: "demo", id: "t-0007" })).rejects.toThrow(new OrgValidationError(reason));
  });

  it("sets only the named automation flags", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, id: "t-0002", auto_fix_ci: true, auto_merge: false }), stderr: "" });

    expect(await setThreadFlags(run, { project: "demo", id: "t-0002", autoFixCi: true })).toEqual({ id: "t-0002", autoFixCi: true, autoMerge: false });
    expect(calls[0]!.argv).toEqual(["thread", "set", "demo", "t-0002", "--auto-fix-ci=on", "--json"]);
    await expect(setThreadFlags(run, { project: "demo", id: "t-0002" })).rejects.toThrow("at least one");
    await expect(setThreadFlags(run, { project: "demo", id: "t-0002", autoMerge: "on" })).rejects.toThrow("true or false");
    expect(calls).toHaveLength(1);
  });

  it("creates a project without letting the name or goal read as a flag", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, project: { slug: "my-app", name: "--My App" }, next: "herdr-organizations open my-app" }), stderr: "" });

    expect(await createProject(run, { name: "--My App", goal: "-ship", repo: "/work/app" })).toEqual({ slug: "my-app", name: "--My App" });
    expect(calls[0]!.argv).toEqual(["new", "--goal=-ship", "--repo=/work/app", "--json", "--", "--My App"]);
    await expect(createProject(run, { name: "App", repo: "relative/path" })).rejects.toThrow("absolute local path");
    await expect(createProject(run, { name: "App", repo: "/srv/app@build-box" })).rejects.toThrow("absolute local path");
    await expect(createProject(run, { name: "" })).rejects.toThrow("Title is required");
  });

  it("never hands the CLI an agent pane's identity", () => {
    const env = orgEnv({ HOME: "/home/me", HERDR_PANE_ID: "w1:p1", HERDR_TAB_ID: "w1:t1", HERDR_WORKSPACE_ID: "w1", HERDR_SOCKET_PATH: "/s" }, "/bin", { HERDR_PROJECTS_ROOT: "/r" });
    expect(env).toEqual({ HOME: "/home/me", HERDR_SOCKET_PATH: "/s", PATH: "/bin", HERDR_PROJECTS_ROOT: "/r" });
  });
});

describe("herdr-organizations project documents (task list, project show, routine list)", () => {
  const missing = { code: 2, stdout: "", stderr: "error: unrecognized subcommand 'task'" };
  const task = { list: "Backlog", title: "Fix login", owner: { kind: "agent", profile: "codex", machine: "", name: "" }, thread: "t-0007", description: "Safari logs out.\n  keep the cookie" };

  it("reads the coordinator's tasks in file order from the project's root", async () => {
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, project: "acme", tasks: [
      task,
      { list: "", title: "Write the docs", owner: { kind: "me", profile: "", machine: "", name: "" }, thread: "", description: "" },
      { ...task, owner: { kind: "robot" } },
    ] }), stderr: "" });
    expect(await readTasks(run, "/root", "acme")).toEqual([
      { list: "Backlog", title: "Fix login", owner: { kind: "agent", profile: "codex", machine: "", name: "" }, thread: "t-0007", description: "Safari logs out.\n  keep the cookie" },
      { list: "", title: "Write the docs", owner: { kind: "me", profile: "", machine: "", name: "" }, thread: "", description: "" },
    ]);
    expect(calls).toEqual([{ argv: ["task", "list", "acme", "--json"], opts: { env: { HERDR_PROJECTS_ROOT: "/root" }, timeoutMs: 10_000 } }]);
  });

  it("answers no document, never an error, when Organizations predates it or says something else", async () => {
    for (const result of [missing, { code: 0, stdout: "not json", stderr: "" }, { code: 0, stdout: JSON.stringify({ schema_version: 2, tasks: [] }), stderr: "" }, { code: 0, stdout: JSON.stringify({ schema_version: 1 }), stderr: "" }]) {
      expect(await readTasks(fakeRun(result).run, "/root", "acme")).toBeNull();
      expect(await readProjectDetail(fakeRun(result).run, "/root", "acme")).toBeNull();
      expect(await readRoutines(fakeRun(result).run, "/root", "acme")).toBeNull();
    }
  });

  it("refuses a slug that is not one before running anything", async () => {
    const { run, calls } = fakeRun(missing);
    await expect(readTasks(run, "/root", "--all")).rejects.toThrow("lowercase");
    await expect(readProjectDetail(run, "/root", "../x")).rejects.toThrow("lowercase");
    expect(calls).toEqual([]);
  });

  it("reads what every thread receives, and drops a memory file or repo that is not one", async () => {
    const project = {
      slug: "acme", name: "Acme Shop", goal: "Ship it", status: "active", dir: "/srv/projects/acme", counts: {}, icon: "", tone: "",
      instructions: "Open a pull request.\n", memory: "# Memory\n", memory_files: [{ name: "payments.md", text: "Retries.\n" }, { name: 3 }],
      repos: [{ path: "/srv/acme/shop", machine: "" }, { path: "/srv/acme/admin", machine: "build-box" }, { machine: "x" }],
      coordinator_profile: "claude", thread_profile: "codex", max_parallel_threads: 10, auto_resolve_days: 7, nudge: true, mute: false,
    };
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, project }), stderr: "" });
    expect(await readProjectDetail(run, "/root", "acme")).toEqual({
      instructions: "Open a pull request.\n", memory: "# Memory\n", memoryFiles: [{ name: "payments.md", text: "Retries.\n" }],
      repos: [{ path: "/srv/acme/shop", machine: "" }, { path: "/srv/acme/admin", machine: "build-box" }],
      coordinatorProfile: "claude", threadProfile: "codex", maxParallelThreads: 10,
    });
    expect(calls[0]!.argv).toEqual(["project", "show", "acme", "--json"]);
  });

  it("lists routines with their trigger and whether they are on", async () => {
    const routine = { name: "nightly-deps", trigger: "schedule", schedule: "daily 03:00", events: [], enabled: true, command: "", command_status: "none", prompt: "Check.", last_run: "", next_run: "2026-10-11T03:00:00Z", skipped_unhandled: 0, skipped_no_coordinator: 0 };
    const { run, calls } = fakeRun({ code: 0, stdout: JSON.stringify({ schema_version: 1, project: "acme", routine_commands: false, broken: [], routines: [
      routine, { ...routine, name: "pr-followup", trigger: "pr", schedule: "", events: ["opened", "merged"], enabled: false, next_run: "" }, { ...routine, trigger: "cron" },
    ] }), stderr: "" });
    expect(await readRoutines(run, "/root", "acme")).toEqual([
      { name: "nightly-deps", trigger: "schedule", schedule: "daily 03:00", events: [], enabled: true, nextRun: "2026-10-11T03:00:00Z" },
      { name: "pr-followup", trigger: "pr", schedule: "", events: ["opened", "merged"], enabled: false, nextRun: "" },
    ]);
    expect(calls[0]!.argv).toEqual(["routine", "list", "acme", "--json"]);
  });
});
