import { cn } from "@/lib/utils";
import { FileArchive, FileAudio, FileBraces, FileCode, FileCog, FileCsv, FileCss, FileDatabase, FileDiff, FileDoc, FileHtml, FileImage, FilePdf,
  FileSpreadsheet, FileTerminal, FileText, FileType, FileVideo, JavaScript, Python, TypeScript, type IconComponent } from "./icon";

// The icon every list of files draws for a file: its kind, read from the name's extension. A kind not
// listed keeps the document every row drew before.
const KINDS: ReadonlyArray<[IconComponent, string]> = [
  [FileType, "md mdx markdown txt rst adoc"],
  [TypeScript, "ts tsx mts cts"],
  [JavaScript, "js jsx mjs cjs"],
  [Python, "py pyi ipynb"],
  [FileBraces, "json jsonc json5 jsonl ndjson"],
  [FileCss, "css scss sass less"],
  [FileHtml, "html htm"],
  [FileCode, "rs go rb java kt kts swift c h cc cpp hpp cs php lua zig ex exs erl hs scala dart vue svelte astro xml graphql prisma"],
  [FileTerminal, "sh bash zsh fish ps1 bat"],
  [FileCog, "yaml yml toml ini conf cfg env properties lock"],
  [FileDatabase, "sql sqlite db"],
  [FileCsv, "csv tsv"],
  [FileSpreadsheet, "xls xlsx ods numbers"],
  [FileDoc, "doc docx odt rtf pages"],
  [FilePdf, "pdf"],
  [FileArchive, "zip tar gz tgz bz2 xz 7z rar zst"],
  [FileImage, "png jpg jpeg gif webp svg avif heic ico bmp tiff"],
  [FileVideo, "mp4 mov webm mkv avi m4v"],
  [FileAudio, "mp3 wav m4a ogg flac aac"],
  [FileDiff, "diff patch"],
];
const BY_EXTENSION = new Map(KINDS.flatMap(([icon, extensions]) => extensions.split(" ").map((extension) => [extension, icon] as const)));

/** The icon for a file by its name or path: `.env` reads as its extension, a name without one as unknown. */
export function fileIcon(path: string): IconComponent {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return (dot < 0 ? undefined : BY_EXTENSION.get(name.slice(dot + 1).toLowerCase())) ?? FileText;
}

/** A file's icon at a row's 16 px, decorative: the row names the file. */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const Icon = fileIcon(name);
  return <Icon aria-hidden="true" className={cn("size-4", className)} />;
}
