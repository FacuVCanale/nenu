import { mkdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { FakeHerdr } from "../../bridge/test-support/fake-herdr.ts";

// The demo herd every e2e run starts from: one Claude pane working (screen ticking, journal
// growing), one idle, one blocked on a real captured permission dialog, a Codex pane and a shell.
// Content is synthetic; the dialog comes from the repo's own fixture corpus.

export interface DemoHerd {
  working: string;
  idle: string;
  blocked: string;
  codex: string;
  shell: string;
  /** Claude journal file per pane id. */
  journals: Map<string, string>;
  dialog: string;
}

const FIXTURES = resolve(import.meta.dir, "../../web/src/fixtures/panes");
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** The dialog half of a captured screen: everything below its last horizontal rule. */
export async function fixtureDialog(name: string): Promise<string> {
  const rows = stripAnsi(await readFile(join(FIXTURES, `${name}.txt`), "utf8")).trimEnd().split("\n");
  const rule = rows.findLastIndex((r) => /^─{20,}/.test(r));
  return rows.slice(rule + 1).join("\n");
}

let seq = 0;
function journalRow(type: "user" | "assistant", text: string, parentUuid: string | null, at: number): { uuid: string; line: string } {
  const uuid = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const message = type === "user" ? { role: "user", content: text } : { role: "assistant", content: [{ type: "text", text }] };
  return { uuid, line: JSON.stringify({ type, uuid, parentUuid, timestamp: new Date(at).toISOString(), message }) + "\n" };
}

async function writeJournal(file: string, turns: Array<["user" | "assistant", string]>, at: number): Promise<string | null> {
  let parent: string | null = null;
  let body = "";
  for (const [type, text] of turns) {
    const row = journalRow(type, text, parent, at);
    body += row.line;
    parent = row.uuid;
  }
  await writeFile(file, body);
  return parent;
}

/** `shift` moves journal timestamps onto the bench clock (bridge.ts `epoch`). */
export async function seedDemoHerd(fake: FakeHerdr, opts: { claudeRoot: string; cwd: string; shift: number }): Promise<DemoHerd> {
  const projectDir = join(opts.claudeRoot, "-tmp-nenu-e2e");
  await mkdir(projectDir, { recursive: true });
  const ids = { working: "w1:working", idle: "w1:idle", blocked: "w2:blocked" };
  const sessions = {
    working: "11111111-1111-4111-8111-111111111111",
    idle: "22222222-2222-4222-8222-222222222222",
    blocked: "33333333-3333-4333-8333-333333333333",
  };
  const journals = new Map<string, string>();
  for (const key of Object.keys(ids) as Array<keyof typeof ids>) {
    const file = join(projectDir, `${sessions[key]}.jsonl`);
    journals.set(ids[key], file);
    await writeJournal(file, [
      ["user", `Demo task for the ${key} pane`],
      ["assistant", `Looking at the ${key} pane now.`],
    ], Date.now() + opts.shift);
  }
  const dialog = await fixtureDialog("claude--permission-bash");

  fake.addWorkspace("w1", "nenu").addWorkspace("w2", "api");
  fake.addTab("w1:t1", "redesign").addTab("w1:t2", "review").addTab("w2:t1", "server");
  const pane = (paneId: string, tabId: string, agent: "claude" | "codex" | null, label: string, sessionId?: string) =>
    fake.addPane({
      paneId, workspaceId: paneId.split(":")[0]!, tabId, agent, label, sessionId, cwd: opts.cwd,
      lines: agent === "claude" ? [`❯ Demo task for ${label}`, "", `● Looking at ${label} now.`] : [],
    });
  pane("w1:working", "w1:t1", "claude", "Working Claude", sessions.working);
  pane("w1:idle", "w1:t2", "claude", "Idle Claude", sessions.idle);
  pane("w2:blocked", "w2:t1", "claude", "Blocked Claude", sessions.blocked);
  pane("w2:codex", "w2:t1", "codex", "Codex");
  pane("w2:shell", "w2:t1", null, "Shell");
  fake.setStatus("w1:working", "working");
  fake.setDialog(ids.blocked, dialog);

  return { ...ids, codex: "w2:codex", shell: "w2:shell", journals, dialog };
}

/** Keep the working pane's journal growing, like an agent streaming tool calls. Returns a stop function. */
export function tickJournal(file: string, now: () => number, everyMs = 2000): () => void {
  let n = 0;
  let parent: string | null = null;
  const timer = setInterval(() => {
    const row = journalRow("assistant", `Step ${++n}: still working.`, parent, now());
    parent = row.uuid;
    void appendFile(file, row.line);
  }, everyMs);
  return () => clearInterval(timer);
}

/**
 * What fake-org.ts starts from: Organizations' `overview --json` projects, plus the profile names.
 * A project's `coordinator` binds its coordinator to a demo pane, as `.state/coordinator.json` does.
 */
export interface OrgSeed {
  profiles: string[];
  projects: Array<{
    slug: string; name: string; goal: string; status: "active" | "paused";
    coordinator?: { pane_id: string; workspace_id: string; tab_id: string };
    threads: Array<Record<string, unknown> & { id: string }>;
  }>;
}

/**
 * One project whose coordinator is not running: a nested coordinator with three workers (one
 * bound to the blocked demo pane, one to the working one, one with an approved PR), a worker of
 * its own, and a resolved coordinator with its team. `at` is the bench clock's now.
 */
export function demoOrg(herd: Pick<DemoHerd, "working" | "idle" | "blocked">, at: number): OrgSeed {
  const ago = (minutes: number) => new Date(at - minutes * 60_000).toISOString();
  const bound = (paneId: string, tabId: string) => ({ workspace_id: paneId.split(":")[0], tab_id: tabId, pane_id: paneId });
  const thread = (id: string, title: string, parent: string, role: "worker" | "coordinator", status: string, group: string, minutes: number, extra: Record<string, unknown> = {}) => ({
    id, title, parent_id: parent, role, status, group, group_label: group, note: "", branch: "", workspace_id: "", tab_id: "", pane_id: "", cwd: "",
    updated: ago(minutes), report_unacked: false, auto_fix_ci: false, auto_merge: false, pr: null, ...extra,
  });
  return {
    profiles: ["claude", "codex"],
    projects: [{
      slug: "awam",
      name: "AWAM Comercio SaaS",
      goal: "Coordinar iniciativas de AWAM que requieran varios threads o PRs",
      status: "active",
      threads: [
        thread("t-0001", "Cierre Mi Cúcula", "root", "coordinator", "resolved", "resolved", 3000),
        thread("t-0002", "Extraer requisitos", "t-0001", "worker", "resolved", "resolved", 3100),
        thread("t-0003", "Auditar código y PRs", "t-0001", "worker", "resolved", "resolved", 3050),
        thread("t-0004", "Revisar grupos", "root", "worker", "resolved", "resolved", 2800),
        thread("t-0010", "Rediseño mobile", "root", "coordinator", "open", "working", 1, bound(herd.idle, "w1:t2")),
        thread("t-0011", "Panel depósito", "t-0010", "worker", "open", "waiting-on-you", 4, bound(herd.blocked, "w2:t1")),
        thread("t-0012", "Landing a 390 px", "t-0010", "worker", "open", "working", 0, bound(herd.working, "w1:t1")),
        thread("t-0013", "Panel mercadería", "t-0010", "worker", "open", "ready-for-review", 12, {
          pr: {
            url: "https://github.com/awam/comercio/pull/1342", state: "OPEN", review: "APPROVED", checks: { passed: 6, pending: 0, failed: 0 },
            additions: 182, deletions: 40, failing: [], comment_count: 1, draft: false, mergeable: "MERGEABLE", merge_blocker: null,
          },
        }),
        thread("t-0014", "Hotfix login", "root", "worker", "open", "idle", 35),
      ],
    }],
  };
}

/**
 * A project shaped like a long-running real one (measured 2026-10-10: 8 resolved coordinators, 20
 * threads nested under five of them, 63 resolved top-level threads), with open work at three depths
 * in every state: a coordinator waiting on you, an idle one running a working thread, a thread ready
 * for review and a nested coordinator with a thread of its own; a thread waiting on you and an idle
 * one at the top; and a resolved thread under the open coordinator. With `coordinator` the
 * project's own coordinator runs in the demo Codex pane.
 */
export function orgTreeSeed(herd: Pick<DemoHerd, "working" | "idle" | "blocked" | "codex">, at: number, { coordinator = false } = {}): OrgSeed {
  const ago = (minutes: number) => new Date(at - minutes * 60_000).toISOString();
  const bound = (paneId: string, tabId: string) => ({ workspace_id: paneId.split(":")[0]!, tab_id: tabId, pane_id: paneId });
  const node = (id: number, title: string, parent: string, role: "worker" | "coordinator", group: string, minutes: number, extra: Record<string, unknown> = {}) => ({
    id: `t-${String(id).padStart(4, "0")}`, title, parent_id: parent, role, status: group === "resolved" ? "resolved" : "open", group,
    group_label: group, note: "", branch: "", workspace_id: "", tab_id: "", pane_id: "", cwd: "", updated: ago(minutes),
    report_unacked: false, auto_fix_ci: false, auto_merge: false, pr: null, ...extra,
  });
  const threads: Array<Record<string, unknown> & { id: string }> = [];
  let id = 0;
  // Resolved coordinators, oldest first, each with the threads it ran.
  const teams: Array<[string, number]> = [
    ["Cierre Mi Cúcula", 2], ["Publicación Mi Cúcula", 2], ["Revisar PRs a develop", 4], ["Mergear PRs restantes", 10],
    ["Preparar release", 2], ["Investigar WhatsApp", 0], ["Stock y vínculos", 0], ["Prueba de plantilla", 0],
  ];
  for (const [index, [title, size]] of teams.entries()) {
    const coordinatorId = `t-${String(++id).padStart(4, "0")}`;
    const minutes = 30_000 - index * 3000;
    threads.push(node(id, title, "root", "coordinator", "resolved", minutes));
    for (let n = 1; n <= size; n++) threads.push(node(++id, `${title}: paso ${n}`, coordinatorId, "worker", "resolved", minutes + n * 10));
  }
  for (let n = 1; n <= 63; n++) threads.push(node(++id, `Tarea cerrada ${n}`, "root", "worker", "resolved", 29_000 - n * 300));
  threads.push(
    node(101, "Migración de stock", "root", "coordinator", "waiting-on-you", 20),
    node(102, "Rediseño mobile", "root", "coordinator", "idle", 2, bound(herd.idle, "w1:t2")),
    node(103, "Landing a 390 px", "t-0102", "worker", "working", 0, bound(herd.working, "w1:t1")),
    node(104, "Panel mercadería", "t-0102", "worker", "ready-for-review", 12, {
      pr: {
        url: "https://github.com/awam/comercio/pull/1342", state: "OPEN", review: "APPROVED", checks: { passed: 6, pending: 0, failed: 0 },
        additions: 182, deletions: 40, failing: [], comment_count: 1, draft: false, mergeable: "MERGEABLE", merge_blocker: null,
      },
    }),
    node(105, "Checkout", "t-0102", "coordinator", "working", 6),
    node(106, "Ajustar pagos", "t-0105", "worker", "idle", 9),
    node(107, "Auditar estilos", "t-0102", "worker", "resolved", 40),
    node(108, "Hotfix login", "root", "worker", "idle", 35),
    node(109, "Panel depósito", "root", "worker", "waiting-on-you", 4, bound(herd.blocked, "w2:t1")),
  );
  return {
    profiles: ["claude", "codex"],
    projects: [{
      slug: "awam",
      name: "AWAM Comercio SaaS",
      goal: "Coordinar iniciativas de AWAM que requieran varios threads o PRs",
      status: "active",
      ...(coordinator ? { coordinator: bound(herd.codex, "w2:t1") } : {}),
      threads,
    }],
  };
}

/** git in the bench's folder, with none of the caller's GIT_* and no signing or identity of the operator's. */
function git(dir: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const result = Bun.spawnSync(["git", "-c", "user.name=e2e", "-c", "user.email=e2e@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

/** `count` lines of plausible TypeScript about `topic`; `edit` rewrites line `i`. */
function code(topic: string, count: number, edit: (line: string, i: number) => string = (line) => line): string {
  return Array.from({ length: count }, (_, i) =>
    edit(i % 6 === 0 ? `export function ${topic}Step${i}(input: ${topic[0]!.toUpperCase()}${topic.slice(1)}Input) {` : i % 6 === 5 ? "}" : `  const value${i} = input.items.filter((item) => item.${topic} > ${i}).length; // ${topic} ${i}`, i),
  ).join("\n") + "\n";
}

/**
 * The demo panes' folder as a pull request's worktree: `main` (also `origin/main`) and the checked-out
 * `e2e-demo`, one commit changing six files (an edit, a new file, a removal, a rename, a binary) and
 * an uncommitted edit. Returns what GitHub would count for the PR: the committed lines.
 */
export function seedDiffRepo(dir: string): { additions: number; deletions: number } {
  const files: Record<string, string | Uint8Array> = {
    "app/cart.ts": code("cart", 40),
    "app/checkout.tsx": code("checkout", 60),
    "app/styles.css": Array.from({ length: 20 }, (_, i) => `.row-${i} { padding: ${i}px; }`).join("\n") + "\n",
    "app/legacy.ts": code("legacy", 12),
    "README.md": "# Comercio\n\nThe shop's storefront and admin.\n",
    "app/logo.png": new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 1, 2, 3]),
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git(dir, "add", "--", ...Object.keys(files));
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "branch", "main");

  writeFileSync(join(dir, "app/cart.ts"), code("cart", 44, (line, i) => i === 3 ? `${line.replace("> 3", ">= 3")}` : i === 20 ? "  const discount = applyCoupon(input.coupon, input.total);" : line));
  writeFileSync(join(dir, "app/checkout.tsx"), code("checkout", 66, (line, i) => i === 8 || i === 40 ? line.replace("filter", "findAll") : line));
  writeFileSync(join(dir, "app/payment.ts"), code("payment", 30));
  writeFileSync(join(dir, "app/logo.png"), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 9, 9, 9, 9]));
  git(dir, "rm", "-q", "app/legacy.ts");
  mkdirSync(join(dir, "docs"), { recursive: true });
  git(dir, "mv", "README.md", "docs/README.md");
  git(dir, "add", "--", "app");
  git(dir, "commit", "-q", "-m", "feat: checkout with coupons");
  const [additions, deletions] = git(dir, "diff", "--shortstat", "origin/main", "HEAD").match(/\d+(?= insertion| deletion)/g)!.map(Number);
  // Not committed yet: what the agent is still typing.
  writeFileSync(join(dir, "app/styles.css"), Array.from({ length: 20 }, (_, i) => `.row-${i} { padding: ${i === 4 ? 6 : i}px; }`).join("\n") + "\n.coupon { color: var(--status-done); }\n");
  return { additions: additions!, deletions: deletions! };
}

/** A commit past every limit of the diff viewer: 320 new files and one generated file of 4,000 lines. */
export function growDiffRepo(dir: string): void {
  mkdirSync(join(dir, "app/generated"), { recursive: true });
  writeFileSync(join(dir, "app/generated/catalog.ts"), code("catalog", 4000));
  for (let n = 0; n < 320; n++) writeFileSync(join(dir, `app/generated/item-${String(n).padStart(3, "0")}.ts`), code(`item${n}`, 60));
  git(dir, "add", "--", "app/generated");
  git(dir, "commit", "-q", "-m", "feat: generated catalog");
}

/** `demoOrg`, with its PR #1342 on the working pane's thread, on `e2e-demo`, sized as `size` says. */
export function diffOrg(herd: Pick<DemoHerd, "working" | "idle" | "blocked">, at: number, size: { additions: number; deletions: number }): OrgSeed {
  const seed = demoOrg(herd, at);
  const project = seed.projects[0]!;
  const pr = { ...(project.threads.find((thread) => thread.id === "t-0013")!.pr as Record<string, unknown>), ...size };
  project.threads = project.threads.map((thread) =>
    thread.id === "t-0012" ? { ...thread, branch: "e2e-demo", pr }
    : thread.id === "t-0013" ? { ...thread, pr: { ...pr, url: "https://github.com/awam/comercio/pull/1338", additions: 64, deletions: 12 } }
    : thread);
  return seed;
}
