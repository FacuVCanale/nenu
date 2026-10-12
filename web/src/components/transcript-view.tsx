import { TranscriptQuestion } from "./transcript-question";
import { FileMediaContext } from "@/lib/file-preview-context";
import { filePathsInText, sentFiles } from "@/lib/chat-files";
import { IMAGE_EXTENSION, imageLabel, journalImages, splitMessageImages } from "@/lib/message-images";
import { ArtifactCards } from "./artifact-card";
import { ChatMedia } from "./chat-media";
import { MediaViewerContext } from "./file-preview-provider";
import { ImageStrip, JournalImages, type StripImage } from "./message-images";
import { useContext, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import { clockTime as formatClock } from "@/lib/format";
import { searchableText } from "@/lib/transcript-search";
import { Highlight, LiveStepRow, relabel, ThinkingStep, ToolStep, useToolImages } from "@/components/work-log-tools";
import { Elapsed, WorkActivityLabel } from "@/components/work-activity-label";
import { buildWorkTimeline, formatWorkDuration, liveStep, type LiveStep, type WorkTurn } from "@/lib/work-timeline";
import type { AgentStatus, TranscriptEntry, TranscriptPart } from "@/lib/types";

// Renders an agent transcript — the conversation history a Claude pane's terminal structurally
// cannot hold (it runs on the alternate screen, which keeps no scrollback ring; see
// bridge/transcript.ts). This is a DIFFERENT representation from the terminal mirror, deliberately:
// the mirror is a faithful 51-row snapshot of a TUI, while this is the thread itself — role-tagged
// turns, timestamps, and tool calls folded together with the output they produced.
//
// XSS boundary, same rule as the mirror: every string from the log reaches the DOM as a React TEXT
// NODE, never as markup. Prose IS parsed as Markdown (lib/markdown.ts) — but that parser emits an
// AST which the renderer maps to React elements, so no HTML string is ever constructed. Do not
// "improve" this by swapping in a markdown→HTML library without re-deriving that boundary.

/** Times only — the date lives on the day divider, and a phone row has no width to spare. */
function clockTime(iso: string): string {
  const ts = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ts) ? "" : formatClock(ts);
}

function dayKey(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Whether a folded body holds the searched words, so the hit is on screen. */
function holds(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle !== "" && text.toLowerCase().includes(needle);
}

const META_LINE = "flex min-h-8 max-w-full items-center gap-2 text-left text-footnote text-muted-foreground coarse:min-h-11";

/** Injected text as one quiet line: a loaded skill, a notification. It opens onto its body when it has more than its caption. */
function ContextLine({ label, text, truncated, query, focused = false }: { label: string; text: string; truncated?: boolean; query: string; focused?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const caption = <span className="min-w-0 truncate"><Highlight text={label} query={query} /></span>;
  if (text.trim() === "" || text.trim() === label) return <div data-notice className={META_LINE}>
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center"><span className="size-1 rounded-full bg-current" /></span>
    {caption}
  </div>;
  const open = expanded || focused || holds(text, query);
  return <div data-notice>
    <button type="button" data-work-toggle aria-expanded={open} onClick={() => setExpanded((value) => !value)} className={`${META_LINE} hover:text-foreground`}>
      <ChevronRight aria-hidden="true" className={`size-4 shrink-0 p-px ${open ? "rotate-90" : ""}`} />
      {caption}
    </button>
    {open && <div className="pb-2 pl-6 text-muted-foreground [overflow-wrap:anywhere]"><MarkdownText text={text} query={query} />
      {truncated && <p className="text-footnote">… truncated</p>}</div>}
  </div>;
}

/** Compaction marks where the session's earlier context was summarised: a divider, with the summary behind it. */
function CompactionLine({ text, time, truncated, query, focused = false }: { text: string; time: string; truncated: boolean; query: string; focused?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded || focused || holds(text, query);
  const rule = <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border" />;
  const caption = <span className="shrink-0"><Highlight text="Context compacted" query={query} />{time && ` · ${time}`}</span>;
  if (!text) return <div data-notice className="flex min-h-8 items-center gap-3 text-footnote text-muted-foreground">{rule}{caption}{rule}</div>;
  return <div data-notice>
    <button type="button" data-work-toggle aria-expanded={open} onClick={() => setExpanded((value) => !value)}
      className="flex min-h-8 w-full items-center gap-3 text-footnote text-muted-foreground hover:text-foreground coarse:min-h-11">
      {rule}{caption}{rule}
    </button>
    {open && <div className="pb-2 text-muted-foreground [overflow-wrap:anywhere]"><MarkdownText text={text} query={query} />
      {truncated && <p className="text-footnote">… truncated</p>}</div>}
  </div>;
}

/**
 * A note's part as its line. The web is live the moment it is built and the bridge only after a
 * restart, so an older bridge's plain-text note is drawn the same way: its first line, the rest behind it.
 */
function NoteLine({ part, query, focused }: { part: TranscriptPart; query: string; focused: boolean }) {
  if (part.kind === "context") return <ContextLine {...part} query={query} focused={focused} />;
  if (part.kind !== "text") return null;
  const [first = ""] = part.text.trim().split("\n", 1);
  return <ContextLine label={first} text={part.text} truncated={part.truncated} query={query} focused={focused} />;
}

function Part({ part, entryId, id = entryId, query, focused = false, active = false, compactMedia = false, uploads = true, delivers = true }: {
  part: TranscriptPart;
  entryId: string;
  /** The step's own key in the timeline, when an entry holds several. */
  id?: string;
  query: string;
  focused?: boolean;
  active?: boolean;
  compactMedia?: boolean;
  /** False when the entry's journal already holds its images, so upload paths don't show them twice. */
  uploads?: boolean;
  /** False for text that names files without handing them over: no cards, no thumbnails. */
  delivers?: boolean;
}) {
  const media = useContext(FileMediaContext);
  // Inline journal images render as one strip per entry (EntryImages), not part by part.
  if (part.kind === "image") return null;
  // Tool output is COMMAND output, not prose — it stays verbatim in a monospace block (see ToolPart).
  if (part.kind === "tool") return <ToolStep id={id} part={part} owner={entryId} query={query} active={active} focused={focused} />;
  if (part.kind === "thinking") return <ThinkingStep text={part.text} truncated={part.truncated} query={query} focused={focused} />;
  if (part.kind === "context") return <ContextLine {...part} query={query} focused={focused} />;
  // Prose is Markdown, so it renders formatted. MarkdownText emits React elements only — never
  // markup — so this keeps the same XSS boundary the raw text node had.
  return (
    <div>
      <MarkdownText
        text={compactMedia && media ? splitMessageImages(part.text).text : part.text}
        query={query}
      />
      {delivers && <ChatMedia text={part.text} compact={compactMedia} uploads={uploads} />}
      {part.truncated && <div className="text-xs text-muted-foreground">… truncated</div>}
    </div>
  );
}

/** The images an entry holds inline, as one gallery; the user's sit in the bubble like uploads. */
function EntryImages({ entry }: { entry: TranscriptEntry }) {
  const images = journalImages(entry);
  return images.length ? <JournalImages entry={entry.uuid} images={images} className="pt-1" /> : null;
}

function Turn({
  entry,
  showHeader,
  query,
  focused = false,
}: {
  entry: TranscriptEntry;
  /** False for a turn continuing the same speaker's run: only the run's first bubble shows its time. */
  showHeader: boolean;
  query: string;
  focused?: boolean;
}) {
  const time = clockTime(entry.ts);
  const inline = journalImages(entry).length > 0;

  // Neither of these is speech, so each is one quiet line, attributed to neither party, its body
  // folded behind it. Their file names stay text: a recap or an injected note names files relative
  // to folders of its own, it does not deliver them.
  if (entry.role === "summary" || entry.role === "note") {
    const recap = entry.parts.map((part) => (part.kind === "text" ? part.text : "")).join("\n\n").trim();
    return (
      <div title={time || undefined}>
        {entry.role === "summary"
          ? <CompactionLine text={recap} time={time}
              truncated={entry.parts.some((part) => part.kind === "text" && part.truncated)} query={query} focused={focused} />
          : entry.parts.map((part, i) => <NoteLine key={i} part={part} query={query} focused={focused} />)}
        <EntryImages entry={entry} />
      </div>
    );
  }

  // A chat, not a log: your messages are soft bubbles on the right, the agent's are plain text on
  // the left. The header already names the agent, so neither side repeats a speaker label; the time
  // sits under your bubble and on hover for the agent.
  // What a command of theirs loaded (a skill's body) is not their words: a line beside the bubble.
  if (entry.role === "user") {
    const loaded = entry.parts.filter((part) => part.kind === "context");
    return (
      <div data-speaker="user" className="flex flex-col items-end" title={time || undefined}>
        <div className="max-w-[85%] min-w-0 space-y-1.5 rounded-xl rounded-br-md bg-muted px-3.5 py-2 [overflow-wrap:anywhere]">
          {entry.parts.map((part, i) => part.kind === "context" ? null : (
            <Part key={i} part={part} entryId={entry.uuid} query={query} focused={focused} compactMedia uploads={!inline} />
          ))}
          <EntryImages entry={entry} />
        </div>
        {showHeader && time && <time dateTime={entry.ts} className="mt-1 px-1 text-footnote leading-none text-muted-foreground">{time}</time>}
        {loaded.map((part, i) => <div key={i} className="max-w-[85%] min-w-0"><ContextLine {...part} query={query} focused={focused} /></div>)}
      </div>
    );
  }
  return (
    <div data-speaker="assistant" className="space-y-1.5 px-0.5" title={time || undefined}>
      {entry.parts.map((part, i) => (
        <Part key={i} part={part} entryId={entry.uuid} query={query} focused={focused} />
      ))}
      <EntryImages entry={entry} />
    </div>
  );
}

/** The parts of an entry that draw as steps: images go to one gallery, the live step to the bottom row. */
function stepParts(entry: TranscriptEntry, live: LiveStep | null) {
  return entry.parts.flatMap((part, index) => part.kind === "image" || (live?.entry === entry.uuid && live.index === index) ? [] : [{ part, index }]);
}

/** A turn's work, one step per row, in the order it happened. */
function ActivityLog({ entries, query, focusedUuid, active, live }: { entries: TranscriptEntry[]; query: string; focusedUuid?: string; active: boolean; live: LiveStep | null }) {
  return <ol className="min-w-0">
    {entries.map((entry) => {
      const steps = stepParts(entry, live);
      if (!steps.length && !journalImages(entry).length) return null;
      const focused = focusedUuid === entry.uuid;
      return <li key={entry.uuid} data-turn={entry.uuid} className={focused ? "rounded ring-2 ring-primary/60" : undefined}>
        {steps.map(({ part, index }) => <Part key={index} part={part} entryId={entry.uuid} id={`${entry.uuid}:${index}`} query={query} focused={focused} active={active} />)}
        <EntryImages entry={entry} />
      </li>;
    })}
  </ol>;
}

function WorkTurnView({ turn, query, focusedUuid, questionActive }: { turn: WorkTurn; query: string; focusedUuid?: string; questionActive: boolean }) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const needle = query.trim().toLowerCase();
  const searching = turn.activity.some((entry) => entry.uuid === focusedUuid || (needle !== "" && searchableText(entry).toLowerCase().includes(needle)));
  const open = searching || (expanded ?? !turn.settled);
  const tools = turn.activity.flatMap((entry) => entry.parts.filter((part) => part.kind === "tool"));
  const failures = tools.filter((part) => part.result?.isError).length;
  const live = liveStep(turn);
  const hasDetails = turn.activity.some((entry) => stepParts(entry, live).length > 0 || journalImages(entry).length > 0);
  const label = turn.interrupted ? "Stopped" : turn.settled ? "Worked" : "Work log";
  const duration = turn.durationMs !== undefined ? ` ${turn.interrupted ? "after" : "for"} ${formatWorkDuration(turn.durationMs)}` : "";
  // One time per turn, when it finished: the question's time is already under its bubble.
  const end = turn.settled ? turn.entries.at(-1)?.ts ?? "" : "";
  const endTime = clockTime(end);
  // The live step's own entry may have nothing else to draw; the live row then carries its scroll marker.
  const liveEntry = live?.entry ? turn.activity.find((entry) => entry.uuid === live.entry) : undefined;
  const liveMarker = liveEntry && !stepParts(liveEntry, live).length && !journalImages(liveEntry).length ? liveEntry.uuid : undefined;
  const viewer = useContext(MediaViewerContext);
  const toolImages = useToolImages();
  // Folded work still shows what the agent looked at, as one gallery for the turn.
  const turnImages: StripImage[] = open ? [] : relabel(turn.activity.flatMap((entry) => [
    ...entry.parts.flatMap((part) => part.kind === "tool" ? toolImages(part, entry.uuid) : []),
    ...journalImages(entry).map(({ index }) => ({ src: viewer?.journalUrl(entry.uuid, index), label: imageLabel(0), item: { kind: "journal" as const, entry: entry.uuid, index, label: imageLabel(0) } })),
  ]));
  const answerPaths = turn.answer ? turn.answer.parts.flatMap((part) => part.kind === "text" ? filePathsInText(part.text) : []) : [];
  const delivered = [...new Set(turn.activity.flatMap((entry) => entry.parts.flatMap(sentFiles)))]
    .filter((path) => !IMAGE_EXTENSION.test(path) && !answerPaths.some((mention) => path === mention || path.endsWith(`/${mention.replace(/^\.\//, "")}`)));
  return <div className="space-y-2" data-work-turn={turn.id}>
    <div className="flex max-w-full flex-wrap items-center gap-x-1.5 text-footnote text-muted-foreground">
      <button type="button" data-work-toggle aria-expanded={open} disabled={!hasDetails}
        onClick={() => setExpanded(!open)} className="flex min-h-8 min-w-0 items-center gap-1.5 text-left hover:text-foreground disabled:opacity-100 coarse:min-h-11">
        <ChevronRight aria-hidden="true" className={`size-3.5 shrink-0 ${open ? "rotate-90" : ""}`} />
        {turn.active ? <Elapsed since={turn.startedAt} prefix="Working for " fallback="Working…" /> : <span>{label}{turn.settled ? duration : ""}</span>}
        {failures > 0 && <span className="whitespace-nowrap text-destructive">· {failures} failed</span>}
      </button>
      {endTime && <span className="whitespace-nowrap">· <time dateTime={end}>{endTime}</time></span>}
    </div>
    {tools.flatMap((part, toolIndex) => (part.questions ?? []).map((question, index) =>
      <TranscriptQuestion key={`${toolIndex}:${index}`} {...question} active={questionActive && !part.result} />))}
    {/* The rail under the turn's line ties its steps to it; a running turn keeps its live row under it, open or folded. */}
    {(open || live) && <div className="ml-[7px] min-w-0 border-l pl-3">
      {open && <ActivityLog entries={turn.activity} query={query} focusedUuid={focusedUuid} active={turn.active} live={live} />}
      {live && <LiveStepRow step={live} marker={liveMarker} />}
    </div>}
    {turn.answer && <div data-turn={turn.activity.some((entry) => entry.uuid === turn.answer!.uuid) ? undefined : turn.answer.uuid}
      className={turn.answer.uuid === focusedUuid ? "rounded ring-2 ring-primary/60" : undefined}>
      <Turn entry={turn.answer} showHeader query={query} focused={turn.answer.uuid === focusedUuid} />
    </div>}
    <ArtifactCards paths={delivered} />
    <ImageStrip images={turnImages} max={3} label="Images from this turn" />
  </div>;
}

export function TranscriptView({ entries, query = "", focusedUuid, activityStatus, activityLabel = true, onWorkToggle }: {
  entries: TranscriptEntry[];
  query?: string;
  focusedUuid?: string;
  activityStatus?: AgentStatus;
  /** False while the trailing Working… belongs under a message the journal does not show yet. */
  activityLabel?: boolean;
  onWorkToggle?: (anchor: HTMLElement) => void;
}) {
  // A question is pending until its call has a result: Claude records the answer as the
  // AskUserQuestion tool_result, which can land without any user-typed turn after it.
  const questionIndex = entries.findLastIndex((entry) => entry.parts.some((part) => part.kind === "tool" && part.questions?.length));
  const questionOpen = entries[questionIndex]?.parts.some((part) => part.kind === "tool" && !!part.questions?.length && !part.result);
  const pendingQuestion = questionOpen && questionIndex > entries.findLastIndex((entry) => entry.role === "user") ? entries[questionIndex]?.uuid : undefined;
  const rows = useMemo(() => buildWorkTimeline(entries, activityStatus), [entries, activityStatus]);
  let lastDay = "";
  let lastRole = "";
  const last = entries.at(-1);
  const pending = activityLabel && activityStatus === "working" && !rows.some((row) => row.kind === "work" && row.active) &&
    (!last || last.role === "user" || (last.role === "assistant" && last.phase !== "final_answer" && last.turn?.status !== "completed" && last.turn?.status !== "aborted"));
  return <div className="space-y-3" onClickCapture={(event) => {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-work-toggle]") : null;
    if (anchor) onWorkToggle?.(anchor);
  }}>
    {rows.map((row) => {
      const entry = row.kind === "message" ? row.entry : row.entries[0]!;
      const day = dayKey(entry.ts);
      const newDay = day !== "" && day !== lastDay;
      if (newDay) lastDay = day;
      const showHeader = newDay || entry.role !== lastRole;
      lastRole = entry.role;
      return <div key={row.kind === "message" ? `message:${entry.uuid}` : `work:${row.id}`} data-turn={row.kind === "message" ? entry.uuid : undefined}
        className={`${showHeader ? "space-y-3 pt-1" : "space-y-3"} ${row.kind === "message" && entry.uuid === focusedUuid ? "rounded-lg ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`}>
        {newDay && <div className="pt-1 text-center text-footnote text-muted-foreground"><time dateTime={entry.ts}>{day}</time></div>}
        {row.kind === "message" ? <Turn entry={entry} showHeader={showHeader} query={query} focused={entry.uuid === focusedUuid} />
          : <WorkTurnView turn={row} query={query} focusedUuid={focusedUuid} questionActive={row.entries.some((entry) => entry.uuid === pendingQuestion)} />}
      </div>;
    })}
    {pending && <div className="px-0.5 py-1" role="status"><WorkActivityLabel startedAt={last?.role === "user" ? last.ts : undefined} /></div>}
  </div>;
}
