import { describe, expect, it } from "vitest";
import { buildWorkTimeline, describeTool, firstLine, formatWorkDuration, liveStep, type WorkTurn } from "./work-timeline";
import type { TranscriptEntry, TranscriptPart } from "./types";

const text = (value: string): TranscriptPart => ({ kind: "text", text: value });
const thought: TranscriptPart = { kind: "thinking", text: "Compare the two implementations." };
const tool: TranscriptPart = { kind: "tool", name: "Read", summary: "src/app.ts", result: { text: "file content" } };
const entry = (uuid: string, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({
  uuid, ts: "2026-09-08T12:00:10Z", role: "assistant", parts: [text(uuid)], ...extra,
});
const user = (uuid = "user", extra: Partial<TranscriptEntry> = {}) => entry(uuid, { role: "user", ts: "2026-09-08T12:00:00Z", ...extra });
function work(entries: TranscriptEntry[], status: Parameters<typeof buildWorkTimeline>[1] = "done"): WorkTurn {
  const rows = buildWorkTimeline(entries, status).filter((row) => row.kind === "work");
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("buildWorkTimeline", () => {
  it("uses native completion and phase to keep the final answer outside folded work", () => {
    const progress = entry("progress", { turnId: "native-turn", phase: "commentary", parts: [text("Checking the code"), tool] });
    const final = entry("final", { turnId: "native-turn", phase: "final_answer", parts: [text("The fix is ready.")],
      turn: { status: "completed", startedAt: "2026-09-08T12:00:02Z", completedAt: "2026-09-08T12:00:09Z", durationMs: 6200 } });
    const result = work([user(), progress, final], "working");
    expect(result).toMatchObject({ active: false, settled: true, interrupted: false, startedAt: "2026-09-08T12:00:02Z", durationMs: 6200 });
    expect(result.activity).toEqual([progress]);
    expect(result.answer).toEqual(final);
    expect(result.entries).toEqual([progress, final]);
  });

  it("splits a mixed thinking/text entry without duplicating or losing either part", () => {
    const mixed = entry("mixed", { turnId: "t1", phase: "final_answer", parts: [thought, text("Final answer")], turn: { status: "completed" } });
    const before = structuredClone(mixed);
    const result = work([mixed]);
    expect(result.activity).toEqual([{ ...mixed, parts: [thought] }]);
    expect(result.answer).toEqual({ ...mixed, parts: [text("Final answer")] });
    expect(mixed).toEqual(before);
  });

  it("keeps every unclassified legacy text message visible instead of guessing commentary", () => {
    const entries = [entry("first-answer"), entry("second-answer")];
    expect(buildWorkTimeline(entries, "done")).toEqual(entries.map((value) => ({ kind: "message", entry: value })));
  });

  it("allows real legacy tool work to fold while keeping the final prose outside", () => {
    const commentary = entry("checking");
    const action = entry("read", { parts: [tool] });
    const final = entry("ready");
    const result = work([user(), commentary, action, final]);
    expect(result.activity).toEqual([commentary, action]);
    expect(result.answer).toEqual(final);
  });

  it("does not mislabel the latest streaming prose as a final answer", () => {
    const entries = [entry("thinking", { turnId: "t1", parts: [thought] }),
      entry("partial", { turnId: "t1", parts: [text("Still investigating")], turn: { status: "running" } })];
    const result = work(entries, "working");
    expect(result).toMatchObject({ active: true, settled: false, answer: null, interrupted: false });
    expect(result.activity).toEqual(entries);
    expect(result.durationMs).toBeUndefined();
  });

  it.each(["blocked", "unknown", undefined] as const)("does not infer completion from %s status", (status) => {
    const rows = buildWorkTimeline([entry("work", { parts: [thought] }), entry("partial")], status);
    const result = rows[0] as WorkTurn;
    expect(result).toMatchObject({ kind: "work", active: false, settled: false, answer: null });
  });

  it("never promotes a commentary-phase update to a final answer", () => {
    const result = work([entry("comment", { phase: "commentary", turn: { status: "completed" } })]);
    expect(result).toMatchObject({ settled: true, answer: null });
    expect(result.activity).toHaveLength(1);
  });

  it("shows interrupted native work as settled without inventing a response", () => {
    const result = work([entry("aborted", { turnId: "t1", parts: [thought, tool], turn: { status: "aborted", durationMs: 1500 } })], "working");
    expect(result).toMatchObject({ active: false, settled: true, interrupted: true, answer: null, durationMs: 1500 });
  });

  it("groups each native turn independently and does not attach an older answer to current work", () => {
    const old = entry("old", { turnId: "old-turn", phase: "final_answer", parts: [thought, text("Previous answer")], turn: { status: "completed" } });
    const current = entry("current", { turnId: "new-turn", phase: "commentary", parts: [tool], turn: { status: "running" } });
    const rows = buildWorkTimeline([old, current], "working");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "work", active: false, answer: { uuid: "old" } });
    expect(rows[1]).toMatchObject({ kind: "work", active: true, settled: false, answer: null });
  });

  it.each(["user", "note", "summary"] as const)("leaves a %s boundary outside assistant work and preserves sequence", (role) => {
    const first = entry("first", { turnId: "same-turn", parts: [tool] });
    const boundary = entry("boundary", { role });
    const next = entry("next", { turnId: "same-turn", parts: [thought] });
    const rows = buildWorkTimeline([first, boundary, next], "working");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "work", entries: [first], settled: true });
    expect(rows[1]).toEqual({ kind: "message", entry: boundary });
    expect(rows[2]).toMatchObject({ kind: "work", entries: [next], active: true });
    expect((rows[0] as WorkTurn).id).not.toBe((rows[2] as WorkTurn).id);
  });

  it("keeps every explicit final response outside work even when a provider reuses the turn ID", () => {
    const rows = buildWorkTimeline([
      entry("tool", { turnId: "same", parts: [tool] }),
      entry("first-final", { turnId: "same", phase: "final_answer" }),
      entry("continuation", { turnId: "same", parts: [thought] }),
      entry("second-final", { turnId: "same", phase: "final_answer" }),
    ], "done");
    expect(rows.map((row) => row.kind === "work" ? row.answer?.uuid : row.entry.uuid)).toEqual(["first-final", "second-final"]);
    expect((rows[0] as WorkTurn).id).not.toBe((rows[1] as WorkTurn).id);
  });

  it("waits for native completion instead of inventing a short duration from an earlier tool timestamp", () => {
    const rows = buildWorkTimeline([entry("work", { parts: [tool], turn: { status: "running", startedAt: "2026-09-08T12:00:00Z" } })], "done");
    expect(rows[0]).toMatchObject({ kind: "work", settled: false, answer: null });
    expect((rows[0] as WorkTurn).durationMs).toBeUndefined();
  });

  it("does not label a native running fragment as completed at a system boundary", () => {
    const rows = buildWorkTimeline([entry("work", { parts: [tool], turn: { status: "running" } }), entry("note", { role: "note" })]);
    expect(rows[0]).toMatchObject({ kind: "work", settled: false, answer: null });
  });

  it("does not invent full-turn duration for a page that begins mid-work", () => {
    const partial = entry("partial", { ts: "2026-09-08T12:00:05Z", parts: [tool] });
    const final = entry("final", { ts: "2026-09-08T12:00:10Z" });
    const result = work([partial, final]);
    expect(result.startedAt).toBeUndefined();
    expect(result.durationMs).toBeUndefined();
  });

  it("uses a valid preceding user boundary for measured elapsed time without crossing notes", () => {
    const action = entry("work", { parts: [tool] });
    const final = entry("final");
    expect(work([user(), action, final]).durationMs).toBe(10_000);
    const rows = buildWorkTimeline([user(), entry("note", { role: "note" }), action, final], "done");
    const result = rows.find((row) => row.kind === "work")!;
    expect(result.durationMs).toBeUndefined();
  });

  it.each([
    { startedAt: "invalid", completedAt: "invalid", durationMs: Number.NaN },
    { startedAt: "2026-09-08T12:00:20Z", completedAt: "2026-09-08T12:00:01Z", durationMs: -1 },
    { durationMs: Number.POSITIVE_INFINITY },
  ])("omits an unavailable or invalid duration instead of fabricating a value", (metadata) => {
    const result = work([entry("bad-time", { ts: "invalid", parts: [thought], turn: { status: "completed", ...metadata } })]);
    expect(result.durationMs).toBeUndefined();
  });

  it("accepts an explicit zero duration and native timing even with a partial page", () => {
    expect(work([entry("instant", { parts: [tool], turn: { status: "completed", durationMs: 0 } })]).durationMs).toBe(0);
    expect(work([entry("partial", { parts: [tool], turn: { status: "completed", startedAt: "2026-09-08T12:00:01Z", completedAt: "2026-09-08T12:00:04Z" } })]).durationMs).toBe(3000);
  });

  it("keeps native turn IDs stable when older unrelated turns are prepended", () => {
    const current = [user("new-user"), entry("new-work", { turnId: "new-turn", parts: [tool] })];
    const old = [user("old-user"), entry("old-work", { turnId: "old-turn", parts: [thought] })];
    const before = work(current).id;
    const after = buildWorkTimeline([...old, ...current], "done").find((row) => row.kind === "work" && row.entries[0]!.uuid === "new-work")!;
    expect(after).toMatchObject({ kind: "work", id: before });
  });

  it("keeps legacy IDs stable when older user turns are prepended", () => {
    const current = [user("current-user"), entry("current-work", { parts: [tool] })];
    const before = work(current).id;
    const after = buildWorkTimeline([user("older-user"), entry("older-work", { parts: [tool] }), ...current], "done").at(-1)!;
    expect(after).toMatchObject({ kind: "work", id: before });
  });
});

describe("formatWorkDuration", () => {
  it.each([[0, "0s"], [59_999, "59s"], [60_000, "1m 0s"], [125_000, "2m 5s"], [3_661_000, "1h 1m"]])("formats %s milliseconds as %s", (ms, label) => {
    expect(formatWorkDuration(ms as number)).toBe(label);
  });
});

describe("describeTool", () => {
  // A step reads as a verb and its target ("Ran bun run test", "Edited web/src/index.css"), past
  // tense once it is done and present while it runs. The target says how it is drawn: a path keeps
  // its file name whole, a command or a pattern stays monospace.
  it.each([
    ["Bash", "terminal", "Ran", "Running", "code"],
    ["exec_command", "terminal", "Ran", "Running", "code"],
    ["Read", "read", "Read", "Reading", "path"],
    ["Edit", "edit", "Edited", "Editing", "path"],
    ["MultiEdit", "edit", "Edited", "Editing", "path"],
    ["Write", "write", "Wrote", "Writing", "path"],
    ["Grep", "search", "Searched", "Searching", "code"],
    ["Glob", "search", "Searched", "Searching", "code"],
    ["WebFetch", "web", "Fetched", "Fetching", "text"],
    ["Task", "agent", "Ran agent", "Running agent", "text"],
  ])("%s is a %s step: %s / %s, its target drawn as %s", (name, kind, done, doing, target) => {
    expect(describeTool(name)).toEqual({ kind, done, doing, target });
  });

  it("names a tool it does not know by its own name, with the summary as plain text", () => {
    expect(describeTool("SendUserFile")).toEqual({ kind: "tool", done: "SendUserFile", doing: "SendUserFile", target: "text" });
  });

  // Claude Code names an MCP tool mcp__<server>__<tool>; the server's part is most of the length
  // and says nothing about what the step did.
  it("names an MCP tool by its own tool name, without the mcp__ prefix and the server", () => {
    expect(describeTool("mcp__plugin_playwright_playwright__browser_take_screenshot")).toEqual(
      { kind: "tool", done: "browser_take_screenshot", doing: "browser_take_screenshot", target: "text" });
  });
});

describe("firstLine", () => {
  it("is the first line that has words, trimmed", () => {
    expect(firstLine("\n  Compare the two.  \nThen pick one.")).toBe("Compare the two.");
    expect(firstLine("   ")).toBe("");
  });

  // Codex and pi open a thought with a bold title. The preview reads like the rendered thought,
  // so it drops what the Markdown renderer would draw as formatting, and only that.
  it("drops the Markdown the thought would render as formatting", () => {
    expect(firstLine("**Inspecting TypeScript errors**\n\nThe build fails on…")).toBe("Inspecting TypeScript errors");
    expect(firstLine("## Plan\n1. Read")).toBe("Plan");
    expect(firstLine("> Check `tab-strip.tsx` *first*")).toBe("Check tab-strip.tsx first");
  });

  it("leaves identifiers and globs alone", () => {
    expect(firstLine("rename use_app_viewport and *.ts to *.tsx")).toBe("rename use_app_viewport and *.ts to *.tsx");
  });
});

describe("liveStep", () => {
  const running = (parts: TranscriptPart[], ts = "2026-09-08T12:00:30Z") =>
    work([user(), entry("step", { ts, parts, turn: { status: "running", startedAt: "2026-09-08T12:00:00Z" } })], "working");

  it("names the call that has no result yet, in the present tense, from when it started", () => {
    const call: TranscriptPart = { kind: "tool", name: "Bash", summary: "bun run test tab-strip" };
    expect(liveStep(running([thought, call]))).toEqual({ kind: "terminal", verb: "Running", target: "bun run test tab-strip", format: "code", since: "2026-09-08T12:00:30Z", entry: "step", index: 1 });
  });

  it("says Thinking with the thought's first line while the agent thinks", () => {
    expect(liveStep(running([tool, { kind: "thinking", text: "Ahora ajusto el chip.\nDespués el test." }]))).toMatchObject({ kind: "thinking", verb: "Thinking", target: "Ahora ajusto el chip.", format: "thought", entry: "step", index: 1 });
  });

  it("says only Working between steps, and claims no step to draw", () => {
    expect(liveStep(running([tool]))).toEqual({ kind: "working", verb: "Working", target: "", format: "text" });
  });

  // Claude writes each parallel call as its own entry, and the results come back in any order.
  it("names the call still running when one started after it has already finished", () => {
    const at = (uuid: string, ts: string, part: TranscriptPart) => entry(uuid, { ts, parts: [part], turn: { status: "running", startedAt: "2026-09-08T12:00:00Z" } });
    const turn = work([user(),
      at("a", "2026-09-08T12:00:30Z", { kind: "tool", name: "Task", summary: "Audit the tab strip" }),
      at("b", "2026-09-08T12:00:31Z", { kind: "tool", name: "Task", summary: "Audit the composer", result: { text: "fine" } }),
    ], "working");
    expect(liveStep(turn)).toMatchObject({ entry: "a", index: 0, since: "2026-09-08T12:00:30Z" });
  });

  it("has nothing to say about a turn that is not running", () => {
    expect(liveStep(work([user(), entry("done", { parts: [tool], turn: { status: "completed" } })], "done"))).toBeNull();
  });
});
