import { writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { DESKTOP, launchWebkit, PHONE, userCacheDir, type Browser, type Locator, type Page } from "./browser.ts";
import { startTestBridge, type TestBridge } from "./bridge.ts";
import { demoOrg, diffOrg, growDiffRepo, homeOrg, needsYouSeed, orgTreeSeed, projectChatSeed, seedDiffRepo, tickJournal, writeJournal, type DemoHerd, type OrgSeed } from "./scenario.ts";

// The e2e bench. Every command starts its own test bridge on a FakeHerdr (bridge.ts), so nothing
// here can reach the live service or a real terminal.
//
//   bun scripts/e2e/run.ts smoke    [--port 8797] [--out DIR]   Home screenshots, phone + desktop
//   bun scripts/e2e/run.ts project  [--port 8797] [--out DIR]   A project page, then create and start nodes
//   bun scripts/e2e/run.ts org      [--port 8797] [--out DIR]   Every view of a project's organization
//   bun scripts/e2e/run.ts threads  [--port 8797] [--out DIR] [--seconds 60]  A coordinator's chat: tabs, panel, DOM and React renders
//   bun scripts/e2e/run.ts needs-you [--port 8797] [--out DIR]  Two threads that need you: a dialog, and an agent waiting for a reply
//   bun scripts/e2e/run.ts tabs     [--port 8797] [--out DIR]   Close an open pane's tab, then where it lands
//   bun scripts/e2e/run.ts workspace [--port 8797] [--out DIR]  Open each workspace from every way in, then where it lands
//   bun scripts/e2e/run.ts layout   [--port 8797] [--out DIR]   Every page at 1280/1440/1920 (sidebar open, folded), 900 and 390
//   bun scripts/e2e/run.ts stop     [--port 8797] [--out DIR]   Stop a working Claude, then what the queue holds
//   bun scripts/e2e/run.ts processes [--port 8797] [--out DIR]  A working Claude's background work: chip, list, details, ⋯
//   bun scripts/e2e/run.ts stop-state [--port 8797] [--out DIR] Stop from the session file, under a custom statusline
//   bun scripts/e2e/run.ts baseline [--port 8797] [--out DIR] [--seconds 60] [--sends 5]
//   bun scripts/e2e/run.ts home     [--port 8797] [--out DIR] [--seconds 60]  Home with a project: captures, each list, requests per minute
//   bun scripts/e2e/run.ts compare A.png B.png                  share of differing pixels
//
// Output goes outside the repo: --out, else $NENU_E2E_OUT, else <user cache>/nenu-e2e/<stamp>.

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string", default: "8797" },
    out: { type: "string" },
    seconds: { type: "string", default: "60" },
    sends: { type: "string", default: "5" },
    before: { type: "boolean", default: false },
  },
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = values.out ?? join(process.env.NENU_E2E_OUT ?? join(userCacheDir(), "nenu-e2e"), stamp);
const port = Number(values.port);
// Captures render at this instant (a Saturday afternoon, UTC) whenever they are taken.
const CAPTURE_EPOCH = Date.parse("2026-10-10T14:00:00Z");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Bridge process CPU time in ms, from ps (macOS and Linux print [[dd-]hh:]mm:ss[.cc]). */
async function cpuMs(pid: number): Promise<number> {
  const out = (await new Response(Bun.spawn(["ps", "-o", "time=", "-p", String(pid)]).stdout).text()).trim();
  const [clock, days] = out.includes("-") ? [out.split("-")[1]!, Number(out.split("-")[0])] : [out, 0];
  const parts = clock.split(":").map(Number);
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  return Math.round((days * 86400 + seconds) * 1000);
}

/** `/api/pane/w1%3Aworking/history?…` → `pane/:id/history`, so counts group by route. */
function route(url: string): string | null {
  const { pathname } = new URL(url);
  if (!pathname.startsWith("/api/")) return null;
  return pathname.slice(5).replace(/^pane\/[^/]+/, "pane/:id").replace(/^tab\/[^/]+/, "tab/:id");
}

function tally(urls: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const u of urls) {
    const r = route(u);
    if (r) counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
const perMinute = (o: Record<string, number>, ms: number) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round((v * 60_000 / ms) * 10) / 10]));
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;

async function withBench<T>(fn: (bridge: TestBridge, browser: Browser) => Promise<T>, epoch?: number, org?: (herd: DemoHerd, now: number) => OrgSeed, repo?: (dir: string) => void): Promise<T> {
  const bridge = await startTestBridge({ port, fake: true, epoch, org, repo });
  let browser: Browser | null = null;
  try {
    browser = await launchWebkit();
    return await fn(bridge, browser);
  } finally {
    await browser?.close();
    await bridge.stop();
  }
}

/** A phone page that records every /api request it makes. */
async function phonePage(browser: Browser, opts: { rawTerminal?: string } = {}) {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  if (opts.rawTerminal) {
    // The mirror is a per-pane display pref (use-display-prefs.ts), keyed by [session, paneId].
    await page.addInitScript((scope: string) => {
      localStorage.setItem("collie:raw-terminal-scopes:v1", JSON.stringify({ [scope]: true }));
    }, JSON.stringify(["default", opts.rawTerminal]));
  }
  const requests: Array<{ url: string; at: number }> = [];
  page.on("request", (req) => requests.push({ url: req.url(), at: Date.now() }));
  return { page, requests, close: () => context.close() };
}

async function smoke(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const shots: string[] = [];
    for (const [name, device] of [["home-phone", PHONE], ["home-desktop", DESKTOP]] as const) {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      await page.goto(bridge.url + "/");
      await page.getByText("Working Claude").first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      const path = join(outDir, `${name}.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
      await context.close();
    }
    // The temp registry is empty; a project here means the operator's real one leaked in.
    const { projects } = await fetch(`${bridge.url}/api/snapshot`).then((r) => r.json() as Promise<{ projects?: unknown[] }>);
    return { shots, projects: projects?.length ?? 0, herdrCalls: bridge.fake!.counts(), unexpectedWrites: bridge.fake!.writes() };
  }, CAPTURE_EPOCH);
  await writeFile(join(outDir, "smoke.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.unexpectedWrites.length || result.projects) process.exit(1);
}

/**
 * The project page of a project whose coordinator is not running, on a phone and a desk; then the
 * person creates a coordinator under the project root, a thread under that coordinator, and starts
 * the project coordinator. Organizations is fake-org.ts, so the run reports the exact argv Nenu ran.
 */
async function project(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const shots: string[] = [];
    const shoot = async (page: Page, name: string) => {
      const path = join(outDir, `${name}.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
    };
    const openProject = async (device: typeof PHONE | typeof DESKTOP) => {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      await page.goto(bridge.url + "/project/acme");
      await page.locator('main >> text="Panel depósito"').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      return { page, close: () => context.close() };
    };
    const calledWith = async (verb: string) => {
      for (let i = 0; i < 100; i++) {
        if ((await bridge.orgCalls()).some((argv) => argv[0] === verb)) return;
        await sleep(100);
      }
      throw new Error(`Organizations was never asked to ${verb}`);
    };

    // Both pages first, so neither capture shows what the flows below create.
    for (const [name, device] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
      const { page, close } = await openProject(device);
      await shoot(page, `project-${name}`);
      await close();
    }
    let flowError: string | null = null;
    for (const [name, device] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
      const { page, close } = await openProject(device);
      try {
        if (name === "desktop") {
          await page.getByRole("button", { name: "New coordinator" }).click({ timeout: 5000 });
          await page.getByLabel("Title", { exact: true }).fill("Pagos y facturación");
          await page.getByLabel("Task", { exact: true }).fill("Coordinate the billing work: invoices, receipts and the payment provider.");
          await shoot(page, "new-coordinator-desktop");
          await page.getByRole("button", { name: "Create coordinator" }).click();
          await page.locator('main >> text="Pagos y facturación"').waitFor({ timeout: 15_000 });
          await page.waitForTimeout(500);
          await shoot(page, "project-created-desktop");
          await page.getByRole("button", { name: "Start coordinator" }).click();
          await calledWith("open");
        } else {
          await page.getByRole("button", { name: "New thread" }).click({ timeout: 5000 });
          await page.getByLabel("Title", { exact: true }).fill("Ajustar checkout");
          // A select's accessible name carries its chosen option, so its label is matched loosely.
          await page.getByLabel("Parent").selectOption("t-0010");
          await page.getByLabel("Task", { exact: true }).fill("Make the checkout fit a 390 px screen.");
          await shoot(page, "new-thread-phone");
          await page.getByRole("button", { name: "Create thread" }).click();
          await page.locator('main >> text="Ajustar checkout"').waitFor({ timeout: 15_000 });
          await page.waitForTimeout(500);
          await shoot(page, "project-created-phone");
        }
      } catch (error) {
        flowError ??= `${name}: ${(error as Error).message.split("\n")[0]}`;
        await shoot(page, `failed-${name}`);
      }
      await close();
    }
    return { shots, flowError, orgCalls: await bridge.orgCalls(), unexpectedWrites: bridge.fake!.writes() };
  }, CAPTURE_EPOCH, demoOrg);
  await writeFile(join(outDir, "project.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.flowError || result.unexpectedWrites.length) process.exit(1);
}

/**
 * Every place Nenu draws a project's organization, on a project shaped like a long-running one
 * (scenario.ts `orgTreeSeed`): the project page with its coordinator stopped, then with it running
 * the desk's side panel and the sidebar, and the phone's Threads tab. Each with History closed, then
 * open.
 */
async function org(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const shots: string[] = [];
  const shoot = async (page: Page, name: string) => {
    const path = join(outDir, `${name}.png`);
    await page.screenshot({ path, animations: "disabled" });
    shots.push(path);
  };
  const TALL_PHONE = { ...PHONE, viewport: { width: 390, height: 1800 } };
  const open = async (browser: Browser, bridge: TestBridge, device: typeof PHONE | typeof TALL_PHONE | typeof DESKTOP, path: string, ready: string) => {
    const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
    const page = await context.newPage();
    await page.clock.install({ time: bridge.now() });
    await page.goto(bridge.url + path);
    await page.locator(ready).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    return { page, close: () => context.close() };
  };
  const history = (scope: Locator) => scope.getByText(/^(History|Resolved)\b/).first();

  await withBench(async (bridge, browser) => {
    for (const [name, device] of [["phone", TALL_PHONE], ["desktop", DESKTOP]] as const) {
      const { page, close } = await open(browser, bridge, device, "/project/acme", 'main >> text="Panel depósito"');
      await shoot(page, `page-${name}`);
      await history(page.locator("main")).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shoot(page, `page-history-${name}`);
      if (name === "desktop") {
        await history(page.locator('nav[aria-label="Projects and chats"]')).click({ timeout: 5000 });
        await page.waitForTimeout(300);
        await shoot(page, "sidebar-history-desktop");
      }
      await close();
    }
  }, CAPTURE_EPOCH, (herd, now) => orgTreeSeed(herd, now));

  let flowError: string | null = null;
  let orgCalls: string[][] = [];
  await withBench(async (bridge, browser) => {
    const coordinator = `/pane/${encodeURIComponent(bridge.herd!.codex)}`;
    const calledWith = async (...argv: string[]) => {
      for (let i = 0; i < 100; i++) {
        if ((await bridge.orgCalls()).some((call) => argv.every((arg, index) => call[index] === arg))) return;
        await sleep(100);
      }
      throw new Error(`Organizations was never asked to ${argv.join(" ")}`);
    };
    {
      const { page, close } = await open(browser, bridge, DESKTOP, coordinator, 'aside[aria-label="Project"] >> text="Panel depósito"');
      const panel = page.locator('aside[aria-label="Project"]');
      await shoot(page, "panel-desktop");
      await history(panel).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shoot(page, "panel-history-desktop");
      // Each node's actions: a coordinator with open work refuses to close, a thread closes, the coordinator is replaced.
      try {
        await panel.getByRole("button", { name: "Close Rediseño mobile" }).click({ timeout: 5000 });
        await page.getByRole("dialog", { name: "Close its work first" }).waitFor({ timeout: 5000 });
        await shoot(page, "close-refused-desktop");
        await page.getByRole("button", { name: "OK" }).click();
        await panel.getByRole("button", { name: "Close Hotfix login" }).click({ timeout: 5000 });
        await page.getByRole("dialog", { name: "Close this thread?" }).getByRole("button", { name: "Close thread" }).click({ timeout: 5000 });
        await calledWith("node", "resolve", "acme", "t-0108", "--close-view");
        await panel.getByRole("button", { name: "Replace coordinator" }).click({ timeout: 5000 });
        const dialog = page.getByRole("dialog", { name: "Replace the coordinator?" });
        await dialog.getByLabel("New one runs on").selectOption("claude");
        await shoot(page, "replace-desktop");
        await dialog.getByRole("button", { name: "Replace" }).click();
        await calledWith("coordinator", "replace", "acme", "--profile=claude");
        await page.waitForTimeout(500);
        await shoot(page, "after-actions-desktop");
      } catch (error) {
        flowError ??= `desktop: ${(error as Error).message.split("\n")[0]}`;
        await shoot(page, "failed-desktop");
      }
      await close();
    }
    {
      const { page, close } = await open(browser, bridge, TALL_PHONE, coordinator, 'role=tab[name=/Threads/]');
      await page.getByRole("tab", { name: /Threads/ }).click();
      await page.locator('.project-overlay >> text="Panel depósito"').first().waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shoot(page, "threads-phone");
      await history(page.locator(".project-overlay")).click({ timeout: 5000 });
      await page.waitForTimeout(300);
      await shoot(page, "threads-history-phone");
      // A resolved node opens its detail inside Nenu, not its coordinator's chat.
      try {
        await page.locator(".project-overlay").getByRole("button", { name: /^Mergear PRs restantes Coordinator/ }).click({ timeout: 5000 });
        await page.locator('main >> text="Coordinator under"').first().waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        await shoot(page, "node-detail-phone");
      } catch (error) {
        flowError ??= `phone: ${(error as Error).message.split("\n")[0]}`;
        await shoot(page, "failed-phone");
      }
      await close();
    }
    orgCalls = await bridge.orgCalls();
  }, CAPTURE_EPOCH, (herd, now) => orgTreeSeed(herd, now, { coordinator: true }));

  const writes = orgCalls.filter((argv) => argv[0] !== "overview" && argv[1] !== "list");
  const result = { shots, flowError, orgWrites: writes };
  await writeFile(join(outDir, "org.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (flowError) process.exit(1);
}

/**
 * Counts React commits and the components each one rendered, through the hook React DevTools uses
 * (a production build calls it too). A component counts when it mounted or performed work; a
 * subtree React bailed out of keeps its old children and is not walked.
 */
function countRenders(): void {
  const stats = { commits: 0, renders: 0 };
  const components = new Set([0, 1, 11, 14, 15]); // function, class, forwardRef, memo, simple memo
  type Fiber = { tag: number; flags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null };
  const walk = (first: Fiber | null) => {
    for (let fiber = first; fiber; fiber = fiber.sibling) {
      const before = fiber.alternate;
      if (components.has(fiber.tag) && (before === null || (fiber.flags & 1) !== 0)) stats.renders++;
      if (fiber.child && before?.child !== fiber.child) walk(fiber.child);
    }
  };
  Object.assign(window, {
    __nenuRenders: stats,
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true, renderers: new Map(), inject: () => 1, checkDCE: () => {}, setStrictMode: () => {},
      onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => { stats.commits++; walk(root.current.child); },
    },
  });
}

/**
 * A project coordinator's chat (scenario.ts `projectChatSeed`): the phone's Chat, Threads and PRs
 * tabs at 390x844 and the desk at 1440x900 beside the project panel and without it, captured on the
 * pinned clock. Then the phone's Chat tab measured on the real clock, twice: DOM elements, and the
 * React commits and component renders over `--seconds` of polling.
 */
async function threads(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const shots: string[] = [];
  const windowMs = Number(values.seconds) * 1000;
  const result = await withBench(async (bridge, browser) => {
    const coordinator = `/pane/${encodeURIComponent(bridge.herd!.working)}`;
    const open = async (device: typeof PHONE | typeof DESKTOP, opts: { pinned: boolean; counted?: boolean }) => {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      if (opts.counted) await page.addInitScript(countRenders, null);
      if (opts.pinned) await page.clock.install({ time: bridge.now() });
      const requests: string[] = [];
      page.on("request", (req) => requests.push(req.url()));
      await page.goto(bridge.url + coordinator);
      await page.getByPlaceholder("Ask the coordinator…").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(2000);
      return { page, requests, close: () => context.close() };
    };
    const shoot = async (page: Page, name: string) => {
      const path = join(outDir, `${name}.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
    };
    const cards = (page: Page) => page.locator('section[aria-label="Threads"] article').count();

    const seen: Record<string, unknown> = {};
    {
      const { page, close } = await open(PHONE, { pinned: true });
      seen.phoneChatCards = await cards(page);
      await shoot(page, "phone-chat");
      for (const tab of ["Threads", "PRs"] as const) {
        await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
        await page.locator(".project-overlay").waitFor({ timeout: 5000 });
        await page.waitForTimeout(300);
        seen[`phone${tab}Rows`] = await page.locator(".project-overlay .task-main").count();
        await shoot(page, `phone-${tab.toLowerCase()}`);
      }
      await close();
    }
    {
      const { page, close } = await open(DESKTOP, { pinned: true });
      seen.desktopPanelCards = await cards(page);
      await shoot(page, "desktop-panel");
      await page.getByRole("button", { name: "Hide project panel" }).click();
      await page.waitForTimeout(500);
      seen.desktopNoPanelCards = await cards(page);
      await shoot(page, "desktop-no-panel");
      await close();
    }

    const runs = [];
    for (let run = 1; run <= 2; run++) {
      const { page, requests, close } = await open(PHONE, { pinned: false, counted: true });
      const dom = await page.evaluate(() => ({
        document: document.getElementsByTagName("*").length,
        thread: document.querySelector(".chat-thread")?.getElementsByTagName("*").length ?? 0,
      }), null);
      const from = requests.length;
      await page.evaluate(() => Object.assign((window as unknown as { __nenuRenders: object }).__nenuRenders, { commits: 0, renders: 0 }), null);
      await page.waitForTimeout(windowMs);
      const react = await page.evaluate(() => ({ ...(window as unknown as { __nenuRenders: { commits: number; renders: number } }).__nenuRenders }), null);
      const byRoute = tally(requests.slice(from));
      const polls = byRoute.snapshot ?? 0;
      runs.push({ run, cards: await cards(page), dom, seconds: windowMs / 1000, ...react, byRoute,
        rendersPerCommit: react.commits ? Math.round(react.renders / react.commits) : 0,
        rendersPerSnapshot: polls ? Math.round(react.renders / polls) : null });
      await close();
    }
    return { shots, seen, runs, unexpectedWrites: bridge.fake!.writes() };
  }, CAPTURE_EPOCH, (herd, now) => projectChatSeed(herd, now));
  await writeFile(join(outDir, "threads.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.unexpectedWrites.length) process.exit(1);
}

/**
 * Closing what is on screen, on a phone and a desk: the open pane's tab from Nenu (its actions
 * sheet) and from Herdr (the fake closes it while the page shows it), and the open pane beside a
 * sibling. The demo's `nenu` space holds `redesign`
 * (working) then `review` (idle); throwaway tabs go after them, so `review` is where a close lands.
 * Then the first tab closes (lands on the next one) and the only tab of `api` closes (lands Home).
 */
async function tabs(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const fake = bridge.fake!;
    const herd = bridge.herd!;
    const cases: Array<{ name: string; expected: string; landed: string }> = [];
    const pathname = (page: Page) => page.evaluate(() => decodeURIComponent(location.pathname), null);
    const sheetClose = (band: "tabs" | "panes", row: "Close tab" | "Close pane") => async (page: Page) => {
      await page.locator(`[data-workbench-navigation-band="${band}"] button[aria-current="true"]`).click();
      await page.getByRole("button", { name: row, exact: true }).click({ timeout: 5000 });
      // The row asks first: its confirmation's button carries the row's name and ignores taps for
      // its first 500 ms (action-sheet-rows.tsx), so a double tap closes nothing.
      await page.getByRole("heading", { name: /^Close “/ }).waitFor({ timeout: 5000 });
      await page.waitForTimeout(700);
      await page.getByRole("button", { name: row, exact: true }).click({ timeout: 5000 });
    };
    const inHerdr = (tabId: string) => async () => fake.closeTab(tabId);

    const run = async (name: string, device: typeof PHONE | typeof DESKTOP, path: string, close: (page: Page) => Promise<void>, expected: string) => {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      await page.goto(bridge.url + path);
      await page.locator('[data-workbench-navigation-band="tabs"] button[aria-current="true"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1000);
      await close(page);
      for (let i = 0; i < 100 && (await pathname(page)) !== expected; i++) await sleep(100);
      // Settle: a second hop (a stale snapshot bouncing Home) would land within a poll.
      await page.waitForTimeout(2500);
      cases.push({ name, expected, landed: await pathname(page) });
      await page.screenshot({ path: join(outDir, `${name}.png`), animations: "disabled" });
      await context.close();
    };
    // Adding a pane emits no event, so wait for the bridge's next poll to list it before opening it.
    const scratchTab = async (n: number) => {
      const tabId = `w1:t${n}`;
      const paneId = `w1:scratch${n}`;
      fake.addTab(tabId, `scratch ${n}`).addPane({ paneId, workspaceId: "w1", tabId, agent: null, label: `Scratch ${n}`, cwd: bridge.dir });
      for (let i = 0; i < 150; i++) {
        const snap = await fetch(`${bridge.url}/api/snapshot`).then((r) => r.json() as Promise<{ shellPanes: Array<{ paneId: string }> }>);
        if (snap.shellPanes.some((p) => p.paneId === paneId)) return { tabId, path: `/pane/${encodeURIComponent(paneId)}` };
        await sleep(100);
      }
      throw new Error(`the bridge never listed ${paneId}`);
    };

    const review = `/pane/${herd.idle}`;
    let n = 3;
    for (const [device, deviceName] of [[PHONE, "phone"], [DESKTOP, "desktop"]] as const) {
      const nenu = await scratchTab(n++);
      await run(`last-tab-nenu-${deviceName}`, device, nenu.path, sheetClose("tabs", "Close tab"), review);
      const herdr = await scratchTab(n++);
      await run(`last-tab-herdr-${deviceName}`, device, herdr.path, inHerdr(herdr.tabId), review);
    }
    // `server` holds Blocked Claude, Codex and a shell: closing the shell keeps you in the tab.
    await run("sibling-pane-nenu-phone", PHONE, `/pane/${encodeURIComponent(herd.shell)}`, sheetClose("panes", "Close pane"), `/pane/${herd.blocked}`);
    await run("first-tab-herdr-phone", PHONE, `/pane/${encodeURIComponent(herd.working)}`, inHerdr("w1:t1"), review);
    await run("only-tab-nenu-desktop", DESKTOP, `/pane/${encodeURIComponent(herd.blocked)}`, sheetClose("tabs", "Close tab"), "/");
    const closes = fake.writes().filter((c) => c.method.endsWith(".close")).map((c) => `${c.method} ${String(c.params.tab_id ?? c.params.pane_id)}`);
    return { cases, failed: cases.filter((c) => c.landed !== c.expected).map((c) => c.name), closes };
  }, CAPTURE_EPOCH);
  await writeFile(join(outDir, "tabs.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length) process.exit(1);
}

/**
 * Opening a workspace from every way in, on a desk and a phone: the sidebar row, search (⌘K on the
 * desk), the folded rail, the phone's Browse, and a `/space/:id` link from an older Nenu. Each must
 * land on the pane the workspace opens on (lib/spaces.ts workspaceEntry): `api` on its blocked
 * agent, `nenu` on the first pane of Herdr's active tab, `docs` (one pane) on it, and `ops` on
 * the vpn shell the operator had open last.
 */
async function workspace(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const fake = bridge.fake!;
    const herd = bridge.herd!;
    fake.addWorkspace("w3", "docs").addTab("w3:t1", "1")
      .addPane({ paneId: "w3:solo", workspaceId: "w3", tabId: "w3:t1", agent: "claude", label: "Docs refresh", cwd: join(bridge.dir, "docs") });
    await addOps(bridge);
    const expected: Record<string, string> = { nenu: `/pane/${herd.working}`, api: `/pane/${herd.blocked}`, docs: "/pane/w3:solo", ops: "/pane/w4:vpn" };
    const ids: Record<string, string> = { nenu: "w1", api: "w2", docs: "w3", ops: "w4" };
    const pathname = (page: Page) => page.evaluate(() => decodeURIComponent(location.pathname), null);
    const landed: Array<{ entry: string; workspace: string; expected: string; landed: string }> = [];
    const shots: string[] = [];
    const row = (scope: string, name: string) => `${scope} section[aria-label="${name}"] a.nav-row`;
    type Entry = (page: Page, name: string) => Promise<void>;
    const entries: Record<"desktop" | "phone", Array<[string, Entry]>> = {
      desktop: [
        ["sidebar", (page, name) => page.locator(row('aside[aria-label="Workspace sidebar"]', name)).click()],
        ["search", async (page, name) => {
          await page.keyboard.press("Meta+k");
          await page.getByRole("searchbox").fill(name);
          await page.locator(row('aside[aria-label="Workspace sidebar"]', name)).click();
        }],
        ["rail", async (page, name) => {
          // The fold persists, so it is set once and the page reloads onto the rail.
          await page.evaluate(() => localStorage.setItem("nenu:sidebar-collapsed:v1", "1"), null);
          await page.goto(`${bridge.url}/`);
          await page.locator(`nav[aria-label="Collapsed sidebar"] a[aria-label="${name}"]`).click();
        }],
        ["old-link", (page, name) => page.goto(`${bridge.url}/space/${ids[name]}`).then(() => undefined)],
      ],
      phone: [
        ["browse", async (page, name) => {
          await page.getByRole("button", { name: "Browse" }).click();
          await page.locator(row("[role=dialog]", name)).click();
        }],
        ["search", async (page, name) => {
          await page.getByRole("button", { name: "Search" }).click();
          await page.getByRole("searchbox").fill(name);
          await page.locator(row("[role=dialog]", name)).click();
        }],
        ["old-link", (page, name) => page.goto(`${bridge.url}/space/${ids[name]}`).then(() => undefined)],
      ],
    };

    for (const [deviceName, device] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      // The operator had ops' vpn shell open, so the bridge holds it as the pane last seen there.
      await page.goto(`${bridge.url}/pane/${encodeURIComponent("w4:vpn")}`);
      await page.locator('[data-workbench-navigation-band="tabs"]').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      for (const [entry, open] of entries[deviceName]) {
        for (const name of Object.keys(expected)) {
          await page.goto(`${bridge.url}/`);
          await page.locator("h1").first().waitFor({ timeout: 15_000 });
          await page.waitForTimeout(300);
          let at = "";
          try {
            await open(page, name);
            for (let i = 0; i < 100 && (at = await pathname(page)) !== expected[name]; i++) await sleep(100);
          } catch (error) {
            at = `error: ${(error as Error).message.split("\n")[0]}`;
          }
          landed.push({ entry: `${deviceName}/${entry}`, workspace: name, expected: expected[name]!, landed: at });
          if (name === "ops" && entry === entries[deviceName][0]![0]) {
            await page.locator('[data-workbench-navigation-band="tabs"]').first().waitFor({ timeout: 15_000 });
            await page.waitForTimeout(1200);
            const shot = join(outDir, `ops-${deviceName}.png`);
            await page.screenshot({ path: shot, animations: "disabled" });
            shots.push(shot);
          }
        }
      }
      await context.close();
    }
    return { shots, landed, failed: landed.filter((c) => c.landed !== c.expected), unexpectedWrites: fake.writes() };
  }, CAPTURE_EPOCH);
  await writeFile(join(outDir, "workspace.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, landed: result.landed.length }, null, 2));
  if (result.failed.length || result.unexpectedWrites.length) process.exit(1);
}

/** A workspace of two tabs, as Herdr leaves them: an agent in the unlabelled tab "1", a shell in "vpn". */
async function addOps(bridge: TestBridge): Promise<void> {
  bridge.fake!.addWorkspace("w4", "ops").addTab("w4:t1", "1").addTab("w4:t2", "vpn")
    .addPane({ paneId: "w4:agent", workspaceId: "w4", tabId: "w4:t1", agent: "claude", label: "Search metrics", cwd: join(bridge.dir, "ops") })
    .addPane({ paneId: "w4:vpn", workspaceId: "w4", tabId: "w4:t2", agent: null, label: "vpn", cwd: join(bridge.dir, "ops") });
  bridge.fake!.setStatus("w4:agent", "working");
  for (let i = 0; i < 150; i++) {
    const snap = await fetch(`${bridge.url}/api/snapshot`).then((r) => r.json() as Promise<{ shellPanes: Array<{ paneId: string }> }>);
    if (snap.shellPanes.some((p) => p.paneId === "w4:vpn")) return;
    await sleep(100);
  }
  throw new Error("the bridge never listed ops");
}

/**
 * Every page at the widths a desk shows it (1280, 1440 and 1920, the sidebar open and folded), on a
 * tablet and on a phone, with the header's height and where its title and the content column sit (layout.json): Home, a
 * project, a node, Settings, a workspace and a workspace pane's chat, then a coordinator's chat
 * beside the project panel.
 */
async function layout(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  // 900 is a tablet: no sidebar yet, the phone's navigation, a desk's gutter.
  const variants: Array<[string, Record<string, unknown>, boolean]> = [["390", PHONE, false], ["900", { ...DESKTOP, viewport: { width: 900, height: 900 } }, false]];
  for (const width of [1280, 1440, 1920]) {
    for (const folded of [false, true]) variants.push([`${width}-${folded ? "folded" : "open"}`, { ...DESKTOP, viewport: { width, height: 900 } }, folded]);
  }
  const tabBar = '[data-workbench-navigation-band="tabs"]';
  const measures: Record<string, unknown> = {};
  const capture = async (bridge: TestBridge, browser: Browser, pages: Array<[string, string, string]>) => {
    for (const [variant, device, folded] of variants) {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      if (folded) await page.addInitScript(() => localStorage.setItem("nenu:sidebar-collapsed:v1", "1"), null);
      for (const [name, path, ready] of pages) {
        await page.goto(bridge.url + path);
        await page.locator(ready).first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(1200);
        const shot = `${name}-${variant}`;
        await page.screenshot({ path: join(outDir, `${shot}.png`), animations: "disabled" });
        measures[shot] = await page.evaluate(() => {
          const box = (el: Element | null) => {
            if (!el) return null;
            const { left, right } = el.getBoundingClientRect();
            return { left: Math.round(left), right: Math.round(right), width: Math.round(right - left) };
          };
          return {
            path: decodeURIComponent(location.pathname),
            header: Math.round(document.querySelector(".workbench-app-header")?.getBoundingClientRect().height ?? 0),
            pane: box(document.querySelector(".workbench-main")),
            title: box(document.querySelector(".workbench-app-header .flex-1 > *")),
            column: box(document.querySelector("main > div")),
          };
        }, null);
      }
      await context.close();
    }
  };
  await withBench(async (bridge, browser) => {
    await addOps(bridge);
    await capture(bridge, browser, [
      ["home", "/", "h1"],
      ["project", "/project/acme", 'main >> text="Panel depósito"'],
      ["node", "/project/acme/node/t-0101", 'main >> text="Migración de stock"'],
      ["settings", "/settings", "text=Push notifications"],
      ["workspace", "/space/w4", `main:has-text("ops"), ${tabBar}`],
      ["chat", "/pane/w4%3Aagent", tabBar],
    ]);
  }, CAPTURE_EPOCH, (herd, now) => orgTreeSeed(herd, now));
  await withBench(async (bridge, browser) => {
    await capture(bridge, browser, [["coordinator", `/pane/${encodeURIComponent(bridge.herd!.codex)}`, 'aside[aria-label="Project"]:has-text("Panel depósito"), [role=tab]:has-text("Threads")']]);
  }, CAPTURE_EPOCH, (herd, now) => orgTreeSeed(herd, now, { coordinator: true }));
  await writeFile(join(outDir, "layout.json"), JSON.stringify(measures, null, 2));
  console.log(`[e2e] ${Object.keys(measures).length} captures in ${outDir}`);
}

/**
 * Stop on a working Claude, on a phone and a desk: the composer while it works (empty, then with a
 * draft), "Stopping…", and the composer once the pane is idle. The phone taps Stop twice and fires two
 * interrupts at once, and must still press Escape once; the desk stops with Esc in the empty composer.
 * The phone also queues a message for after the turn first: Stop must leave it held, not delivered.
 * A build without Stop records `stop: false` and keeps the first two captures, so the same command
 * shows the before.
 */
async function stop(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const fake = bridge.fake!;
    const pane = bridge.herd!.working;
    // Long enough to see "Stopping…"; a real Claude goes idle ~300 ms after Escape.
    fake.interruptMs = 2500;
    const shots: string[] = [];
    const runs: Array<Record<string, unknown>> = [];
    // The desk first: the phone's queued row is still listed when a later device opens the pane.
    for (const [deviceName, device] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
      fake.setStatus(pane, "working");
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      await page.goto(`${bridge.url}/pane/${encodeURIComponent(pane)}`);
      const box = page.getByRole("textbox").first();
      await box.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      const shot = async (name: string) => {
        const path = join(outDir, `stop-${name}-${deviceName}.png`);
        await page.screenshot({ path, animations: "disabled" });
        shots.push(path);
      };
      await shot("working");
      await box.fill("Also run the tests before you finish");
      await page.waitForTimeout(400);
      await shot("working-draft");
      const run: Record<string, unknown> = { device: deviceName };
      runs.push(run);
      let queued = 0;
      if (deviceName === "phone") {
        // Queued for after the turn, the row waits in Nenu while Claude works.
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page.getByRole("button", { name: /Queue for later/ }).click({ timeout: 5000 });
        queued = fake.submitted.length;
        await page.waitForTimeout(800);
      } else {
        await box.fill("");
      }
      const stopButton = page.getByRole("button", { name: "Stop", exact: true });
      run.stop = await stopButton.waitFor({ timeout: 3000 }).then(() => true, () => false);
      if (!run.stop) {
        await context.close();
        continue;
      }
      const before = fake.interrupted.length;
      if (deviceName === "phone") {
        await stopButton.click();
        await stopButton.click({ timeout: 300 }).catch(() => {});
        // Two requests racing past the button, as two devices would.
        run.racing = await page.evaluate(async (id: string) => {
          const post = () => fetch(`/api/pane/${encodeURIComponent(id)}/interrupt`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
          return Promise.all([post(), post()]);
        }, pane);
      } else {
        await box.press("Escape");
      }
      run.stopping = await page.getByText("Stopping…").first().waitFor({ timeout: 2000 }).then(() => true, () => false);
      await shot("stopping");
      for (let i = 0; i < 100 && fake.screen(pane).includes("esc to interrupt"); i++) await sleep(100);
      await page.waitForTimeout(2000);
      await shot("stopped");
      run.escapes = fake.interrupted.length - before;
      run.stopAfterIdle = await stopButton.isVisible();
      if (deviceName === "phone") {
        // Held, not delivered: nothing new was submitted since the row was queued.
        run.heldUndelivered = fake.submitted.length === queued;
        run.held = await page.getByText(/^Held/).first().waitFor({ timeout: 3000 }).then(() => true, () => false);
      }
      await context.close();
    }
    const failed = runs.filter((r) => r.stop && (r.escapes !== 1 || !r.stopping || r.stopAfterIdle || r.heldUndelivered === false)).map((r) => r.device);
    return { shots, runs, failed, writes: fake.writes().map((c) => `${c.method} ${JSON.stringify(c.params.keys ?? c.params.text ?? "")}`) };
  }, CAPTURE_EPOCH);
  await writeFile(join(outDir, "stop.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length) process.exit(1);
}

/**
 * A working Claude with background work: a running workflow, a subagent waiting on you, one running,
 * a background command and a monitor. The bridge's activity and subagent readers are unit-tested over
 * real (redacted) session files, so here their answers are fixed (web/src/components/activity
 * fixture, shifted to the capture instant) and the bench looks at how the chat shows them: the chat,
 * the processes list, a row expanded, a workflow's details, the ⋯ menu and the composer typing while
 * the agent works, then everything finished: the quiet chip and its Done list. On a desk it also
 * checks that Esc in the empty composer closes the details panel without sending anything. Run on a build without the chip, it captures the same moments the old way (cards in
 * the chat, the Activity sheet, the full-screen workflow), so one command shows before and after.
 */
async function processes(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const fixture = JSON.parse(await Bun.file(join(import.meta.dir, "../../web/src/components/activity/activity.fixture.json")).text());
  const result = await withBench(async (bridge, browser) => {
    const pane = bridge.herd!.working;
    const now = bridge.now();
    const shift = now - fixture.now;
    const shiftTimes = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shiftTimes);
      if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, (k === "startedAt" || k === "updatedAt" || k === "at") && typeof v === "number" ? v + shift : shiftTimes(v)]));
      }
      return value;
    };
    const list = shiftTimes(fixture.list) as { workflows: unknown[]; tasks: unknown[] };
    list.tasks = [
      { id: "b0001", kind: "bash", title: "bun test --watch", status: "running", at: now - 8_000, hasOutput: true },
      { id: "m0001", kind: "monitor", title: "Monitor CI checks", status: "running", at: now - 60_000, hasOutput: false },
      { id: "b0002", kind: "bash", title: "bun run build", status: "completed", exitCode: 0, at: now - 900_000, hasOutput: true },
      ...list.tasks,
    ];
    const detail = shiftTimes(fixture.detail);
    const iso = (ago: number) => new Date(now - ago).toISOString();
    const subagents = {
      available: true, sessionKey: "bench", truncated: false, agents: [
        { id: "a0000000000000001", parentId: "", name: "reviewer", task: "Review the processes chip diff", model: "claude-opus-5-5[1m]", status: "waiting", updatedAt: iso(120_000) },
        { id: "a0000000000000002", parentId: "", name: "state-reader", task: "Read how Stop decides a turn runs", model: "claude-opus-5-5[1m]", status: "running", updatedAt: iso(20_000) },
        { id: "a0000000000000003", parentId: "", name: "ui-audit", task: "Audit the composer row", status: "completed", updatedAt: iso(1_800_000) },
      ],
    };
    // Everything above, finished: what the chip offers once nothing waits or runs.
    const finishedList = { ...list, workflows: (list.workflows as Array<Record<string, unknown>>).map((w) => ({ ...w, status: w.status === "running" ? "completed" : w.status, durationMs: w.durationMs ?? 600_000 })),
      tasks: (list.tasks as Array<Record<string, unknown>>).map((t) => ({ ...t, status: t.status === "running" ? "completed" : t.status })) };
    const finishedSubagents = { ...subagents, agents: subagents.agents.map((a) => ({ ...a, status: "completed" })) };
    let finished = false;
    const shots: string[] = [];
    const found: Record<string, Record<string, boolean>> = {};
    const devices: Array<[string, Record<string, unknown>]> = [
      ["1440", DESKTOP], ["1920", { ...DESKTOP, viewport: { width: 1920, height: 1080 } }], ["390", PHONE],
    ];
    for (const [deviceName, device] of devices) {
      bridge.fake!.setStatus(pane, "working");
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: now });
      await page.route("**/api/pane/*/activity*", (route) => {
        const url = new URL(route.request().url());
        const run = url.searchParams.get("run");
        if (run) {
          const workflow = (list as { workflows: Array<{ runId: string }> }).workflows.find((w) => w.runId === run);
          return route.fulfill(workflow ? { json: run === (detail as { workflow: { runId: string } }).workflow.runId ? detail : { sessionKey: "bench", workflow, results: {} } } : { status: 404 });
        }
        if (url.searchParams.has("task")) return route.fulfill({ json: { sessionKey: "bench", id: url.searchParams.get("task"), text: "✓ 412 pass\n  0 fail\nwatching for changes…", truncated: false, updatedAt: now } });
        return route.fulfill({ json: finished ? finishedList : list });
      });
      await page.route("**/api/pane/*/subagents*", (route) => route.fulfill({ json: finished ? finishedSubagents : subagents }));
      finished = false;
      const writes: string[] = [];
      page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/pane/")) writes.push(new URL(request.url()).pathname); });
      await page.goto(`${bridge.url}/pane/${encodeURIComponent(pane)}`);
      const box = page.getByRole("textbox").first();
      await box.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1800);
      const seen: Record<string, boolean> = {};
      found[deviceName] = seen;
      const shot = async (name: string) => {
        const path = join(outDir, `processes-${name}-${deviceName}.png`);
        await page.screenshot({ path, animations: "disabled" });
        shots.push(path);
      };
      const tap = async (locator: Locator, key: string) => {
        seen[key] = await locator.waitFor({ timeout: 2500 }).then(() => true, () => false);
        if (seen[key]) await locator.click();
        await page.waitForTimeout(500);
        return seen[key];
      };
      await shot("chat");
      if (await tap(page.getByRole("button", { name: /^Processes/ }).first(), "chip")) {
        await shot("list");
        if (await tap(page.getByRole("button", { name: "Expand nenu-wave" }).first(), "expand")) await shot("expanded");
        if (await tap(page.getByRole("button", { name: "Details of nenu-wave" }).first(), "details")) await shot("details");
        const panel = page.getByRole("complementary", { name: /^Details/ });
        if (await panel.isVisible()) {
          // Esc in the empty composer closes the desk's panel first; it must not stop the turn.
          await box.click();
          const before = writes.length;
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
          seen.escClosesPanel = !(await panel.isVisible());
          seen.escSentNothing = writes.length === before;
        } else {
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
        }
      } else {
        // The build before the chip: the Activity sheet behind ⋯, and a workflow full screen.
        if (await tap(page.getByRole("button", { name: "Conversation actions" }).first(), "menu-old")) {
          if (await tap(page.getByRole("button", { name: "Background activity" }).first(), "activity-sheet")) await shot("list");
          await page.keyboard.press("Escape");
        }
        if (await tap(page.getByRole("button", { name: /View workflow/ }).first(), "workflow-screen")) {
          await shot("details");
          await tap(page.getByRole("button", { name: "Back" }).first(), "back");
        }
      }
      await page.waitForTimeout(300);
      if (await tap(page.getByRole("button", { name: "Conversation actions" }).first(), "menu")) {
        await shot("menu");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
      await box.fill("Also run the tests before you finish");
      await page.waitForTimeout(500);
      await shot("typing");
      seen.stopWhileTyping = await page.getByRole("button", { name: "Stop", exact: true }).isVisible();
      seen.sendWhileTyping = await page.getByRole("button", { name: "Send", exact: true }).isVisible();
      await box.fill("");
      await page.waitForTimeout(400);
      seen.stopEmpty = await page.getByRole("button", { name: "Stop", exact: true }).isVisible();
      seen.sendEmpty = await page.getByRole("button", { name: "Send", exact: true }).isVisible();
      finished = true;
      bridge.fake!.setStatus(pane, "idle");
      await page.goto(`${bridge.url}/pane/${encodeURIComponent(pane)}`);
      await box.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1800);
      const quiet = page.getByRole("button", { name: /^Processes/ }).first();
      seen.quietChip = await quiet.waitFor({ timeout: 2500 }).then(() => true, () => false);
      seen.quietChipText = await page.getByRole("button", { name: /^Processes: \d+ done$/ }).first().isVisible();
      await shot("finished");
      if (await tap(quiet, "quietOpens") && await tap(page.getByRole("button", { name: /^Done \(\d+\)$/ }).first(), "doneFold")) await shot("finished-list");
      await context.close();
    }
    return { shots, found };
  }, CAPTURE_EPOCH);
  await writeFile(join(outDir, "processes.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Stop decided by the CLI's own state (ADR 0067). The working Claude pane draws a custom statusline,
 * so its screen never says "esc to interrupt", and its session file (`<profile>/sessions/<pid>.json`)
 * says busy. Phone: Stop shows and presses Escape once, confirmed when the file goes idle. Then the
 * file stays busy while the transcript says the main turn ended (a background agent): Herdr still
 * says working, Stop must not show, and a forced Stop must press nothing.
 */
async function stopState(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const fake = bridge.fake!;
    const pane = bridge.herd!.working;
    const pid = 424242;
    const sessionId = "6f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
    const sessions = join(bridge.dir, "journals", "sessions");
    const transcript = join(bridge.dir, "journals", "claude", "-bench-stop-state", `${sessionId}.jsonl`);
    await mkdir(sessions, { recursive: true });
    await mkdir(join(transcript, ".."), { recursive: true });
    const writeSession = (status: string, statusUpdatedAt: number) =>
      writeFile(join(sessions, `${pid}.json`), JSON.stringify({ pid, sessionId, kind: "interactive", version: "2.1.296", status, statusUpdatedAt, updatedAt: statusUpdatedAt }));
    const busyAt = Date.now();
    await writeFile(transcript, JSON.stringify({ type: "user", timestamp: new Date(busyAt + 5).toISOString(), message: { role: "user", content: "write an essay" } }) + "\n");
    await writeSession("busy", busyAt);
    fake.customStatusline.add(pane);
    fake.processes.set(pane, [{ pid, argv: ["claude"] }]);
    fake.interruptMs = 300;
    fake.setStatus(pane, "working");
    // A real Claude flips its session file idle 12-21 ms after Escape (measured); the fake pane goes idle after interruptMs.
    const stopWatch = setInterval(() => {
      if (fake.interrupted.length > 0 && !idleWritten) { idleWritten = true; void writeSession("idle", Date.now()); }
    }, 20);
    let idleWritten = false;
    const run: Record<string, unknown> = {};
    const shots: string[] = [];
    try {
      const context = await browser.newContext({ ...PHONE, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.goto(`${bridge.url}/pane/${encodeURIComponent(pane)}`);
      await page.getByRole("textbox").first().waitFor({ timeout: 15_000 });
      const stopButton = page.getByRole("button", { name: "Stop", exact: true });
      run.hintOnScreen = fake.screen(pane).includes("esc to interrupt");
      run.stopShown = await stopButton.waitFor({ timeout: 5000 }).then(() => true, () => false);
      const shot = async (name: string) => { const path = join(outDir, `stop-state-${name}-phone.png`); await page.screenshot({ path, animations: "disabled" }); shots.push(path); };
      await shot("working");
      if (run.stopShown) await stopButton.click();
      await page.waitForTimeout(1500);
      await shot("stopped");
      run.escapes = fake.interrupted.length;
      run.turnAfter = await page.evaluate(async (id: string) => {
        const snapshot = await (await fetch("/api/snapshot")).json() as { agents: Array<{ paneId: string; turn?: unknown }> };
        return snapshot.agents.find((agent) => agent.paneId === id)?.turn ?? null;
      }, pane);
      run.stopAfterIdle = await stopButton.isVisible();

      // Background only: busy, and the main chain's last assistant row ended the turn inside this busy
      // spell. No turn_duration: Claude holds it back while teammates or detached tool calls run.
      clearInterval(stopWatch);
      const bgAt = Date.now();
      await writeSession("busy", bgAt);
      await writeFile(transcript, [
        { type: "user", timestamp: new Date(bgAt + 5).toISOString(), message: { role: "user", content: "launch a background agent" } },
        { type: "assistant", timestamp: new Date(bgAt + 50).toISOString(), message: { role: "assistant", stop_reason: "end_turn", content: [] } },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n");
      fake.setStatus(pane, "working");
      await page.waitForTimeout(2500);
      run.backgroundStopShown = await stopButton.isVisible();
      run.backgroundNote = await page.getByText("Background work is running. Stop doesn't reach it.").isVisible();
      await shot("background");
      // A background agent's permission prompt, answered: waiting, then busy again with a later timestamp.
      await writeSession("waiting", Date.now());
      await page.waitForTimeout(400);
      await writeSession("busy", Date.now());
      await page.waitForTimeout(1500);
      run.afterDialogStopShown = await stopButton.isVisible();
      run.backgroundForced = await page.evaluate(async (id: string) => (await fetch(`/api/pane/${encodeURIComponent(id)}/interrupt`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json(), pane);
      run.escapesAfterBackground = fake.interrupted.length;
      await context.close();
    } finally {
      clearInterval(stopWatch);
    }
    const turnAfter = run.turnAfter as { running?: boolean; source?: string } | null;
    const forced = run.backgroundForced as { ok?: boolean; code?: string } | null;
    const failed = [
      run.hintOnScreen ? "the screen showed the hint; the test proves nothing" : null,
      run.stopShown ? null : "Stop not shown for a busy session",
      turnAfter?.source === "claude-session" && turnAfter.running === false && !run.stopAfterIdle ? null : "the session file's idle did not reach the button",
      run.escapes === 1 ? null : `expected 1 Escape, got ${run.escapes}`,
      run.backgroundStopShown ? "Stop shown while only background work runs" : null,
      run.backgroundNote ? null : "no note says why Stop is missing during background work",
      run.afterDialogStopShown ? "Stop shown after a background agent's dialog was answered" : null,
      forced?.code === "not_running" && run.escapesAfterBackground === 1 ? null : "a forced Stop on background work pressed or answered wrongly",
    ].filter(Boolean);
    return { run, shots, failed };
  }, CAPTURE_EPOCH);
  await writeFile(join(outDir, "stop-state.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length) process.exit(1);
}

async function baseline(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const windowMs = Number(values.seconds) * 1000;
  const sends = Number(values.sends);

  const report = await withBench(async (bridge, browser) => {
    const fake = bridge.fake!;
    const herd = bridge.herd!;
    const stopJournal = tickJournal(herd.journals.get(herd.working)!, bridge.now);
    const out: Record<string, unknown> = {
      measuredAt: new Date().toISOString(),
      against: "FakeHerdr (bridge/test-support/fake-herdr.ts), demo herd in scripts/e2e/scenario.ts",
      browser: "WebKit (playwright-core 1.60.0, webkit-2287), iPhone viewport 390x844",
      windowSeconds: windowMs / 1000,
    };

    // 1. Socket calls the bridge makes on its own, with no browser attached.
    await sleep(3000);
    fake.resetCounts();
    let cpu0 = await cpuMs(bridge.pid);
    await sleep(windowMs);
    const idleCalls = fake.counts();
    out.noClients = {
      herdrCallsPerMinute: perMinute(idleCalls, windowMs),
      socketCallsPerPoll: Math.round((sum(idleCalls) / Math.max(1, idleCalls["session.snapshot"] ?? 0)) * 10) / 10,
      bridgeCpuPercent: Math.round(((await cpuMs(bridge.pid)) - cpu0) / windowMs * 1000) / 10,
    };

    // 2. One phone per view, measured over the same window after a warm-up.
    const views: Array<[string, string, { rawTerminal?: string }]> = [
      ["home", "/", {}],
      ["chatWorking", `/pane/${encodeURIComponent(herd.working)}`, {}],
      ["mirrorWorking", `/pane/${encodeURIComponent(herd.working)}`, { rawTerminal: herd.working }],
      ["dialogOnScreen", `/pane/${encodeURIComponent(herd.blocked)}`, {}],
    ];
    const perView: Record<string, unknown> = {};
    for (const [name, path, opts] of views) {
      const phone = await phonePage(browser, opts);
      await phone.page.goto(bridge.url + path);
      await sleep(5000);
      const from = Date.now();
      fake.resetCounts();
      cpu0 = await cpuMs(bridge.pid);
      await sleep(windowMs);
      const http = tally(phone.requests.filter((r) => r.at >= from).map((r) => r.url));
      perView[name] = {
        httpRequestsPerMinute: Math.round(sum(http) * 60_000 / windowMs),
        byRoute: perMinute(http, windowMs),
        herdrCallsPerMinute: perMinute(fake.counts(), windowMs),
        bridgeCpuPercent: Math.round(((await cpuMs(bridge.pid)) - cpu0) / windowMs * 1000) / 10,
      };
      await phone.close();
    }
    out.perPhone = perView;

    // 3. Tap Send to Enter on the idle Claude pane: the guarded reply's full client choreography.
    {
      const phone = await phonePage(browser);
      await phone.page.goto(bridge.url + `/pane/${encodeURIComponent(herd.idle)}`);
      const box = phone.page.getByPlaceholder("Type a reply…").first();
      await box.waitFor({ timeout: 15_000 });
      await sleep(2000);
      const samples: Array<{ tapToEnterMs: number; httpTrips: number; byRoute: Record<string, number> }> = [];
      for (let i = 0; i < sends; i++) {
        const text = `baseline send ${i + 1}`;
        await box.fill(text);
        const before = fake.submitted.length;
        const t0 = Date.now();
        await phone.page.getByRole("button", { name: "Send", exact: true }).click();
        while (fake.submitted.length === before && Date.now() - t0 < 15_000) await sleep(5);
        const enter = fake.submitted[before];
        if (!enter || enter.text !== text) throw new Error(`send ${i + 1} never reached Enter (saw ${JSON.stringify(enter)})`);
        const trips = tally(phone.requests.filter((r) => r.at >= t0 && r.at <= enter.at).map((r) => r.url));
        samples.push({ tapToEnterMs: enter.at - t0, httpTrips: sum(trips), byRoute: trips });
        await sleep(1500);
      }
      const ms = samples.map((s) => s.tapToEnterMs);
      out.send = { pane: "claude idle", runs: sends, p50Ms: pct(ms, 0.5), maxMs: Math.max(...ms), samples };
      await phone.close();
    }

    // 4. Answer the permission dialog from the pane view: HTTP trips from the tap to the key.
    {
      const phone = await phonePage(browser);
      await phone.page.goto(bridge.url + `/pane/${encodeURIComponent(herd.blocked)}`);
      const yes = phone.page.getByRole("button", { name: /^1\.?\s*Yes$|^Yes$/ }).first();
      await yes.waitFor({ timeout: 15_000 });
      await sleep(2000);
      const t0 = Date.now();
      await yes.click();
      while (fake.answered.length === 0 && Date.now() - t0 < 15_000) await sleep(5);
      const answer = fake.answered[0];
      if (!answer) throw new Error("the dialog answer never reached the fake terminal");
      await sleep(2000);
      const toKey = tally(phone.requests.filter((r) => r.at >= t0 && r.at <= answer.at).map((r) => r.url));
      const settled = tally(phone.requests.filter((r) => r.at >= t0).map((r) => r.url));
      out.dialogAnswer = {
        key: answer.key, tapToKeyMs: answer.at - t0,
        httpTripsToKey: sum(toKey), byRouteToKey: toKey,
        httpTripsWithin2sAfter: sum(settled), byRouteWithin2sAfter: settled,
      };
      await phone.close();
    }

    stopJournal();
    // The only writes this run drives: the sends on the idle pane and the dialog key on the blocked one.
    const expected = new Set([`pane.send_text ${herd.idle}`, `pane.send_keys ${herd.idle}`, `pane.send_keys ${herd.blocked}`]);
    out.unexpectedWrites = fake.writes().filter((c) => !expected.has(`${c.method} ${String(c.params.pane_id)}`));
    return out;
  });

  const file = join(outDir, "baseline.json");
  await writeFile(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n[e2e] baseline written to ${file}`);
}

/** Share of differing pixels between two same-size PNGs, decoded by WebKit itself. */
async function compare(a: string, b: string): Promise<void> {
  const browser = await launchWebkit();
  try {
    const page = await (await browser.newContext({})).newPage();
    const toUrl = async (p: string) => `data:image/png;base64,${Buffer.from(await Bun.file(p).arrayBuffer()).toString("base64")}`;
    const result = await page.evaluate(async ([ua, ub]: string[]) => {
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
      const [ia, ib] = await Promise.all([load(ua!), load(ub!)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { sameSize: false, differing: 1 };
      const pixels = (img: HTMLImageElement) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const pa = pixels(ia), pb = pixels(ib);
      let diff = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!) > 24) diff++;
      }
      return { sameSize: true, differing: diff / (pa.length / 4) };
    }, [await toUrl(a), await toUrl(b)]);
    console.log(JSON.stringify({ a, b, ...result, differingPercent: Math.round(result.differing * 10000) / 100 }));
  } finally {
    await browser.close();
  }
}

/**
 * A pull request's diff (scenario.ts `seedDiffRepo`): the working pane is a thread on PR #1342 whose
 * folder is the PR's worktree. Its size in the PR bar (phone) and in the PRs tab (desk) opens the
 * viewer, dark and light; then a commit past every limit (`growDiffRepo`) shows the cuts announced.
 * With `--before` it only captures the bar and the tab, for a build that has no viewer.
 */
/**
 * Why a thread needs you (scenario.ts `needsYouSeed`): one on a dialog, one that finished and said it
 * waits for your reply. The phone's Threads tab and Browse sheet, the desk's cards beside the sidebar,
 * then a tap on the waiting thread, which should land on its last message.
 */
async function needsYou(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const result = await withBench(async (bridge, browser) => {
    const herd = bridge.herd!;
    const ask = "The new copy is ready. Your call: ship it now, or wait for the design review first?";
    await writeJournal(herd.journals.get(herd.idle)!, [["user", "Rewrite the checkout copy"], ["assistant", "Rewriting the checkout copy."], ["assistant", ask]], bridge.now());
    bridge.fake!.appendLines(herd.idle, "", `● ${ask}`, "", "❯ ");
    const shots: string[] = [];
    const seen: Record<string, unknown> = {};
    const shoot = async (page: Page, name: string) => {
      const path = join(outDir, `${name}.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
    };
    const open = async (device: typeof PHONE | typeof DESKTOP) => {
      const context = await browser.newContext({ ...device, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      await page.clock.install({ time: bridge.now() });
      await page.goto(`${bridge.url}/pane/${encodeURIComponent(herd.working)}`);
      await page.getByPlaceholder("Ask the coordinator…").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1500);
      return { page, close: () => context.close() };
    };
    const text = (locator: Locator) => locator.innerText().then((t) => t.replace(/\s+/g, " ").trim());
    {
      const { page, close } = await open(PHONE);
      await page.getByRole("tab", { name: /^Threads/ }).click();
      await page.locator(".project-overlay").waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      for (const title of ["Checkout copy", "Payments panel"]) seen[`phoneRow ${title}`] = await text(page.locator(".project-overlay .task-main", { hasText: title }).first());
      await shoot(page, "phone-threads");
      await page.locator(".project-overlay .task-main", { hasText: "Checkout copy" }).first().click();
      await page.getByText(ask).last().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(800);
      seen.phoneTapLandsOn = decodeURIComponent(new URL(page.url()).pathname);
      seen.phoneLastMessageInView = await page.getByText(ask).last().isVisible();
      await shoot(page, "phone-tap-waiting");
      await close();
    }
    {
      // The tab bar lives on Home; a chat has none.
      const { page, close } = await open(PHONE);
      await page.goto(`${bridge.url}/`);
      await page.getByRole("button", { name: "Browse" }).click();
      const project = page.locator('[role=dialog] button[aria-label="Demo shop tasks"]');
      if (await project.count() && !(await page.locator('[role=dialog] .nav-tree-row', { hasText: "Checkout copy" }).count())) await project.click();
      await page.waitForTimeout(600);
      for (const title of ["Checkout copy", "Payments panel"]) seen[`phoneBrowse ${title}`] = await text(page.locator(".nav-tree-row", { hasText: title }).first()).catch(() => "(not shown)");
      await shoot(page, "phone-browse");
      await close();
    }
    {
      const { page, close } = await open(DESKTOP);
      const hide = page.getByRole("button", { name: "Hide project panel" });
      if (await hide.count()) await hide.click();
      await page.waitForTimeout(500);
      for (const title of ["Checkout copy", "Payments panel"]) {
        seen[`deskCard ${title}`] = await text(page.locator('section[aria-label="Threads"] article', { hasText: title }).first()).catch(() => "(no card)");
        seen[`deskSidebar ${title}`] = await text(page.locator(".nav-tree-row", { hasText: title }).first()).catch(() => "(not shown)");
      }
      await shoot(page, "desktop-cards");
      await close();
    }
    return { shots, seen, unexpectedWrites: bridge.fake!.writes() };
  }, CAPTURE_EPOCH, (herd, now) => needsYouSeed(herd, now));
  await writeFile(join(outDir, "needs-you.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.unexpectedWrites.length) process.exit(1);
}

async function diffs(before: boolean): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const shots: string[] = [];
  const requests: string[] = [];
  const prs = join(outDir, "gh-prs.json");
  process.env.NENU_E2E_GH_PRS = prs;
  let size = { additions: 0, deletions: 0 };
  const result = await withBench(async (bridge, browser) => {
    const open = async (device: typeof PHONE | typeof DESKTOP, path: string, ready: string, colorScheme: "dark" | "light" = "dark") => {
      const context = await browser.newContext({ ...device, colorScheme, timezoneId: "UTC", locale: "en-US" });
      const page = await context.newPage();
      page.on("request", (request) => { if (request.url().includes("/diff")) requests.push(new URL(request.url()).pathname + new URL(request.url()).search); });
      await page.clock.install({ time: bridge.now() });
      await page.goto(bridge.url + path);
      await page.locator(ready).first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      return { page, close: () => context.close() };
    };
    const shoot = async (page: Page, name: string) => {
      const path = join(outDir, `${name}.png`);
      await page.screenshot({ path, animations: "disabled" });
      shots.push(path);
    };
    const viewer = async (page: Page, name: string, file?: string, from: Page | Locator = page) => {
      await from.getByRole("button", { name: /^View changes/ }).first().click();
      const dialog = page.getByRole("dialog", { name: "PR #1342 changes" });
      await dialog.getByText(/^\d+ files?$/).waitFor({ timeout: 15_000 });
      if (file) await dialog.getByRole("button", { name: new RegExp(file) }).click();
      await page.waitForTimeout(400);
      await shoot(page, name);
      return dialog;
    };
    const chat = `/pane/${encodeURIComponent(bridge.herd!.working)}`;
    const bar = 'text="#1342"';

    for (const [name, device] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
      const { page, close } = await open(device, chat, bar);
      await shoot(page, `bar-${name}`);
      if (!before) await viewer(page, `viewer-${name}`, "app/checkout\\.tsx");
      await close();
    }
    {
      const { page, close } = await open(DESKTOP, chat, bar);
      await page.getByRole("tab", { name: "PRs" }).click();
      await page.waitForTimeout(400);
      await shoot(page, "prs-tab-desktop");
      if (!before) await viewer(page, "viewer-from-prs-tab-desktop", "app/cart\\.ts", page.getByRole("tabpanel", { name: "PRs" }));
      await close();
    }
    if (!before) {
      const { page, close } = await open(PHONE, chat, bar, "light");
      await viewer(page, "viewer-phone-light", "app/checkout\\.tsx");
      await close();
      growDiffRepo(bridge.dir);
      for (const [name, device] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
        const { page, close } = await open(device, chat, bar);
        const dialog = await viewer(page, `truncated-${name}`);
        // Down to where the 1 MB cut fell: the first file past it keeps only its counts.
        await dialog.getByText("Past the size limit").first().waitFor();
        await page.evaluate(() => Array.from(document.querySelectorAll("span")).find((span) => span.textContent?.endsWith("Past the size limit"))?.closest("li")?.previousElementSibling?.scrollIntoView({ block: "start" }), null);
        await page.waitForTimeout(300);
        await shoot(page, `truncated-cut-${name}`);
        await close();
      }
    }
    return { shots, diffRequests: requests, unexpectedWrites: bridge.fake!.writes() };
  }, CAPTURE_EPOCH, (herd, now) => diffOrg(herd, now, size), (dir) => {
    size = seedDiffRepo(dir);
    writeFileSync(prs, JSON.stringify([{
      number: 1342, title: "Landing a 390 px", url: "https://github.com/acme/shop/pull/1342", headRefName: "e2e-demo", baseRefName: "main",
      isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [], ...size, updatedAt: new Date(CAPTURE_EPOCH).toISOString(),
    }]));
  });
  await writeFile(join(outDir, "diffs.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.unexpectedWrites.length) process.exit(1);
}

/**
 * Home over a neutral project (homeOrg) and two pull requests from GitHub, one on the working pane's
 * branch and one on a branch no pane is on: phone and desk, dark and light, then each list the
 * Recents / Workspaces control offers (when the build has it), then a phone's requests on Home over
 * `--seconds`, after a 5 s warm-up.
 */
async function home(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const prs = join(outDir, "gh-prs.json");
  process.env.NENU_E2E_GH_PRS = prs;
  let size = { additions: 0, deletions: 0 };
  const windowMs = Number(values.seconds) * 1000;
  const result = await withBench(async (bridge, browser) => {
    const shots: string[] = [];
    const stopJournal = tickJournal(bridge.herd!.journals.get(bridge.herd!.working)!, bridge.now);
    try {
      const open = async (device: typeof PHONE | typeof DESKTOP, colorScheme: "dark" | "light") => {
        const context = await browser.newContext({ ...device, colorScheme, timezoneId: "UTC", locale: "en-US" });
        const page = await context.newPage();
        await page.clock.install({ time: bridge.now() });
        await page.goto(bridge.url + "/");
        await page.locator("main").getByText("Checkout flow").first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(1500);
        return { page, close: () => context.close() };
      };
      const shoot = async (page: Page, name: string) => {
        const path = join(outDir, `${name}.png`);
        await page.screenshot({ path, animations: "disabled" });
        shots.push(path);
      };
      for (const [name, device] of [["phone", PHONE], ["desktop", DESKTOP]] as const) {
        for (const scheme of ["dark", "light"] as const) {
          const { page, close } = await open(device, scheme);
          await shoot(page, `home-${name}-${scheme}`);
          // The list itself, scrolled into view: the Recents / Workspaces control, else the older "Recent".
          await page.evaluate(() => (document.querySelector('[role="tablist"][aria-label="Sessions"]') ?? document.getElementById("home-recent"))?.scrollIntoView({ block: "start" }), null);
          await page.waitForTimeout(300);
          await shoot(page, `home-${name}-${scheme}-list`);
          const workspaces = page.getByRole("tab", { name: "Workspaces" });
          if (scheme === "dark" && await workspaces.count()) {
            await workspaces.click();
            await page.waitForTimeout(400);
            await shoot(page, `home-${name}-workspaces`);
          }
          await close();
        }
      }
      const phone = await phonePage(browser);
      await phone.page.goto(bridge.url + "/");
      await sleep(5000);
      const from = Date.now();
      await sleep(windowMs);
      const http = tally(phone.requests.filter((r) => r.at >= from).map((r) => r.url));
      await phone.close();
      return {
        shots, windowSeconds: windowMs / 1000,
        homeRequestsPerMinute: Math.round(sum(http) * 60_000 / windowMs), byRoute: perMinute(http, windowMs),
        unexpectedWrites: bridge.fake!.writes(),
      };
    } finally {
      stopJournal();
    }
  }, CAPTURE_EPOCH, (herd, now) => homeOrg(herd, now, size), (dir) => {
    size = seedDiffRepo(dir);
    const at = new Date(CAPTURE_EPOCH).toISOString();
    writeFileSync(prs, JSON.stringify([
      { number: 42, title: "Checkout flow", url: "https://github.com/acme/shop/pull/42", headRefName: "e2e-demo", baseRefName: "main",
        isDraft: false, reviewDecision: "REVIEW_REQUIRED", statusCheckRollup: [], ...size, updatedAt: at },
      { number: 39, title: "Refresh the docs", url: "https://github.com/acme/shop/pull/39", headRefName: "docs-refresh", baseRefName: "main",
        isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [], additions: 18, deletions: 4, updatedAt: at },
    ]));
  });
  await writeFile(join(outDir, "home.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.unexpectedWrites.length) process.exit(1);
}

const command = positionals[0];
if (command === "smoke") await smoke();
else if (command === "project") await project();
else if (command === "org") await org();
else if (command === "threads") await threads();
else if (command === "needs-you") await needsYou();
else if (command === "tabs") await tabs();
else if (command === "workspace") await workspace();
else if (command === "layout") await layout();
else if (command === "stop") await stop();
else if (command === "processes") await processes();
else if (command === "stop-state") await stopState();
else if (command === "baseline") await baseline();
else if (command === "diffs") await diffs(values.before === true);
else if (command === "home") await home();
else if (command === "compare" && positionals[2]) await compare(positionals[1]!, positionals[2]);
else {
  console.error("usage: bun scripts/e2e/run.ts smoke|project|org|threads|tabs|workspace|layout|stop|processes|stop-state|baseline|diffs|home [--before] [--port 8797] [--out DIR] | compare A.png B.png");
  process.exit(2);
}
