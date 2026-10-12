import type { MdAlign, MdBlock, MdSpan } from "./markdown";

// A chat table as the clipboard takes it: the cells' plain text, as a Markdown table (what the agent
// wrote, for a text field) and as an HTML table (which a spreadsheet or a document pastes as cells).
// The HTML only ever reaches the clipboard, never the DOM, and every cell is escaped as text.

type Table = Extract<MdBlock, { kind: "table" }>;

/** A cell's words without their formatting: a link's label, an image's alt, code's text. */
function plain(spans: readonly MdSpan[]): string {
  return spans.map((span) => ("spans" in span ? plain(span.spans) : span.kind === "image" ? span.alt : span.text)).join("");
}

const DELIMITER: Record<NonNullable<MdAlign> | "none", string> = { none: "---", left: ":---", center: ":---:", right: "---:" };

export function tableMarkdown(table: Table): string {
  const row = (cells: readonly MdSpan[][]) => `| ${cells.map((cell) => plain(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
  return [row(table.header), `| ${table.align.map((align) => DELIMITER[align ?? "none"]).join(" | ")} |`, ...table.rows.map(row)].join("\n");
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function tableHtml(table: Table): string {
  const cells = (tag: "th" | "td", row: readonly MdSpan[][]) => `<tr>${row.map((cell) => `<${tag}>${escape(plain(cell))}</${tag}>`).join("")}</tr>`;
  return `<table><thead>${cells("th", table.header)}</thead><tbody>${table.rows.map((row) => cells("td", row)).join("")}</tbody></table>`;
}
