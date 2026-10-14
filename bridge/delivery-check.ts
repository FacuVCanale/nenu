import { classifyUserText } from "./journal/claude.ts";
import { readAppended, type TailState } from "./journal/lines.ts";

// What Claude itself logged for a message Nenu just submitted (ADR 0067, ADR 0075).
//
// The guarded send verifies a long message by Claude's paste token, which says nothing about what the
// token holds. Measured on Claude Code 2.1.296, 2.1.299 and 2.1.300 under Herdr 0.9.3 on macOS: the
// PTY hands a 1 500-character send to Claude as two reads, 1 022 and 478 bytes; Claude takes the
// first as a paste and about two times in three logs only the second. The box then shows the literal
// tail, a slice of the message like any windowed draft, so the screen said "sent". The log is the
// only witness of what arrived.

/** The newest bytes the first look reads; later looks read only what was appended since. */
const FIRST_LOOK_BYTES = 1024 * 1024;

/** Claude logs a paste as `\n\n<pasted_content id="…">\n<text>\n</pasted_content id="…">\n`. */
const PASTE = /\n{0,2}<pasted_content id="([^"]*)">\n([\s\S]*?)\n<\/pasted_content id="\1">\n/g;

/** A message as Claude logged it, with the paste wrappers taken off. */
export function unwrapPastes(text: string): string {
  return text.replace(PASTE, (_all, _id: string, inner: string) => inner);
}

/** The operator's typed message in one log line, and when Claude logged it; null for any other row. */
export function loggedMessage(line: string): { at: number; text: string } | null {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (row.type !== "user" || typeof row.timestamp !== "string") return null;
  const at = Date.parse(row.timestamp);
  const content = (row.message as { content?: unknown } | undefined)?.content;
  let raw: string;
  if (typeof content === "string") raw = content;
  else if (Array.isArray(content) && content.every((block) => (block as { type?: unknown })?.type !== "tool_result")) {
    raw = content.flatMap((block) => ((block as { type?: unknown }).type === "text" ? [String((block as { text?: unknown }).text ?? "")] : [])).join("");
  } else return null;
  const classified = classifyUserText(raw, { origin: row.origin, isMeta: row.isMeta });
  if (classified?.role !== "user" || classified.command !== undefined || classified.text.startsWith("! ")) return null;
  return Number.isNaN(at) ? null : { at, text: raw };
}

/** Whether Claude queued a message at or after `since` (it was busy): its own row comes later. */
function queuedSince(line: string, since: number): boolean {
  if (!line.includes('"queue-operation"')) return false;
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    return row.type === "queue-operation" && row.operation === "enqueue" && typeof row.timestamp === "string" && Date.parse(row.timestamp) >= since;
  } catch {
    return false;
  }
}

export type DeliveryVerdict =
  | { verdict: "complete" }
  | { verdict: "incomplete"; sentChars: number; receivedChars: number }
  | { verdict: "unknown" };

/** A path to an image Claude attaches as `[Image #N]`, which shortens the logged text on purpose. */
const IMAGE_PATH = /(?:^|\s)["']?(?:\/|[A-Za-z]:\\)\S*\.(?:png|jpe?g|gif|webp)\b/i;
const strip = (s: string) => s.replace(/\s+/g, "");

/**
 * Whether `received` (Claude's log of the message) holds all of `sent`. Whitespace is not compared:
 * Claude re-flows it around a paste. A log with fewer characters is incomplete; one Claude rewrites by
 * design (an attached image) or that differs some other way is not judged.
 */
export function deliveryVerdict(sent: string, received: string | null): DeliveryVerdict {
  if (received === null || IMAGE_PATH.test(sent)) return { verdict: "unknown" };
  const want = strip(sent);
  const got = strip(unwrapPastes(received));
  if (got === want) return { verdict: "complete" };
  if (got.length < want.length) return { verdict: "incomplete", sentChars: sent.length, receivedChars: unwrapPastes(received).trim().length };
  return { verdict: "unknown" };
}

/**
 * Looks at a Claude session's log after a send. Each call reads only what was appended since the
 * last one and answers the first typed message logged at or after `since`; null while there is
 * none yet, undefined when there is nothing to wait for (no log, or Claude queued the message).
 */
export function claudeLogReader(transcript: () => Promise<string | null>): (since: number) => Promise<string | null | undefined> {
  let path: string | null = null;
  let tail: TailState | undefined;
  return async (since) => {
    path ??= await transcript().catch(() => null);
    // A first message creates the log, so a missing one is worth another look.
    if (path === null) return null;
    let lines: string[];
    try {
      ({ lines, tail } = await readAppended(path, FIRST_LOOK_BYTES, tail));
    } catch {
      return undefined;
    }
    for (const line of lines) {
      if (queuedSince(line, since)) return undefined;
      const message = loggedMessage(line);
      if (message && message.at >= since) return message.text;
    }
    return null;
  };
}
