import { describe, expect, test } from "bun:test";

import { describeAlert, turnOutcome } from "./alert-detail.ts";
import { parseClaudeTranscript } from "./journal/claude.ts";
import type { OrgProjectView } from "./projects.ts";
import type { AgentView } from "./types.ts";

// What a notification says about a pane: who it is to the operator (a project's thread or
// coordinator, else its own label), where it runs, what started the turn that just ended, and the
// first line of what it answered. Pure — the bridge hands in the project list and the journal.

const pane = (over: Partial<AgentView> = {}): AgentView => ({
  paneId: "p1",
  workspaceId: "w1",
  workspaceLabel: "fisgon",
  workspaceNumber: 1,
  tabId: "w1:t1",
  agent: "claude",
  status: "done",
  cwd: "/home/me/fisgon",
  focused: false,
  kind: "agent",
  ...over,
});

const project: OrgProjectView = {
  slug: "awam",
  name: "AWAM Comercio",
  status: "active",
  coordinator: { paneId: "pc", agent: "claude", liveStatus: "done" },
  threads: [{ id: "t-0093", title: "Mi Cúcula pedidos", parentId: "root", role: "worker", status: "open", paneId: "pt", depth: 1, reportUnacked: false }],
  source: "json",
  prActions: true,
  nodeActions: true,
  workspaceIds: ["w9"],
};

const jsonl = (...rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n");
const human = (uuid: string, text: string) => ({ type: "user", uuid, timestamp: "2026-10-13T18:00:00Z", origin: { kind: "human" }, message: { role: "user", content: text } });
const answer = (uuid: string, text: string) => ({ type: "assistant", uuid, timestamp: "2026-10-13T18:00:05Z", message: { role: "assistant", content: [{ type: "text", text }] } });
const taskDone = (uuid: string) => ({
  type: "user",
  uuid,
  timestamp: "2026-10-13T18:01:00Z",
  origin: { kind: "task-notification" },
  message: { role: "user", content: "<task-notification>\n<task-id>a1</task-id>\n<summary>Agent \"Map sources\" finished</summary>\n</task-notification>" },
});

describe("describeAlert", () => {
  test("a project's thread is named by its title, and placed in its project", () => {
    const d = describeAlert(pane({ paneId: "pt" }), "done", [project]);
    expect(d).toMatchObject({ kind: "thread", name: "t-0093 Mi Cúcula pedidos", where: "AWAM Comercio", background: false });
  });

  test("a project's coordinator is named as the project's coordinator", () => {
    expect(describeAlert(pane({ paneId: "pc" }), "blocked", [project])).toMatchObject({ kind: "coordinator", name: "AWAM Comercio coordinator", where: "AWAM Comercio" });
  });

  test("a loose agent is named by its own label before the CLI's name", () => {
    expect(describeAlert(pane({ paneLabel: "pedidos" }), "done").name).toBe("pedidos");
    expect(describeAlert(pane({ sessionName: "fix-login" }), "done").name).toBe("fix-login");
    expect(describeAlert(pane({ tabLabel: "api" }), "done")).toMatchObject({ kind: "agent", name: "api", where: "fisgon" });
    expect(describeAlert(pane(), "done")).toMatchObject({ name: "claude", where: "fisgon" });
  });

  test("a finished turn carries the first line of its last answer", () => {
    const entries = parseClaudeTranscript(jsonl(human("u1", "abrí el html"), answer("a1", "## Listo\n\nEl **HTML** de avance ya está abierto.\nDetalles abajo.")));
    expect(describeAlert(pane(), "done", [], entries)).toMatchObject({ background: false, summary: "Listo" });
  });

  test("a turn a subagent's result started is background work", () => {
    const entries = parseClaudeTranscript(jsonl(human("u1", "investigá"), answer("a1", "Lanzo un agente."), taskDone("t1"), answer("a2", "El agente terminó: 3 fuentes.")));
    expect(describeAlert(pane(), "done", [], entries)).toMatchObject({ background: true, summary: "El agente terminó: 3 fuentes." });
  });
});

describe("turnOutcome", () => {
  test("an empty or unreadable journal is the operator's turn with nothing to quote", () => {
    expect(turnOutcome([])).toEqual({ background: false });
  });

  test("a long first line is cut on a word", () => {
    const long = `${"palabra ".repeat(40)}fin`;
    const { summary } = turnOutcome(parseClaudeTranscript(jsonl(human("u1", "x"), answer("a1", long))));
    expect(summary!.length).toBeLessThanOrEqual(120);
    expect(summary!.endsWith("…")).toBe(true);
  });
});
