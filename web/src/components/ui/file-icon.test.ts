import { expect, it } from "vitest";

import { fileIcon } from "./file-icon";
import { FileArchive, FileAudio, FileBraces, FileCode, FileCog, FileCsv, FileCss, FileDatabase, FileDiff, FileDoc, FileHtml, FileImage, FilePdf,
  FileSpreadsheet, FileTerminal, FileText, FileType, FileVideo, JavaScript, Python, TypeScript } from "./icon";

// Fran asked for each row in Files to show the kind of file it is, and the document every row showed
// until then for any kind Nenu does not know.
it("draws each kind of file with its own icon, by the name's extension in any case", () => {
  const cases: Array<[string, unknown]> = [
    ["report.md", FileType], ["notes.txt", FileType], ["docs/guide.mdx", FileType],
    ["src/app.ts", TypeScript], ["src/view.tsx", TypeScript], ["scripts/check.mjs", JavaScript], ["web/main.js", JavaScript],
    ["package.json", FileBraces], ["src/index.css", FileCss], ["public/index.html", FileHtml], ["tools/run.py", Python],
    ["src/main.rs", FileCode], ["cmd/server.go", FileCode], ["scripts/setup.sh", FileTerminal], ["config.yaml", FileCog],
    ["Cargo.toml", FileCog], [".env", FileCog], ["db/schema.sql", FileDatabase], ["exports/orders.csv", FileCsv],
    ["sales.xlsx", FileSpreadsheet], ["brief.docx", FileDoc], ["invoice.pdf", FilePdf], ["release.zip", FileArchive],
    ["backup.tar.gz", FileArchive], ["shots/after.PNG", FileImage], ["logo.svg", FileImage], ["demo.mp4", FileVideo],
    ["voice.m4a", FileAudio], ["fix.patch", FileDiff],
  ];
  for (const [path, icon] of cases) expect([path, fileIcon(path)]).toEqual([path, icon]);
});

it("keeps the document for a file it does not know", () => {
  for (const path of ["data.bin", "Makefile", "archive.unknownext", "folder.d/notes"]) expect(fileIcon(path)).toBe(FileText);
});
