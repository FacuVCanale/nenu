import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { DESKTOP, launchWebkit, PHONE, userCacheDir, type Page } from "./browser.ts";
import { startTestBridge, type TestBridge } from "./bridge.ts";
import { homeOrg, type DemoHerd, type OrgSeed } from "./scenario.ts";

// Each pull request's one button on the e2e bench: a project whose threads hold a PR in every state
// Organizations names an action for (conflicts, failing CI, comments, ready to merge), a pushed branch
// with no PR, a PR with no action, and one whose action Organizations refuses on its fresh read. It
// captures the desk's Project panel, the PRs chip and the phone's PRs view in dark and light, then
// presses the buttons: asked, already asked, the refusal, Create PR and Merge's confirmation.
// `--legacy` seeds an Organizations that predates `actions`, which must look as it did; `--before`
// takes the still captures only, for a Nenu that has no buttons to press.
//
//   bun scripts/e2e/pr-actions.ts [--before | --legacy] [--port 8797] [--out DIR] [--idle 20]

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8797" },
    out: { type: "string" },
    legacy: { type: "boolean", default: false },
    before: { type: "boolean", default: false },
    idle: { type: "string", default: "20" },
  },
});
const port = Number(values.port);
const legacy = values.legacy === true;
const before = values.before === true;
const outDir = values.out ?? join(process.env.NENU_E2E_OUT ?? join(userCacheDir(), "nenu-e2e"), `pr-actions-${Date.now()}`);
const CAPTURE_EPOCH = Date.parse("2026-10-10T14:00:00Z");

/** homeOrg's Acme Shop with its coordinator on the Codex pane and a PR in every state. */
function prSeed(herd: DemoHerd, now: number): OrgSeed {
  const seed = homeOrg(herd, now, { additions: 64, deletions: 12 });
  const project = seed.projects[0]!;
  project.coordinator = { workspace_id: "w2", tab_id: "w2:t1", pane_id: herd.codex };
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const pr = (number: number, actions: string[], extra: Record<string, unknown> = {}) => ({
    url: `https://github.com/acme/shop/pull/${number}`, state: "OPEN", review: "REVIEW_REQUIRED", checks: { passed: 6, pending: 0, failed: 0 },
    additions: 40 + number, deletions: 8, failing: [], comment_count: 0, draft: false, mergeable: "MERGEABLE", merge_blocker: "review is REVIEW_REQUIRED", actions, ...extra,
  });
  const failing = { checks: { passed: 5, pending: 0, failed: 1 }, failing: ["unit-tests"], merge_blocker: "1 check(s) failed" };
  const worker = (id: string, title: string, group: string, minutes: number, extra: Record<string, unknown>) => ({
    id, title, parent_id: "t-0010", role: "worker", status: "open", group, group_label: group, note: "", branch: "",
    workspace_id: "", tab_id: "", pane_id: "", cwd: "", updated: ago(minutes), report_unacked: false, auto_fix_ci: false, auto_merge: false, pr: null, actions: [], ...extra,
  });
  project.threads = project.threads.map((thread) =>
    thread.id === "t-0012" ? { ...thread, actions: [], pr: pr(42, ["fix-ci"], failing) }
    : thread.id === "t-0013" ? { ...thread, actions: [], pr: pr(41, ["merge"], { review: "APPROVED", merge_blocker: null }) }
    : thread.id === "t-0014" ? { ...thread, branch: "acme/login-hotfix", actions: ["create-pr"] }
    : { ...thread, actions: [] });
  project.threads.push(
    worker("t-0015", "Coupon codes", "ready-for-review", 6, { pr: pr(44, ["address-comments"], { review: "CHANGES_REQUESTED", comment_count: 3, merge_blocker: "review is CHANGES_REQUESTED" }) }),
    worker("t-0016", "Gift cards", "ready-for-review", 9, { pr: pr(45, ["resolve-conflicts"], { mergeable: "CONFLICTING", merge_blocker: "GitHub reports a merge conflict" }) }),
    worker("t-0017", "Admin export", "ready-for-review", 15, { pr: pr(46, []) }),
    // Approved and green with a bot's comment: Organizations lists Address comments first; Merge wins.
    worker("t-0019", "Search filters", "ready-for-review", 25, { pr: pr(48, ["address-comments", "merge"], { review: "APPROVED", comment_count: 1, merge_blocker: null }) }),
    // The ticker read a failure; Organizations' own read before sending finds it passed since.
    worker("t-0018", "Payments retry", "ready-for-review", 20, { pr: pr(47, ["fix-ci"], failing), refuse: "no check fails on its pull request (6 passed, 0 pending)" }),
  );
  if (legacy) {
    for (const thread of project.threads) {
      delete thread.actions;
      if (thread.pr) delete (thread.pr as Record<string, unknown>).actions;
    }
  }
  return seed;
}

// The app-wide polls, counted while the panel sits still: nothing new may join them.
const counted = (path: string) => path.startsWith("/api/");

async function shoot(page: Page, name: string, shots: string[]) {
  await page.waitForTimeout(250);
  const path = join(outDir, `${name}.png`);
  await page.screenshot({ path, animations: "disabled" });
  shots.push(path);
}

async function openCoordinator(page: Page, bridge: TestBridge) {
  await page.clock.install({ time: bridge.now() });
  await page.goto(bridge.url + `/pane/${encodeURIComponent(bridge.herd!.codex)}`);
  await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
}

async function run(bridge: TestBridge) {
  const browser = await launchWebkit();
  const shots: string[] = [];
  const idleRequests: Record<string, number> = {};
  const pressed: Record<string, string> = {};
  const tag = before ? "before-" : legacy ? "legacy-" : "";
  try {
    for (const scheme of ["dark", "light"] as const) {
      const desk = await browser.newContext({ ...DESKTOP, colorScheme: scheme, timezoneId: "UTC", locale: "en-US" });
      const page = await desk.newPage();
      await openCoordinator(page, bridge);
      const panel = page.getByRole("complementary", { name: "Session panel" });
      await panel.getByRole("tab", { name: /^Project/ }).click();
      await panel.getByRole("tab", { name: /^PRs/ }).click();
      await shoot(page, `${tag}desk-panel-prs-${scheme}`, shots);
      if (scheme === "dark") {
        const seen: string[] = [];
        page.on("request", (request) => { const url = new URL(request.url()); if (counted(url.pathname)) seen.push(url.pathname); });
        await page.waitForTimeout(Number(values.idle) * 1000);
        for (const path of seen) idleRequests[path] = (idleRequests[path] ?? 0) + 1;
      }
      await page.getByRole("button", { name: /^PRs/ }).first().click();
      await shoot(page, `${tag}desk-chip-prs-${scheme}`, shots);
      await desk.close();

      const phone = await browser.newContext({ ...PHONE, colorScheme: scheme, timezoneId: "UTC", locale: "en-US" });
      const mobile = await phone.newPage();
      await openCoordinator(mobile, bridge);
      await mobile.getByRole("tab", { name: /^PRs/ }).click();
      await shoot(mobile, `${tag}phone-prs-${scheme}`, shots);
      await mobile.getByRole("tab", { name: /^Chat/ }).click();
      await mobile.getByRole("button", { name: /^PRs/ }).first().click();
      await shoot(mobile, `${tag}phone-chip-prs-${scheme}`, shots);
      await phone.close();
    }
    if (legacy || before) return { shots, idleRequests, pressed };

    // Presses mutate the fake's state, so they come after every still capture.
    for (const [device, size] of [["desk", DESKTOP], ["phone", PHONE]] as const) {
      for (const scheme of ["dark", "light"] as const) {
        const context = await browser.newContext({ ...size, colorScheme: scheme, timezoneId: "UTC", locale: "en-US" });
        const page = await context.newPage();
        await openCoordinator(page, bridge);
        const list = device === "desk" ? page.getByRole("complementary", { name: "Session panel" }) : page;
        if (device === "desk") await list.getByRole("tab", { name: /^Project/ }).click();
        await list.getByRole("tab", { name: /^PRs/ }).click();
        await page.waitForTimeout(400);
        const press = async (name: string, shot: string) => {
          const button = list.getByRole("button", { name }).first();
          await button.click();
          await page.waitForTimeout(600);
          // A press that changes the PR (Create PR) takes its button away on the next read.
          pressed[`${device}-${scheme}-${shot}`] = await button.count() ? await button.innerText() : "(gone)";
          await shoot(page, `${device}-${shot}-${scheme}`, shots);
        };
        // The first press of the bench sends; every later one finds it already asked.
        await press("Fix CI Checkout flow", "fix-ci");
        await page.waitForTimeout(4500);
        await press("Fix CI Checkout flow", "fix-ci-again");
        await press("Fix CI Payments retry", "refused");
        await page.getByRole("button", { name: "Dismiss notification" }).click();
        await press("Address comments Coupon codes", "address-comments");
        await press("Resolve conflicts Gift cards", "resolve-conflicts");
        if (device === "desk" && scheme === "dark") await press("Create PR Login hotfix", "create-pr");
        await list.getByRole("button", { name: "Merge Cart badge" }).click();
        await shoot(page, `${device}-merge-dialog-${scheme}`, shots);
        await context.close();
      }
    }
    return { shots, idleRequests, pressed };
  } finally {
    await browser.close();
  }
}

await mkdir(outDir, { recursive: true });
const bridge = await startTestBridge({ port, fake: true, epoch: CAPTURE_EPOCH, org: prSeed });
try {
  const result = await run(bridge);
  const summary = { legacy, before, ...result, orgCalls: (await bridge.orgCalls()).filter((argv) => argv[0] === "thread").map((argv) => argv.join(" ")), unexpectedWrites: bridge.fake!.writes() };
  await writeFile(join(outDir, "pr-actions.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, shots: summary.shots.length, outDir }, null, 2));
  if (summary.unexpectedWrites.length) process.exitCode = 1;
} finally {
  await bridge.stop();
}
