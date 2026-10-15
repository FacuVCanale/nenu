import { writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { browsersCache, DESKTOP, launchWebkit, PHONE, userCacheDir, type Browser, type Page } from "./browser.ts";
import { startTestBridge, type TestBridge } from "./bridge.ts";
import { homeOrg, seedDiffRepo, type DemoHerd, type OrgSeed } from "./scenario.ts";

// The desk's Project panel on the e2e bench: a project coordinator's chat with the panel beside it,
// each of the project's views in dark and light, a pull request's diff, the panel folded and opened
// again, and the same views against an Organizations that predates `task list` and `project show`.
// Then, on the real clock, a fresh WebKit left alone on the panel for --seconds: CPU, memory and DOM.
// `--before` drives the panel as it was, behind ⋯ (Threads, PRs, Activity, Memory). `--notes` takes
// only Notes, at 1440 and 1024 wide (the narrowest desk) in dark and light, against an Organizations
// with `project status`, one with `task list` but no `project status`, and one with neither; then its
// problems and its Done opened, and 900 wide, where a desk's panel is not drawn.
//
//   bun scripts/e2e/project-panel.ts [--before] [--idle-only | --notes] [--port 8797] [--out DIR] [--seconds 60]
//
// The idle count takes every WebKit process that appears while it runs: give the bench a private copy
// of the browser (PLAYWRIGHT_BROWSERS_PATH) when another bench may be running.

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8797" },
    out: { type: "string" },
    seconds: { type: "string", default: "60" },
    before: { type: "boolean", default: false },
    "idle-only": { type: "boolean", default: false },
    notes: { type: "boolean", default: false },
  },
});
const port = Number(values.port);
const before = values.before === true;
const outDir = values.out ?? join(process.env.NENU_E2E_OUT ?? join(userCacheDir(), "nenu-e2e"), `project-panel-${Date.now()}`);
const CAPTURE_EPOCH = Date.parse("2026-10-10T14:00:00Z");

/**
 * What the bench's Organizations can print: `project status` and everything older, `task list` and
 * `project show` without `project status`, or neither of them.
 */
type OrgVariant = "status" | "tasks" | "legacy";

/**
 * homeOrg with its own coordinator on the Codex pane, a thread landing its pull request and a merged
 * one, and the documents `variant` prints. TASKS.md, as `task list` and `project status` read it:
 *
 *   ## Checkout                                  3-6: Payments webhook · t-0011, Cart badge · t-0013,
 *                                                     Checkout flow · t-0012, Login hotfix · t-0014
 *   ## Backlog                                   9: Gift cards at checkout (two lines of notes),
 *                                                12: Admin export to CSV (me), 13: Coupon codes (Dana),
 *                                                14: Refund flow (blocked on design)
 *   ## Done                                      17: Search index (codex) · t-0001,
 *                                                18: [x] Product images on the CDN
 */
function panelSeed(herd: DemoHerd, now: number, size: { additions: number; deletions: number }, variant: OrgVariant): OrgSeed {
  const seed = homeOrg(herd, now, size);
  const project = seed.projects[0]!;
  project.coordinator = { workspace_id: "w2", tab_id: "w2:t1", pane_id: herd.codex };
  const cart = project.threads.find((thread) => thread.id === "t-0013")!;
  const pr = (number: number, state: string) => ({ ...(cart.pr as Record<string, unknown>), url: `https://github.com/acme/shop/pull/${number}`, state });
  project.threads = project.threads.map((thread) => thread.id === "t-0012" ? { ...thread, auto_merge: true }
    : thread.id === "t-0001" ? { ...thread, pr: pr(30, "MERGED") }
    : thread);
  project.threads.push({ ...cart, id: "t-0015", title: "Order confirmation email", parent_id: "root", group: "landing", group_label: "landing", auto_merge: true, pr: pr(43, "OPEN") });
  if (variant === "legacy") return seed;
  const agent = (profile: string) => ({ kind: "agent", profile, machine: "", name: "" });
  const none = { kind: "unassigned", profile: "", machine: "", name: "" };
  const me = { kind: "me", profile: "", machine: "", name: "" };
  const person = (name: string) => ({ kind: "person", profile: "", machine: "", name });
  const thread = (id: string) => project.threads.find((candidate) => candidate.id === id)!;
  const item = (line: number, list: string, title: string, owner: unknown, state: string, id = "", flags: string[] = []) => ({
    kind: "task", id: `task:${line}`, title, list, owner, state, group: id ? thread(id).group : "", task: title, thread: id, pr: id ? thread(id).pr : null,
    created: id ? thread(id).updated : "", updated: id ? thread(id).updated : "", flags,
  });
  const work = (id: string, state: string) => ({
    kind: "thread", id, title: thread(id).title, list: "", owner: null, state, group: thread(id).group, task: "", thread: id, pr: thread(id).pr,
    created: thread(id).updated, updated: thread(id).updated, flags: [],
  });
  const projectStatus = {
    generated_at: new Date(now).toISOString(), objective: "Ship the new checkout before the sale.",
    sources: { tasks_updated: new Date(now - 3_600_000).toISOString(), handoff_updated: new Date(now - 7_200_000).toISOString(), handoff_chars: 9_412, handoff_limit: 8_000, pr_checked: new Date(now - 60_000).toISOString() },
    items: [
      item(3, "Checkout", "Payments webhook", agent("claude"), "waiting", "t-0011"),
      item(4, "Checkout", "Cart badge", agent("claude"), "review", "t-0013"),
      item(5, "Checkout", "Checkout flow", agent("claude"), "working", "t-0012"),
      item(6, "Checkout", "Login hotfix", agent("claude"), "idle", "t-0014"),
      item(9, "Backlog", "Gift cards at checkout", none, "todo"),
      item(12, "Backlog", "Admin export to CSV", me, "todo"),
      item(13, "Backlog", "Coupon codes in the admin", person("Dana"), "todo"),
      item(14, "Backlog", "Refund flow", person("blocked on design"), "todo", "", ["status-in-owner"]),
      item(17, "Done", "Search index", agent("codex"), "done", "t-0001", ["thread-resolved", "pr-merged"]),
      item(18, "Done", "Product images on the CDN", none, "done", "", ["done-not-deleted"]),
      work("t-0010", "working"),
      work("t-0015", "landing"),
      // A kind this Nenu does not know yet: Organizations may add pull requests no thread opened.
      { kind: "pr", id: "pr:44", title: "Bump the image library", state: "review", flags: [] },
    ],
    drift: { handoff_over_limit: 1, thread_resolved: 1, thread_missing: 0, done_not_deleted: 1, status_in_owner: 1, duplicate_title: 0, inbox_unhandled: 0 },
    problems: [
      { rule: "handoff-over-limit", line: 0, task: "", thread: "", detail: "9412 characters, this digest shows the first 8000" },
      { rule: "status-in-owner", line: 14, task: "Refund flow", thread: "", detail: "the owner \"blocked on design\" is status text; a running thread goes after \" · \"" },
      { rule: "thread-resolved", line: 17, task: "Search index", thread: "t-0001", detail: "the thread is resolved and its PR merged" },
      { rule: "done-not-deleted", line: 18, task: "Product images on the CDN", thread: "", detail: "checked done but still listed" },
    ],
    next: [{ thread: "t-0012", line: "Run the cart tests on a phone" }],
  };
  Object.assign(project, variant === "status" ? { projectStatus } : {}, {
    tasks: [
      { list: "Checkout", title: "Payments webhook", owner: agent("claude"), thread: "t-0011", description: "" },
      { list: "Checkout", title: "Cart badge", owner: agent("claude"), thread: "t-0013", description: "" },
      { list: "Checkout", title: "Checkout flow", owner: agent("claude"), thread: "t-0012", description: "" },
      { list: "Checkout", title: "Login hotfix", owner: agent("claude"), thread: "t-0014", description: "" },
      { list: "Backlog", title: "Gift cards at checkout", owner: none, thread: "", description: "Needs the payments webhook first.\nKeep the totals in cents." },
      { list: "Backlog", title: "Admin export to CSV", owner: me, thread: "", description: "" },
      { list: "Backlog", title: "Coupon codes in the admin", owner: person("Dana"), thread: "", description: "" },
      { list: "Backlog", title: "Refund flow", owner: person("blocked on design"), thread: "", description: "" },
      { list: "Done", title: "Search index", owner: agent("codex"), thread: "t-0001", description: "" },
      { list: "Done", title: "Product images on the CDN", owner: none, thread: "", description: "" },
    ],
    detail: {
      instructions: "Work on a branch per thread and open a pull request.\nRun the cart tests before asking for review.\n",
      memory: "# Memory\n\nThe checkout must stay fast on a phone.\n",
      memory_files: [
        { name: "payments.md", text: "Retries back off 1, 4 and 16 minutes.\n" },
        { name: "release.md", text: "Releases go out on Tuesdays.\n" },
      ],
      repos: [{ path: "/srv/acme/shop", machine: "" }, { path: "/srv/acme/admin", machine: "build-box" }],
      coordinator_profile: "claude", thread_profile: "codex", max_parallel_threads: 10, auto_resolve_days: 7, nudge: true, mute: false,
    },
    routines: [
      { name: "pr-followup", trigger: "pr", schedule: "", events: ["opened", "checks-failed", "review", "merged"], enabled: true, command: "", command_status: "none",
        prompt: "Follow up on the pull request.", last_run: "", next_run: "", skipped_unhandled: 0, skipped_no_coordinator: 0 },
      { name: "nightly-deps", trigger: "schedule", schedule: "daily 03:00", events: [], enabled: true, command: "", command_status: "none",
        prompt: "Check for dependency updates.", last_run: "", next_run: new Date(now + 13 * 3_600_000).toISOString(), skipped_unhandled: 0, skipped_no_coordinator: 0 },
    ],
  });
  return seed;
}

async function bench<T>(variant: OrgVariant, fn: (bridge: TestBridge, browser: Browser) => Promise<T>): Promise<T> {
  const prs = join(outDir, "gh-prs.json");
  process.env.NENU_E2E_GH_PRS = prs;
  let size = { additions: 0, deletions: 0 };
  const bridge = await startTestBridge({
    port, fake: true, epoch: CAPTURE_EPOCH,
    org: (herd, now) => panelSeed(herd, now, size, variant),
    repo: (dir) => {
      size = seedDiffRepo(dir);
      writeFileSync(join(dir, ".git/info/exclude"), "/*\n!/app/\n!/docs/\n");
      writeFileSync(prs, JSON.stringify([
        { number: 42, title: "Checkout flow", url: "https://github.com/acme/shop/pull/42", headRefName: "e2e-demo", baseRefName: "main",
          isDraft: false, reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [], ...size, updatedAt: new Date(CAPTURE_EPOCH).toISOString() },
      ]));
    },
  });
  const browser = await launchWebkit().catch(async (error: unknown) => { await bridge.stop(); throw error; });
  try {
    return await fn(bridge, browser);
  } finally {
    await browser.close();
    await bridge.stop();
  }
}

// Every read but the app-wide polls, so a view that loads unseen shows up beside the chat's own reads.
const POLLS = /^\/api\/(snapshot|events|version|update)|\/(queue|subagents|interactions|history|skills|models|activity)$/;

let motion: unknown = null;

async function capture(bridge: TestBridge, browser: Browser, legacy: boolean) {
  const herd = bridge.herd!;
  const shots: string[] = [];
  const requests: Record<string, string[]> = {};
  let log: string[] = [];
  const tag = legacy ? "legacy-" : "";
  const views = before ? ["Threads", "PRs", "Activity", "Memory"] : ["Notes", "Agents", "PRs", "Context"];
  for (const scheme of ["dark", "light"] as const) {
    const context = await browser.newContext({ ...DESKTOP, colorScheme: scheme, timezoneId: "UTC", locale: "en-US" });
    const page = await context.newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") && !POLLS.test(url.pathname)) log.push(decodeURIComponent(url.pathname + url.search));
    });
    await page.clock.install({ time: bridge.now() });
    await page.goto(bridge.url + `/pane/${encodeURIComponent(herd.codex)}`);
    await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    const panel = page.getByRole("complementary", { name: "Session panel" });
    const step = async (name: string, act: () => Promise<unknown>) => {
      log = [];
      await act();
      await page.waitForTimeout(900);
      requests[`${tag}${name}-${scheme}`] = log;
      const path = join(outDir, `${tag}${name}-${scheme}.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
    };
    await step("opened", async () => {});
    if (before) await panel.getByRole("button", { name: /^Project/ }).click();
    else await panel.getByRole("tab", { name: /^Project/ }).click();
    for (const view of views) {
      if (legacy && !["Notes", "Context"].includes(view)) continue;
      await step(`project-${view.toLowerCase()}`, () => panel.getByRole("tab", { name: new RegExp(`^${view}`) }).click());
    }
    if (!before && !legacy && scheme === "dark") {
      await panel.getByRole("tab", { name: /^PRs/ }).click();
      await step("project-pr-diff", () => panel.getByRole("button", { name: /^Checkout flow/ }).first().click());
      await step("folded", () => page.keyboard.press("Meta+Alt+KeyB"));
      await step("reopened", () => page.getByRole("button", { name: "Show session panel" }).click());
    }
    await context.close();
  }
  // The fold and the reopen, with motion allowed: what animates, on which properties, for how long.
  if (!before && !legacy) {
    const context = await browser.newContext({ ...DESKTOP, reducedMotion: "no-preference", timezoneId: "UTC", locale: "en-US" });
    const page = await context.newPage();
    await page.goto(bridge.url + `/pane/${encodeURIComponent(herd.codex)}`);
    await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    const running = () => page.evaluate(() => document.getAnimations().map((animation) => {
      const effect = animation.effect as KeyframeEffect | null;
      return { properties: [...new Set((effect?.getKeyframes() ?? []).flatMap((frame) => Object.keys(frame).filter((key) => !["offset", "computedOffset", "easing", "composite"].includes(key))))],
        duration: effect?.getTiming().duration, iterations: effect?.getTiming().iterations };
    }), null);
    const quiet = await running();
    await page.getByRole("button", { name: "Hide session panel" }).click();
    const fold = await running();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Show session panel" }).click();
    const open = await running();
    await page.waitForTimeout(400);
    const tab = await (async () => { await page.getByRole("tab", { name: /^Agents/ }).click(); return running(); })();
    motion = { quiet, fold, open, tab, after: await (async () => { await page.waitForTimeout(400); return running(); })() };
    await context.close();
  }
  // A phone keeps its own project views (Chat, Threads, PRs): the desk's panel must not reach it.
  if (!legacy) {
    const context = await browser.newContext({ ...PHONE, timezoneId: "UTC", locale: "en-US" });
    const page = await context.newPage();
    await page.clock.install({ time: bridge.now() });
    await page.goto(bridge.url + `/pane/${encodeURIComponent(herd.codex)}`);
    await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
    for (const view of ["Threads", "PRs"]) {
      await page.getByRole("tab", { name: new RegExp(`^${view}`) }).click();
      await page.waitForTimeout(900);
      const path = join(outDir, `phone-${view.toLowerCase()}-dark.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
    }
    await context.close();
  }
  return { shots, requests };
}

/** WebKit processes from this bench's browser path, RSS in KB and CPU time in ms. */
async function webkitProcesses(): Promise<Map<number, { rssKb: number; cpuMs: number }>> {
  const out = await new Response(Bun.spawn(["ps", "-A", "-o", "pid=,rss=,time=,command="]).stdout).text();
  const path = join(browsersCache(), "webkit-");
  const procs = new Map<number, { rssKb: number; cpuMs: number }>();
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match || !match[4]!.includes(path)) continue;
    const [clock, days] = match[3]!.includes("-") ? [match[3]!.split("-")[1]!, Number(match[3]!.split("-")[0])] : [match[3]!, 0];
    const seconds = clock.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
    procs.set(Number(match[1]), { rssKb: Number(match[2]), cpuMs: Math.round((days * 86400 + seconds) * 1000) });
  }
  return procs;
}

/** A fresh WebKit per run on the coordinator's chat with the panel on the project, left alone. */
async function idle(bridge: TestBridge) {
  const windowMs = Number(values.seconds) * 1000;
  const runs = [];
  for (let run = 1; run <= 3; run++) {
    const known = new Set((await webkitProcesses()).keys());
    const own = await launchWebkit();
    try {
      const context = await own.newContext({ ...DESKTOP, timezoneId: "UTC", locale: "en-US" });
      const page: Page = await context.newPage();
      await page.goto(bridge.url + `/pane/${encodeURIComponent(bridge.herd!.codex)}`);
      await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
      const panel = page.getByRole("complementary", { name: "Session panel" });
      if (before) await panel.getByRole("button", { name: /^Project/ }).click();
      else await panel.getByRole("tab", { name: /^Project/ }).click();
      // Past the load and the service worker's precache, so the window holds only the page at rest.
      await page.waitForTimeout(10_000);
      const mine = (procs: Map<number, { rssKb: number; cpuMs: number }>) => [...procs].filter(([pid]) => !known.has(pid));
      const start = new Map(mine(await webkitProcesses()));
      await page.waitForTimeout(windowMs);
      const end = mine(await webkitProcesses());
      const cpuMs = end.reduce((acc, [pid, p]) => acc + p.cpuMs - (start.get(pid)?.cpuMs ?? 0), 0);
      const dom = await page.evaluate(() => document.getElementsByTagName("*").length, null);
      runs.push({ run, seconds: windowMs / 1000, cpuMs, cpuPercent: Math.round((cpuMs / windowMs) * 1000) / 10,
        rssMb: Math.round(end.reduce((acc, [, p]) => acc + p.rssKb, 0) / 1024), dom });
      await context.close();
    } finally {
      await own.close();
    }
  }
  return runs;
}

/** Notes alone at each width and scheme; then its problems and its Done, each opened and closed again. */
async function notes(bridge: TestBridge, browser: Browser, variant: OrgVariant) {
  const shots: string[] = [];
  const requests: Record<string, string[]> = {};
  for (const scheme of ["dark", "light"] as const) {
    for (const width of [1440, 1024, 900]) {
      const context = await browser.newContext({ ...DESKTOP, viewport: { width, height: 900 }, colorScheme: scheme, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      const log: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/") && !POLLS.test(url.pathname)) log.push(decodeURIComponent(url.pathname + url.search));
      });
      await page.clock.install({ time: bridge.now() });
      await page.goto(bridge.url + `/pane/${encodeURIComponent(bridge.herd!.codex)}`);
      await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      const shot = async (name: string) => {
        const path = join(outDir, `${variant}-${name}-${width}-${scheme}.png`);
        await page.screenshot({ path, animations: "disabled" });
        shots.push(path);
      };
      if (width >= 1024) {
        const panel = page.getByRole("complementary", { name: "Session panel" });
        await panel.getByRole("tab", { name: /^Project/ }).click();
        await panel.getByRole("tab", { name: /^Notes/ }).click();
        await page.waitForTimeout(900);
        requests[`notes-${width}-${scheme}`] = [...log];
        await shot("notes");
        for (const [name, label] of [["problems", /^\d+ problems?$/], ["done", /^Done/]] as const) {
          const toggle = panel.getByRole("button", { name: label });
          if (width !== 1440 || !(await toggle.count())) continue;
          await toggle.click();
          await page.waitForTimeout(400);
          await shot(name);
          await toggle.click();
        }
      } else {
        await shot("no-panel");
      }
      await context.close();
    }
  }
  return { shots, requests };
}

await mkdir(outDir, { recursive: true });
if (values.notes) {
  const runs: Record<string, Awaited<ReturnType<typeof notes>> & { orgCalls: string[]; unexpectedWrites: unknown[] }> = {};
  for (const variant of ["status", "tasks", "legacy"] as const) {
    runs[variant] = await bench(variant, async (bridge, browser) => ({
      ...(await notes(bridge, browser, variant)),
      orgCalls: (await bridge.orgCalls()).map((argv) => argv.join(" ")),
      unexpectedWrites: bridge.fake!.writes(),
    }));
  }
  await writeFile(join(outDir, "project-notes.json"), JSON.stringify(runs, null, 2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(runs).map(([variant, run]) => [variant, { ...run, shots: run.shots.length }])), null, 2));
  process.exit(Object.values(runs).some((run) => run.unexpectedWrites.length) ? 1 : 0);
}
const result = await bench("status", async (bridge, browser) => {
  const views = values["idle-only"] ? { shots: [], requests: {} } : await capture(bridge, browser, false);
  const rest = await idle(bridge);
  return { ...views, idle: rest, orgCalls: (await bridge.orgCalls()).map((argv) => argv.join(" ")), unexpectedWrites: bridge.fake!.writes() };
});
const legacy = before || values["idle-only"] ? undefined : await bench("legacy", async (bridge, browser) => ({
  ...(await capture(bridge, browser, true)),
  orgCalls: (await bridge.orgCalls()).map((argv) => argv.join(" ")),
  unexpectedWrites: bridge.fake!.writes(),
}));
const summary = { before, ...result, motion, legacy };
await writeFile(join(outDir, "project-panel.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, shots: undefined, legacy: legacy && { ...legacy, shots: undefined } }, null, 2));
if (result.unexpectedWrites.length || legacy?.unexpectedWrites.length) process.exit(1);
