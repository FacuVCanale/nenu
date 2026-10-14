import { describe, expect, test } from "bun:test";

import { deliveryVerdict, loggedMessage, unwrapPastes } from "./delivery-check.ts";

// Shapes measured on Claude Code 2.1.296, 2.1.299 and 2.1.300 under Herdr 0.9.3 on macOS. The PTY
// hands a 1 500-character send to Claude as two reads, 1 022 and 478 bytes; Claude takes the first
// as a paste, and about two times in three it then logs only the 478. A paste it keeps is logged
// inside `<pasted_content>` tags, with the literal tail after them.

const wrap = (text: string, id = "75ce") => `\n\n<pasted_content id="${id}">\n${text}\n</pasted_content id="${id}">\n`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const row = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "user", message: { role: "user", content }, origin: { kind: "human" }, timestamp: "2026-10-14T19:57:00.399Z", ...extra });

describe("loggedMessage", () => {
  test("reads the operator's typed message and when Claude logged it", () => {
    expect(loggedMessage(row("deploy the staging build"))).toEqual({ at: Date.parse("2026-10-14T19:57:00.399Z"), text: "deploy the staging build" });
    expect(loggedMessage(row([{ type: "text", text: "with blocks" }]))?.text).toBe("with blocks");
  });

  test("skips what the operator did not type: tool results, meta rows, commands, other row types", () => {
    expect(loggedMessage(row([{ type: "tool_result", tool_use_id: "t", content: "ok" }]))).toBeNull();
    expect(loggedMessage(row("<system-reminder>x</system-reminder>", { origin: undefined, isMeta: true }))).toBeNull();
    expect(loggedMessage(row("a notice", { origin: { kind: "task-notification" } }))).toBeNull();
    expect(loggedMessage(row("<command-name>/compact</command-name>\n<command-args></command-args>"))).toBeNull();
    expect(loggedMessage(row("<bash-input>ls</bash-input>"))).toBeNull();
    expect(loggedMessage(JSON.stringify({ type: "assistant", message: { content: "hi" }, timestamp: "2026-10-14T19:57:00Z" }))).toBeNull();
    expect(loggedMessage("not json")).toBeNull();
  });
});

describe("unwrapPastes", () => {
  const paragraphs = (text: string) => text.split(/\n{2,}/);

  test("puts a logged paste back as the text it held", () => {
    expect(unwrapPastes(wrap("alpha bravo"))).toBe("alpha bravo");
    expect(unwrapPastes(wrap("  indented\n\n  code"))).toBe("  indented\n\n  code");
    expect(unwrapPastes("no paste here")).toBe("no paste here");
    expect(unwrapPastes("\n  typed text keeps its edges\n")).toBe("\n  typed text keeps its edges\n");
  });

  test("text around a paste, or a second paste, stays apart from it", () => {
    expect(paragraphs(unwrapPastes(`${wrap("alpha", "a1")}${wrap("bravo", "b2")}`))).toEqual(["alpha", "bravo"]);
    expect(paragraphs(unwrapPastes(`Look at this:${wrap("alpha bravo")}\nthanks`))).toEqual(["Look at this:", "alpha bravo", "thanks"]);
  });

  // Measured on 2.1.296 to 2.1.300: a queue row and the absorbed attachment carry the message
  // trimmed, so the closing tag ends the text.
  test("reads the trimmed paste of Claude's queue rows", () => {
    expect(unwrapPastes('<pasted_content id="75ce">\nalpha bravo\n</pasted_content id="75ce">')).toBe("alpha bravo");
  });

  test("leaves text that only mentions the tag alone", () => {
    expect(unwrapPastes('Claude logs <pasted_content id="x"> around a paste')).toBe('Claude logs <pasted_content id="x"> around a paste');
  });
});

describe("deliveryVerdict", () => {
  const sent = words(240); // about 1 500 characters, one line

  test("a log that holds the whole message is complete, whatever Claude did to its whitespace", () => {
    expect(deliveryVerdict(sent, sent)).toEqual({ verdict: "complete" });
    expect(deliveryVerdict(sent, `${wrap(sent.slice(0, 1022))}\n${sent.slice(1022)}`)).toEqual({ verdict: "complete" });
    const lines = sent.replaceAll(" word1", "\nword1");
    expect(deliveryVerdict(lines, wrap(lines))).toEqual({ verdict: "complete" });
  });

  test("a log holding only the tail is incomplete, and says how much arrived", () => {
    const tail = sent.slice(1022);
    expect(deliveryVerdict(sent, tail)).toEqual({ verdict: "incomplete", sentChars: sent.length, receivedChars: tail.length });
    expect(deliveryVerdict(`${sent} OK.`, "OK.")).toMatchObject({ verdict: "incomplete", receivedChars: 3 });
  });

  test("nothing logged, or a message Claude rewrites on purpose, cannot be judged", () => {
    expect(deliveryVerdict(sent, null)).toEqual({ verdict: "unknown" });
    // Claude attaches an image path as `[Image #1]`, so the log is shorter by design.
    expect(deliveryVerdict(`look at this /tmp/up/w1_p1-shot.png ${sent}`, `[Image #1] look at this ${sent}`)).toEqual({ verdict: "unknown" });
    // A log longer than the message, or different in content, is a rewrite this check does not model.
    expect(deliveryVerdict("short", "short and then some")).toEqual({ verdict: "unknown" });
  });
});
