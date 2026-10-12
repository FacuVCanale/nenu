import type { PromptModel } from "../web/src/lib/harness/prompt-model.ts";
import type { InteractionSubject } from "./types.ts";

// What a prompt is about, read from the dialog's own rows: the subject a permission asks to run or
// change, and the option rows the screen shows but the card never answers. Display only: the keys an
// answer sends never come from here (ADR 0057), so a layout this misreads costs a label, not a key.

/** A rule that closes the transcript above a Claude dialog. */
const RULE = /^\s*[─━▔═]{8,}\s*$/;
/** The dashed rule Claude draws around a command or a file preview. */
const DASHED = /^\s*╌{8,}\s*$/;
/** A numbered option row of any harness: `❯ 1. Yes`, `› 1. Yes, proceed (y)`, `┃  1 (●) Yes`. */
const OPTION_ROW = /^[❯›>]?\s*(\d{1,2})(?:\.|\s+\([●○ ]\))\s+(.+)$/;
/** How far above its question a permission's subject may reach: a heredoc prints in full. */
const SUBJECT_MAX_ROWS = 40;
/** A key the terminal names after a label or description: nothing a phone can press. */
const KEY_HINT = /\s*\((?:shift\+tab|tab|esc|enter|ctrl\+[a-z])\)(\.?)\s*$/i;
/** An option that changes a setting beyond this answer ("don't ask again", "this session"). */
export const PERSISTENT = /\b(always|don['’]?t ask again|do not ask again|this session|auto mode|switch to|from this project|remember|as default)\b/i;
/** Claude's own chrome between the tool and the subject. */
const CHROME = /^(?:This command requires approval)$/i;
const TIP = /^Tip:/;

/** `text` without a trailing terminal key hint ("(shift+tab)", "(tab).", "(esc)"). */
export function stripKeyHint(text: string): string {
  return text.replace(KEY_HINT, "$1");
}

const indentOf = (row: string) => row.search(/\S/);
/** A row with the `┃`/`│` gutter some harnesses draw down a dialog's left edge removed. */
const ungutter = (row: string) => row.replace(/^\s*[┃│](?:\s|$)/, "  ").replace(/\s+$/, "");

/** The row holding the question, or -1. */
export function questionRow(lines: readonly string[], question: string): number {
  return lines.findIndex((l) => l.includes(question.slice(0, 40)));
}

interface OptionBlock {
  /** First row of the option run. */
  start: number;
  /** Each option row's number and label, continuation rows joined. */
  rows: Array<{ n: string; label: string }>;
}

/**
 * The run of option rows at the bottom of a dialog, found from the bottom up: option rows and the
 * deeper-indented rows a long label wraps onto. Anything else above it (a command, a heredoc line
 * that happens to start with a number) belongs to the subject.
 */
function optionBlock(lines: readonly string[], below: number): OptionBlock | null {
  const rows = lines.map(ungutter);
  // Up past the footer to the last option row, or to a wrapped row of its label.
  let i = rows.length - 1;
  while (i > below && !OPTION_ROW.test(rows[i]!.trim()) && (rows[i]!.trim() === "" || indentOf(rows[i]!) < 5)) i--;
  const found: Array<{ n: string; label: string }> = [];
  let tail: string[] = [];
  let start = -1;
  for (; i > below; i--) {
    const row = rows[i]!;
    const option = OPTION_ROW.exec(row.trim());
    if (option) {
      found.unshift({ n: option[1]!, label: [option[2]!.trim(), ...tail].join(" ") });
      tail = [];
      start = i;
      continue;
    }
    // A wrapped label sits deeper than the option rows; a blank or shallower row ends the run.
    if (row.trim() === "" || indentOf(row) < 5) break;
    tail.unshift(row.trim());
  }
  return start < 0 ? null : { start, rows: found };
}

/** A label without its trailing shortcut, the way the grammars serve it: "(p)", "(esc)", "(type to add feedback)". */
const bareLabel = (label: string) => label.replace(/\s*\([^()]*\)\s*$/, "").trim();
const compact = (s: string) => s.replace(/\s+/g, "");

/**
 * The option rows the screen shows that the prompt does not serve: Codex's and Grok's persistent
 * "don't ask again" rows, which the grammars never make buttons. Named so the card can say they exist.
 */
export function terminalOnly(p: PromptModel): string[] {
  if (p.family !== "permission") return [];
  const lines = p.signature.split("\n");
  const block = optionBlock(lines, questionRow(lines, p.question));
  if (!block) return [];
  const served = new Set(p.options.map((o) => o.keyLabel ?? o.keys[0]));
  const labels = new Set(p.options.map((o) => compact(bareLabel(o.label))));
  // Only a persistent row: an open amend field also replaces a row's label, and it is no option.
  return block.rows
    .filter((row) => !served.has(row.n) && !labels.has(compact(bareLabel(row.label))) && PERSISTENT.test(row.label))
    .map((row) => stripKeyHint(row.label).replace(/\s*\([a-z]\)$/i, ""));
}

/**
 * Rows the subject is read from: above the question up to the transcript's rule, and between the
 * question and the option run (Codex's `$ command`). Indentation kept, gutters and blanks dropped.
 */
function subjectRows(p: PromptModel): { above: string[]; below: string[]; width: number } | null {
  const lines = p.signature.split("\n");
  const q = questionRow(lines, p.question);
  if (q < 0) return null;
  let top = q;
  while (top > 0 && q - top < SUBJECT_MAX_ROWS && !RULE.test(lines[top - 1]!)) top--;
  // The options start at their run, or at the first served label for a layout the run misreads.
  const firstLabel = p.options[0] ? lines.findIndex((l, i) => i > q && l.includes(p.options[0]!.label)) : -1;
  const end = Math.min(...[optionBlock(lines, q)?.start ?? lines.length, firstLabel].filter((n) => n > q));
  const keep = (rows: string[]) => rows.map(ungutter).filter((r) => r.trim() !== "");
  const rule = lines[top - 1];
  const width = rule !== undefined && RULE.test(rule) ? rule.trimEnd().length : Math.max(...lines.map((l) => l.trimEnd().length));
  return { above: keep(lines.slice(top, q)), below: keep(lines.slice(q + 1, end)), width };
}

/** The subject rows as plain text, Claude's chrome dropped: the card's fallback and a push body's detail. */
export function promptSubjectText(p: PromptModel): string[] {
  const rows = subjectRows(p);
  if (!rows) return [];
  return [...withoutChrome(rows.above), ...rows.below]
    .map((r) => r.replace(/^[\s│┃]+|[\s│┃]+$/g, ""))
    .filter((r) => r && !/^[─━▔═╌]+$/.test(r) && compact(r) !== compact(p.question));
}

/**
 * Claude's Tip (which wraps on a narrow pane, its last row ending "below") and the old "This command
 * requires approval" line: chrome about the dialog, never part of what is asked.
 */
function withoutChrome(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!.trim();
    if (CHROME.test(row)) continue;
    if (!TIP.test(row)) {
      out.push(rows[i]!);
      continue;
    }
    // The Tip runs on over rows at its own indent until its sentence ends.
    let text = row;
    while (!/(?:\bbelow|[.!])$/.test(text) && i + 1 < rows.length && indentOf(rows[i + 1]!) === indentOf(rows[i]!) && !DASHED.test(rows[i + 1]!)) {
      text = rows[++i]!.trim();
    }
  }
  return out;
}

/**
 * Rows a terminal wrapped back into one string. Claude cuts a command at the pane's edge mid-word, so
 * a full row joins the next with nothing; Codex wraps at spaces, so a row joins the next with a space
 * when the next row's first word could not have fitted. Any other break is a real newline.
 */
function unwrap(rows: readonly string[], width: number, by: "char" | "word"): string {
  let out = rows[0]!.trim();
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!.trimEnd();
    const next = rows[i]!.trim();
    const firstWord = next.split(/\s/, 1)[0]!;
    const wrapped = by === "char" ? prev.length >= width - 4 : prev.length + 1 + firstWord.length > width;
    out += wrapped ? (by === "char" ? "" : " ") + next : `\n${next}`;
  }
  return out;
}

/** Common leading indentation removed, so a preview keeps its own alignment and no more. */
function dedent(rows: readonly string[]): string {
  const cut = Math.min(...rows.map(indentOf));
  return rows.map((r) => r.slice(cut).trimEnd()).join("\n");
}

const FILE_TOOL = /\bfile$/i;

function claudeSubject(above: readonly string[], width: number): InteractionSubject | null {
  if (above.length < 2) return null;
  const tool = above[0]!.trim().replace(/\s+command$/i, "");
  const rest = above.slice(1);
  // 2.1.296 fences the command or preview between dashed rules; older versions indent it instead.
  const fence = rest.findIndex((r) => DASHED.test(r));
  const fenced = fence >= 0;
  const meta = withoutChrome(fenced ? rest.slice(0, fence) : rest.filter((r) => indentOf(r) <= indentOf(above[0]!)));
  const fencedRows = rest.slice(fence + 1);
  const close = fencedRows.findIndex((r) => DASHED.test(r));
  const body = fenced
    ? (close < 0 ? fencedRows : fencedRows.slice(0, close))
    : rest.filter((r) => indentOf(r) > indentOf(above[0]!));
  const subject: InteractionSubject = { tool };
  if (FILE_TOOL.test(tool)) {
    if (meta[0]) subject.file = meta[0].trim();
    if (meta.length > 1) subject.description = meta.slice(1).map((r) => r.trim()).join(" ");
    if (body.length) subject.preview = dedent(body);
    return subject;
  }
  if (meta.length) subject.description = meta.map((r) => r.trim()).join(" ");
  // Indented layout: the command, then its description as the last row.
  const commandRows = !fenced && !subject.description && body.length > 1 ? body.slice(0, -1) : body;
  if (!fenced && commandRows !== body) subject.description = body.at(-1)!.trim();
  if (commandRows.length) subject.command = unwrap(commandRows, width, "char");
  return subject;
}

const CODEX_FIELD = /^(Environment|Reason|Description|Destination):\s*(.*)$/;

function codexSubject(below: readonly string[], width: number): InteractionSubject | null {
  const subject: InteractionSubject = {};
  const meta: string[] = [];
  for (let i = 0; i < below.length; i++) {
    const row = below[i]!.trim();
    const field = CODEX_FIELD.exec(row);
    if (row.startsWith("$ ")) {
      subject.command = unwrap(below.slice(i), width, "word").slice(2);
      break;
    }
    if (!field) continue;
    // A field's value runs on over the rows under it until the next field or the command.
    let value = field[2]!;
    while (i + 1 < below.length && !CODEX_FIELD.test(below[i + 1]!.trim()) && !below[i + 1]!.trim().startsWith("$ ")) value += ` ${below[++i]!.trim()}`;
    if (field[1] === "Reason" || field[1] === "Description") subject.description = value;
    else if (field[1] === "Destination") subject.file = value;
    else meta.push(`${field[1]}: ${value}`);
  }
  if (meta.length) subject.meta = meta;
  return subject.command || subject.file || subject.description ? subject : null;
}

/**
 * A permission's subject from its rows: Claude's tool header, description and fenced command or file
 * preview; Codex's Reason, `$ command` and Destination. Other harnesses keep the plain rows.
 */
export function permissionSubject(agent: string, p: PromptModel): InteractionSubject | undefined {
  if (p.family !== "permission") return undefined;
  const rows = subjectRows(p);
  if (!rows) return undefined;
  const subject = agent === "claude" ? claudeSubject(rows.above, rows.width) : agent === "codex" ? codexSubject(rows.below, rows.width) : null;
  return subject ?? undefined;
}
