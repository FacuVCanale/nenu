import { parseMarkdown, type MdBlock } from "./markdown";
import { tableHtml, tableMarkdown } from "./table-copy";

// A table the chat draws copies as what the agent wrote, cell by cell: Markdown for a text field,
// HTML for a spreadsheet or a document, which paste it as cells.
const table = (source: string) => parseMarkdown(source).find((b): b is Extract<MdBlock, { kind: "table" }> => b.kind === "table")!;
const SOURCE = [
  "| Opción | **Latencia** | Riesgo |",
  "|:---|---:|:---:|",
  "| A — `cache` | 120 ms | a \\| b |",
  "| [B](https://example.com) | 85 ms | <script> |",
].join("\n");

describe("tableMarkdown", () => {
  it("writes the cells as plain text, keeps each column's alignment and escapes a pipe", () => {
    expect(tableMarkdown(table(SOURCE))).toBe([
      "| Opción | Latencia | Riesgo |",
      "| :--- | ---: | :---: |",
      "| A — cache | 120 ms | a \\| b |",
      "| B | 85 ms | <script> |",
    ].join("\n"));
  });
});

describe("tableHtml", () => {
  it("writes a header row and body rows, every cell escaped as text", () => {
    expect(tableHtml(table(SOURCE))).toBe(
      "<table><thead><tr><th>Opción</th><th>Latencia</th><th>Riesgo</th></tr></thead><tbody>" +
      "<tr><td>A — cache</td><td>120 ms</td><td>a | b</td></tr>" +
      "<tr><td>B</td><td>85 ms</td><td>&lt;script&gt;</td></tr>" +
      "</tbody></table>",
    );
  });
});
