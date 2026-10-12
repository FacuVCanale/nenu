import { useContext, useId, useState, type ReactNode } from "react";
import { Bot, Brain, ChevronRight, FilePen, FilePlus, FileText, Globe, ListTodo, MessageCircleQuestion, Search, SquareTerminal, Wrench, type LucideIcon } from "lucide-react";
import { displayPath } from "@/lib/display-path";
import { FileMediaContext } from "@/lib/file-preview-context";
import { localFilePath } from "@/lib/file-links";
import { IMAGE_EXTENSION, imageLabel } from "@/lib/message-images";
import { splitHighlight } from "@/lib/transcript-search";
import type { TranscriptPart } from "@/lib/types";
import { cn } from "@/lib/utils";
import { describeTool, firstLine, type LiveStep, type StepKind, type ToolStepDescription } from "@/lib/work-timeline";
import { FIND_CURRENT_HIT, FIND_HIT, MarkdownText } from "./markdown-text";
import { MediaViewerContext, type MediaViewer } from "./file-preview-provider";
import { ImageStrip, type StripImage } from "./message-images";
import { Elapsed, LiveGlyph } from "./work-activity-label";

// A turn's work as a timeline: one line per step, its icon, a verb and what it acted on. A step with
// a body (a call's output, a whole thought) opens it under its line; nothing groups steps behind a
// second fold, so a failure is one tap from its output once the turn is open.

type ToolPart = Extract<TranscriptPart, { kind: "tool" }>;

/** Whether `text` holds the searched words: a folded body that does opens, so the hit is on screen. */
export function containsQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle !== "" && text.toLowerCase().includes(needle);
}

function matches(part: ToolPart, query: string) {
  return [part.name, part.summary, part.result?.text ?? ""].some((text) => containsQuery(text, query));
}

/** `text` with find's hits marked; `current` when it belongs to find's current match, whose hits go solid. */
export function Highlight({ text, query, current = false }: { text: string; query: string; current?: boolean }) {
  return <>{splitHighlight(text, query).map((piece, index) => piece.hit
    ? <mark key={index} aria-current={current || undefined} className={cn(FIND_HIT, current && FIND_CURRENT_HIT)}>{piece.text}</mark>
    : <span key={index}>{piece.text}</span>)}</>;
}

// Tools that show the model an image by path; their summary is the path they read.
const VIEW_TOOL = /^(read|view_?image|read_?file|view)$/i;

/**
 * What a call showed the agent: images its result carries in the journal, image files it delivered,
 * or the image a read tool opened by path. Journal images need their entry (`owner`) and the viewer.
 */
function toolImages(part: ToolPart, owner: string | undefined, viewer: MediaViewer | null, url: ((path: string) => string) | null): StripImage[] {
  const attachments = part.result?.attachments ?? [];
  const inline = attachments.flatMap((a) => a.kind === "image" ? [a] : []);
  if (inline.length) return owner ? inline.map(({ index }, i) => ({
    src: viewer?.journalUrl(owner, index), label: imageLabel(i), item: { kind: "journal", entry: owner, index, label: imageLabel(i) },
  })) : [];
  const read = VIEW_TOOL.test(part.name) && !part.result?.isError ? localFilePath(part.summary) : null;
  const files = [...attachments.flatMap((a) => a.kind === "file" ? [a.path] : []), ...(read ? [read] : [])].filter((path) => IMAGE_EXTENSION.test(path));
  return url ? files.map((path) => ({ src: url(path), label: path.split("/").at(-1) ?? path, item: { kind: "file", path } })) : [];
}

/** One gallery across several calls numbers its images once, in order. */
export function relabel(images: StripImage[]): StripImage[] {
  return images.map((image, i) => image.item.kind === "journal"
    ? { ...image, label: imageLabel(i), item: { ...image.item, label: imageLabel(i) } }
    : image);
}

export function useToolImages() {
  const viewer = useContext(MediaViewerContext);
  const url = useContext(FileMediaContext);
  return (part: ToolPart, owner?: string) => toolImages(part, owner, viewer, url);
}

type StepIconKind = StepKind | "question" | "thinking";
const STEP_ICONS: Record<StepIconKind, LucideIcon> = {
  terminal: SquareTerminal, read: FileText, edit: FilePen, write: FilePlus, search: Search, web: Globe, agent: Bot, plan: ListTodo, tool: Wrench,
  question: MessageCircleQuestion, thinking: Brain,
};

/**
 * A call as its line draws it: the timeline's verbs, the words that say what it acted on, and `ask`,
 * the present it reads in while it waits on the operator ("Run"), since it has not run yet.
 */
interface CallStep extends Omit<ToolStepDescription, "kind"> {
  kind: StepKind | "question";
  ask: string;
  text: string;
}

// The present of each of the timeline's past verbs. One it lacks reads in its "…ing" form: a call
// that waits must never read as one that already ran.
const ASK: Record<string, string> = {
  Ran: "Run", Read: "Read", Edited: "Edit", Wrote: "Write", Searched: "Search", Listed: "List", Fetched: "Fetch",
  "Searched the web": "Search the web", "Ran agent": "Run agent", "Updated the plan": "Update the plan",
};

// Claude's AskUserQuestion and Codex's request_user_input, the calls that ask the operator a question.
const QUESTION_TOOL = /^(?:AskUserQuestion|(?:.+\.)?request_user_input(?:_async)?)$/;

/**
 * A call that opens a dialog on the operator reads by what it asks, not by the CLI's name for it: a
 * Question with the question it asks, a Plan with the plan's title. Every other call is the timeline's.
 */
function describeCall(part: ToolPart): CallStep {
  if (QUESTION_TOOL.test(part.name)) return { kind: "question", done: "Question", doing: "Question", ask: "Question", target: "text", text: part.questions?.[0]?.title ?? part.summary };
  // Claude titles most plans "Plan: …", and the line already says Plan.
  if (part.name === "ExitPlanMode") return { kind: "plan", done: "Plan", doing: "Plan", ask: "Plan", target: "text", text: firstLine(part.summary).replace(/^Plan:\s*/i, "") };
  const step = describeTool(part.name);
  return { ...step, ask: ASK[step.done] ?? step.doing, text: part.summary };
}

// 36px on a mouse, 44px under a finger, both from padding around one 20px line.
const LINE = "flex w-full min-w-0 items-center gap-2 py-2 text-left text-subhead min-h-9 coarse:min-h-11";

/** A step in progress: its line carries the live glyph for its icon, and how long it has run. */
type Live = Pick<LiveStep, "since">;

/**
 * A step's line. With `onToggle` it is the button that opens the step's body; without, it keeps the
 * chevron's place, so whatever ends a line sits in one column down the timeline. A toggle reports
 * itself (`data-work-toggle`) so the thread holds still and stops following; a held thread draws no
 * turn as running, so the live step, the tail the thread follows, opens without reporting.
 */
function StepLine({ icon, live, label, expanded, controls, onToggle, children }: {
  icon: ReactNode;
  live?: Live;
  label?: string;
  expanded?: boolean;
  controls?: string;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const lead = live ? <LiveGlyph /> : icon;
  const time = live?.since && <Elapsed since={live.since} className="shrink-0 text-footnote text-muted-foreground" />;
  if (!onToggle) return <div className={LINE}>{lead}{children}{time}<span aria-hidden="true" className="size-3.5 shrink-0" /></div>;
  return <button type="button" data-work-toggle={live ? undefined : true} aria-label={label} aria-expanded={expanded} aria-controls={controls} onClick={onToggle}
    className={cn(LINE, "group")}>
    {lead}{children}{time}
    <ChevronRight aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`} />
  </button>;
}

function StepIcon({ kind }: { kind: StepIconKind }) {
  const Icon = STEP_ICONS[kind];
  return <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}

/**
 * What a step acted on: a path shows its folders muted and its file name whole, code stays monospace.
 * The folders give up whole leading segments first, then lose characters from their start (the rtl
 * box puts the ellipsis on the left), so the folders nearest the file are the ones that stay.
 */
function StepTarget({ text, format, query, current }: { text: string; format: ToolStepDescription["target"] | "thought"; query: string; current: boolean }) {
  if (!text) return <span className="flex-1" />;
  if (format === "path") {
    const { dir, base } = displayPath(text, "", 32);
    return <span className="flex min-w-0 flex-1">
      {dir && <span className="min-w-0 truncate text-muted-foreground [direction:rtl]"><span dir="ltr"><Highlight text={dir} query={query} current={current} /></span></span>}
      <span className="max-w-full shrink-0 truncate text-foreground"><Highlight text={base} query={query} current={current} /></span>
    </span>;
  }
  return <span className={cn("min-w-0 flex-1 truncate text-muted-foreground", format === "code" && "font-mono text-code", format === "thought" && "italic")}>
    <Highlight text={text} query={query} current={current} />
  </span>;
}

/** A finished step that failed says so on its line, so the failure shows before anything opens. */
function FailedChip() {
  return <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/40 px-2 text-caption text-destructive">
    <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />Failed
  </span>;
}

/** A call the operator has to answer for says so on its line: the blocked dot, and the words plain (direction.md). */
function WaitingChip() {
  return <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 text-caption text-foreground">
    <span aria-hidden="true" className="size-1.5 rounded-full bg-status-blocked" />Waiting on you
  </span>;
}

const OUTPUT = "min-w-0 font-mono text-code whitespace-pre-wrap [overflow-wrap:anywhere]";

/**
 * A tool call as one step. Its output stays verbatim text, never Markdown (the XSS boundary). In a
 * turn `waiting` on the operator, a call without its result is what they are asked about: it has not
 * run, so it reads as the request, with no clock and no claim about its output.
 */
export function ToolStep({ id, part, owner, query, active, focused, live, waiting = false }: { id: string; part: ToolPart; owner?: string; query: string; active: boolean; focused: boolean; live?: Live; waiting?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const images = useToolImages();
  const open = expanded || focused || matches(part, query);
  const step = describeCall(part);
  const failed = !!part.result?.isError;
  const asking = waiting && !part.result;
  const running = !part.result && active && !asking;
  const verb = asking ? step.ask : running ? step.doing : step.done;
  const status = failed ? "Failed" : asking ? "Waiting on you" : !part.result && !active ? "No output recorded" : null;
  const truncated = !!part.result?.truncated;
  return (
    <div data-tool={id} data-step={step.kind} className="min-w-0">
      <StepLine icon={<StepIcon kind={step.kind} />} live={asking ? undefined : live} label={[verb, step.text, status, truncated ? "Truncated" : null].filter(Boolean).join(" ")}
        expanded={open} controls={contentId} onToggle={() => setExpanded((value) => !value)}>
        {/* A tool's own name can run long; it gives way before the target's first half and the chip. */}
        <span className={cn("text-foreground", step.kind === "tool" ? "min-w-0 max-w-[45%] truncate" : "shrink-0")}>{verb}</span>
        <StepTarget text={step.text} format={step.target} query={query} current={focused} />
        {failed ? <FailedChip /> : asking ? <WaitingChip /> : status && <span className="shrink-0 text-caption text-muted-foreground">{status}</span>}
        {truncated && <span className="shrink-0 text-caption text-muted-foreground">Truncated</span>}
      </StepLine>
      <ImageStrip images={images(part, owner)} label="Images the tool returned" className="pb-1 pl-6" />
      {/* Under a finger the output takes the row's full width: a phone fits few characters of code a line. */}
      {open && <div id={contentId} className="mb-2 ml-6 min-w-0 space-y-2 rounded-lg bg-muted px-3 py-2 coarse:ml-0">
        <p className="font-mono text-caption text-muted-foreground"><Highlight text={part.name} query={query} current={focused} /></p>
        {part.summary && <pre className={OUTPUT}><Highlight text={part.summary} query={query} current={focused} /></pre>}
        {part.result ? <pre className={OUTPUT}><Highlight text={part.result.text} query={query} current={focused} />{part.result.truncated && <span className="text-muted-foreground">{"\n… output truncated"}</span>}</pre>
          : <p className="text-footnote text-muted-foreground">{asking ? "Waiting for your answer" : active ? "Running…" : "No output recorded"}</p>}
      </div>}
    </div>
  );
}

/** A thought as one italic line of its opening words; the whole of it opens beneath. */
export function ThinkingStep({ text, truncated = false, query, focused = false, live }: { text: string; truncated?: boolean; query: string; focused?: boolean; live?: Live }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const open = expanded || focused || containsQuery(text, query);
  const preview = firstLine(text);
  // Open, the thought is below in full, so its line names it instead of repeating its start. One
  // being written names itself ahead of its opening words.
  const shown = open ? "" : preview;
  return <div data-step="thinking" className="min-w-0">
    <StepLine icon={<StepIcon kind="thinking" />} live={live} label={`Thinking: ${preview}${truncated ? " · truncated" : ""}`} expanded={open} controls={contentId}
      onToggle={preview ? () => setExpanded((value) => !value) : undefined}>
      {(live || !shown) && <span className={cn("shrink-0", live ? "text-foreground" : "text-muted-foreground")}>Thinking</span>}
      <StepTarget text={shown} format="thought" query={query} current={focused} />
    </StepLine>
    {open && preview && <div id={contentId} className="min-w-0 pb-2 pl-6 text-muted-foreground [overflow-wrap:anywhere]">
      <MarkdownText text={text} query={query} current={focused} />
      {truncated && <p className="text-footnote">… truncated</p>}
    </div>}
  </div>;
}

/**
 * The bottom line of a running turn: the step in progress, marked live. It opens like any step, so a
 * command or a thought cut short on a phone can be read whole while it runs. A call the turn is
 * `waiting` on the operator for keeps this place and reads as waiting.
 */
export function LiveStepRow({ step, query, focused, marker, waiting = false }: { step: LiveStep; query: string; focused: boolean; marker?: string; waiting?: boolean }) {
  return <div data-live-step data-turn={marker} className={focused && marker ? "rounded ring-2 ring-primary/60" : undefined}>
    {step.part.kind === "tool"
      ? <ToolStep id={`${step.entry}:${step.index}`} part={step.part} owner={step.entry} query={query} active focused={focused} live={step} waiting={waiting} />
      : <ThinkingStep text={step.part.text} truncated={step.part.truncated} query={query} focused={focused} live={step} />}
  </div>;
}
