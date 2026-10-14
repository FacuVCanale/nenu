import { writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { browsersCache, DESKTOP, launchWebkit, userCacheDir, type Browser, type Page } from "./browser.ts";
import { startTestBridge, type TestBridge } from "./bridge.ts";
import { homeOrg, seedDiffRepo, type DemoHerd, type OrgSeed } from "./scenario.ts";

// The desk's Project panel on the e2e bench: a project coordinator's chat with the panel beside it,
// each of the project's views in dark and light, a pull request's diff, the panel folded and opened
// again, and the same views against an Organizations that predates `task list` and `project show`.
// Then, on the real clock, a fresh WebKit left alone on the panel for --seconds: CPU, memory and DOM.
// `--before` drives the panel as it was, behind ⋯ (Threads, PRs, Activity, Memory).
//
//   bun scripts/e2e/project-panel.ts [--before] [--port 8797] [--out DIR] [--seconds 60]

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8797" },
    out: { type: "string" },
    seconds: { type: "string", default: "60" },
    before: { type: "boolean", default: false },
  },
});
const port = Number(values.port);
const before = values.before === true;
const outDir = values.out ?? join(process.env.NENU_E2E_OUT ?? join(userCacheDir(), "nenu-e2e"), `project-panel-${Date.now()}`);
const CAPTURE_EPOCH = Date.parse("2026-10-10T14:00:00Z");

/** homeOrg with its own coordinator on the Codex pane, and, unless `legacy`, the newer documents. */
function panelSeed(herd: DemoHerd, now: number, size: { additions: number; deletions: number }, legacy: boolean): OrgSeed {
  const seed = homeOrg(herd, now, size);
  const project = seed.projects[0]!;
  project.coordinator = { workspace_id: "w2", tab_id: "w2:t1", pane_id: herd.codex };
  if (legacy) return seed;
  const agent = (profile: string) => ({ kind: "agent", profile, machine: "", name: "" });
  const none = { kind: "unassigned", profile: "", machine: "", name: "" };
  Object.assign(project, {
    tasks: [
      { list: "Checkout", title: "Payments webhook", owner: agent("claude"), thread: "t-0011", description: "" },
      { list: "Checkout", title: "Cart badge", owner: agent("claude"), thread: "t-0013", description: "" },
      { list: "Checkout", title: "Checkout flow", owner: agent("claude"), thread: "t-0012", description: "" },
      { list: "Checkout", title: "Login hotfix", owner: agent("claude"), thread: "t-0014", description: "" },
      { list: "Backlog", title: "Gift cards at checkout", owner: none, thread: "", description: "Needs the payments webhook first.\nKeep the totals in cents." },
      { list: "Backlog", title: "Admin export to CSV", owner: { kind: "me", profile: "", machine: "", name: "" }, thread: "", description: "" },
      { list: "Backlog", title: "Coupon codes in the admin", owner: { kind: "person", profile: "", machine: "", name: "Dana" }, thread: "", description: "" },
      { list: "Done", title: "Search index", owner: agent("codex"), thread: "t-0001", description: "" },
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

async function bench<T>(legacy: boolean, fn: (bridge: TestBridge, browser: Browser) => Promise<T>): Promise<T> {
  const prs = join(outDir, "gh-prs.json");
  process.env.NENU_E2E_GH_PRS = prs;
  let size = { additions: 0, deletions: 0 };
  const bridge = await startTestBridge({
    port, fake: true, epoch: CAPTURE_EPOCH,
    org: (herd, now) => panelSeed(herd, now, size, legacy),
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
  for (let run = 1; run <= 2; run++) {
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

await mkdir(outDir, { recursive: true });
const result = await bench(false, async (bridge, browser) => {
  const views = await capture(bridge, browser, false);
  const rest = await idle(bridge);
  return { ...views, idle: rest, orgCalls: (await bridge.orgCalls()).map((argv) => argv.join(" ")), unexpectedWrites: bridge.fake!.writes() };
});
const legacy = before ? undefined : await bench(true, async (bridge, browser) => ({
  ...(await capture(bridge, browser, true)),
  orgCalls: (await bridge.orgCalls()).map((argv) => argv.join(" ")),
  unexpectedWrites: bridge.fake!.writes(),
}));
const summary = { before, ...result, legacy };
await writeFile(join(outDir, "project-panel.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, shots: undefined, legacy: legacy && { ...legacy, shots: undefined } }, null, 2));
if (result.unexpectedWrites.length || legacy?.unexpectedWrites.length) process.exit(1);
