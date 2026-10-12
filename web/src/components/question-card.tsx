import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, ChevronLeft, ChevronRight, Keyboard, Loader2, MessageSquareText, RefreshCw, TerminalSquare } from "lucide-react";

import { MarkdownText } from "@/components/markdown-text";
import { RecommendedBadge, recommendedLabel } from "@/components/recommended-badge";
import { isToggle, type AnswerExtra, type Receipt } from "@/hooks/use-interactions";
import { FEEDBACK_MAX_LENGTH } from "@/lib/prompt-action";
import type {
  AnswerOutcome,
  BridgeStatus,
  Interaction,
  InteractionAnswer,
  InteractionKind,
  InteractionOption,
  InteractionStep,
  InteractionSubject,
} from "@/lib/types";
import { cn } from "@/lib/utils";

// One card for every dialog the bridge detected (ADR 0057): the newest line of a thread, and compact
// on Home. A tap is one POST naming the option by index; the bridge re-reads the screen, refuses a
// stale signature and owns every key. Text stays React text nodes (the XSS boundary).

/** How long a persistent option stays armed for its confirming second tap. */
export const CONFIRM_MS = 5_000;

/** Dialogs whose plain options are answers of equal weight, drawn as one list. */
const ANSWER_KINDS = new Set<InteractionKind>(["question", "wizard", "multi-select"]);
/** Rows of a command or file preview shown before "Show all": the thread's own scroll reads the rest. */
const SUBJECT_ROWS = 8;
/** A multi-select's advance that sends the answers, as opposed to a wizard step's Next. */
const SUBMIT = /^submit\b/i;

/** Why answers are paused, so the card names the real cause and never blames the device for an outage. */
export type LockReason = "read-only" | "offline" | "herdr" | "refused";

const LOCK_COPY: Record<LockReason, string> = {
  "read-only": "Read-only on this device. Answer from an authorised one.",
  offline: "Answers are paused until Nenu reconnects.",
  herdr: "Herdr isn't responding. Answers are paused.",
  refused: "Sign in again to answer.",
};

/** The lock a snapshot implies: a read-only device first, then a refused or failed read, then Herdr itself. */
export function lockReasonOf(s: { readOnly: boolean; error: boolean; authError: boolean; bridge: BridgeStatus | undefined }): LockReason | undefined {
  if (s.readOnly) return "read-only";
  if (s.error) return s.authError ? "refused" : "offline";
  return s.bridge === "connected" ? undefined : "herdr";
}

export interface QuestionCardProps {
  interaction?: Interaction;
  /** Shown instead of a card once the dialog was answered and before the pane's next one. */
  receipt?: Receipt;
  onAnswer: (option: InteractionOption, extra?: AnswerExtra) => Promise<AnswerOutcome>;
  /** Answers are paused for a reason the caller does not name. Prefer `lockReason`. */
  readOnly?: boolean;
  /** Why answers are paused; the card says it and keeps every answer from firing. */
  lockReason?: LockReason;
  /** Why the tap on the dialog this one replaced did nothing ("The question changed…"). */
  refused?: string;
  /** Home's variant: one line of options and the question clamped. */
  compact?: boolean;
  /** Who is asking (the pane's name), for a card shown away from its thread. */
  title?: ReactNode;
  /** Where the full dialog lives: the terminal mirror in a thread, the thread from Home. */
  onOpen?: () => void;
  openLabel?: string;
  /** The keys pad next to the terminal, for a text row the card cannot type (Home has none: `onOpen` is on the card). */
  onKeys?: () => void;
  /**
   * A permission or plan may be approved only while its whole command, file or plan is on the card;
   * otherwise the card offers `onOpen` instead (ADR 0057 §4). Defaults to on for the compact (Home) card.
   */
  approveNeedsDetail?: boolean;
}

/** A refusal shown next to what was tapped: `warn` when the question changed, `error` otherwise. A
 *  walk that never reached its row can be tried again. */
type Notice = { tone: "warn" | "error"; text: string; retry?: InteractionOption; at: "options" | "reply" };
/** The text box open on the card: a text row's reply (required), or a note other answers may carry. */
type Writing = { to: "reply"; option: InteractionOption } | { to: "note" } | null;

export function QuestionCard({
  interaction: i, receipt, onAnswer, readOnly = false, lockReason, refused, compact = false, title, onOpen,
  openLabel = compact ? "Open" : "Terminal", onKeys, approveNeedsDetail = compact,
}: QuestionCardProps) {
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [writing, setWriting] = useState<Writing>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  // The card that replaced a refused one says why nothing was sent, until the next tap.
  useEffect(() => {
    if (refused) setNotice({ tone: "warn", text: refused, at: "options" });
  }, [refused]);
  const [failed, setFailed] = useState<number | null>(null);
  /** The operator unfolded the command or plan. */
  const [opened, setOpened] = useState(false);
  /** Whether this plan text is taller than its fold; unknown until measured, and unknown counts as folded. */
  const [planMeasure, setPlanMeasure] = useState<{ text: string; overflows: boolean } | null>(null);
  const textId = useId();
  const form = useRef<HTMLFormElement>(null);
  const noticeLine = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  // The box it just opened must be in view, whether the card sits at a thread's tail or on Home.
  useEffect(() => {
    if (writing) form.current?.scrollIntoView?.({ block: "nearest" });
  }, [writing]);
  // A refusal sits under what was tapped, which a tall card can hold below the fold.
  useEffect(() => {
    if (notice) noticeLine.current?.scrollIntoView?.({ block: "nearest" });
  }, [notice]);

  if (!i) {
    if (!receipt) return null;
    return (
      <Frame compact={compact} answered>
        <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <Check aria-hidden className="size-4 shrink-0 text-status-done" />
          {title && <span className="shrink-0 font-medium text-foreground">{title}</span>}
          <span className="min-w-0 truncate">{receipt.summary}</span>
        </p>
      </Frame>
    );
  }

  const typing = Boolean(i.typing);
  const lockLine = lockReason ? LOCK_COPY[lockReason] : readOnly ? "Answers are paused right now." : null;
  const locked = lockLine !== null || typing || busy !== null;
  const staticList = lockReason === "read-only";

  // What folds: a command or file preview past SUBJECT_ROWS rows, a plan past its measured height.
  // Home's card without the whole request only clamps its plain detail: it cannot approve it anyway.
  const plan = i.kind === "plan" ? i.context : undefined;
  const planOverflows = planMeasure !== null && planMeasure.text === plan ? planMeasure.overflows : null;
  const foldable = i.subject ? (i.subject.command ?? i.subject.preview) : !ANSWER_KINDS.has(i.kind) && !plan ? i.context : undefined;
  const clampOnly = compact && !i.subject && !i.detailComplete;
  const codeFolded = !opened && !clampOnly && (foldable?.split("\n").length ?? 0) > SUBJECT_ROWS;
  const planFolded = plan !== undefined && !opened && planOverflows !== false;
  // Approving needs the whole request on the card, unfolded; a deny never does.
  const needsWhole = approveNeedsDetail && (i.kind === "permission" || i.kind === "plan");
  const approvalHidden = needsWhole && (!i.detailComplete || codeFolded || planFolded);
  const shown = i.options.filter((o) => !(approvalHidden && o.role !== "deny"));
  const nav = shown.filter((o) => o.role === "nav");
  // A text row the bridge can type takes a reply on the card; one without a measured recipe is typed
  // in the terminal. Any other option that accepts text may carry an optional note.
  const replies = shown.filter((o) => o.role === "freeText" && o.acceptsText);
  const inTerminal = shown.filter((o) => o.role === "freeText" && !o.acceptsText);
  const choices = shown.filter((o) => o.role !== "freeText" && o.role !== "nav");
  const notable = choices.some((o) => o.acceptsText);
  const note = writing?.to === "note" ? draft.trim() : "";
  // A question's deny row ("Chat about this", a review's Cancel) leaves the dialog without answering;
  // a permission's or a plan's No is an answer and stays among them.
  const answers = ANSWER_KINDS.has(i.kind);
  const escapes = answers ? choices.filter((o) => o.role === "deny") : [];
  const listed = answers ? choices.filter((o) => o.role === "neutral") : [];
  const decisions = choices.filter((o) => !escapes.includes(o) && !listed.includes(o));
  const ticked = i.options.filter((o) => o.checked).length;
  const openLabelFor = compact ? "Open thread" : "Open terminal";

  async function send(option: InteractionOption, extra: AnswerExtra = {}) {
    setBusy(option.index);
    setNotice(null);
    setFailed(null);
    const outcome = await onAnswer(option, extra).catch((err: Error): AnswerOutcome => ({ ok: false, error: err.message || "Answer failed" }));
    setBusy(null);
    setArmed(null);
    if (outcome.ok) {
      if (extra.text !== undefined) {
        setDraft("");
        setWriting(null);
      }
      return;
    }
    // The armed row says what a second tap applies to; the bridge's own words would repeat it.
    if (outcome.code === "confirm_required") return setArmed(option.index);
    const at = extra.text !== undefined && writing?.to === "reply" ? "reply" : "options";
    setFailed(option.index);
    if (outcome.code === "interaction_changed") setNotice({ tone: "warn", text: outcome.error || "The question changed in the terminal.", at });
    else if (outcome.code === "not_reached") setNotice({ tone: "error", text: outcome.error, retry: option, at });
    else setNotice({ tone: "error", text: outcome.error || "Answer failed", at });
  }

  function press(option: InteractionOption) {
    if (locked) return;
    if (option.role === "persistent" && armed !== option.index) {
      setNotice(null);
      setFailed(null);
      return setArmed(option.index);
    }
    void send(option, {
      ...(note && option.acceptsText ? { text: note } : {}),
      ...(option.role === "persistent" ? { confirm: true } : {}),
    });
  }

  function write(next: Writing) {
    setWriting(next);
    setDraft("");
  }

  const reply = writing?.to === "reply" ? writing.option : undefined;
  const replyLabel = (o: InteractionOption) => `${bare(o.label)}…`;
  const rowProps = (option: InteractionOption) => ({
    option, armed: armed === option.index, busy: busy === option.index, failed: failed === option.index,
    // A typed note must never vanish into an answer that cannot carry it.
    disabled: locked || (note !== "" && !option.acceptsText),
    onPress: () => press(option),
  });
  const replyButton = (option: InteractionOption, className: string) => (
    <button key={option.index} type="button" disabled={locked} aria-expanded={false} aria-controls={textId}
      onClick={() => write({ to: "reply", option })} className={className}>
      {!compact && <MessageSquareText aria-hidden className="size-4 shrink-0" />}{replyLabel(option)}
    </button>
  );
  // A multi-select's advance says how much it sends; a review with a gap says it sends it anyway. A
  // wizard step's Next only moves on, so its count reads as a selection, never as a question number.
  const decisionLabel = (option: InteractionOption): ReactNode => {
    if (option.role === "primary" && i.incomplete) return "Submit anyway";
    if (option.role === "primary" && i.kind === "multi-select" && !i.answers) {
      if (!SUBMIT.test(option.label)) return <>{option.label} · <span className="tabular-nums">{ticked || "none"}</span> selected</>;
      return ticked ? <>{option.label}{" "}<span className="tabular-nums">{ticked}</span></> : `${option.label} without answers`;
    }
    return undefined;
  };
  const quiet = (option: InteractionOption) => option.role === "primary" && i.kind === "multi-select" && !i.answers && ticked === 0;
  const steps = i.steps ?? [];
  // The bridge marks the question on screen; a review marks none.
  const current = steps.findIndex((s) => s.current);
  const back = nav.find((o) => o.label === "Back");
  const next = nav.find((o) => o.label === "Next");

  const noticeView = notice && (
    <div className="flex flex-col gap-2">
      <p ref={noticeLine} role="status" className={cn("flex items-start gap-2 text-[15px] leading-5", notice.tone === "error" ? "text-destructive" : "text-status-working")}>
        {notice.tone === "error" ? <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" /> : <RefreshCw aria-hidden className="mt-0.5 size-4 shrink-0" />}
        <span className="min-w-0">{notice.text}</span>
      </p>
      {/* The card's own row already leads to the terminal (or the thread): one way there, not two. */}
      {notice.retry && (
        <button type="button" disabled={locked} onClick={() => press(notice.retry!)} className={cn(compact ? PILL : DECISION, NEUTRAL, "self-start")}>Try again</button>
      )}
    </div>
  );

  return (
    <Frame compact={compact} label={i.question}>
      <div className={cn("flex min-w-0 items-center gap-2", compact ? "text-xs" : "text-[13px]")}>
        <span className="flex shrink-0 items-center gap-1.5 font-medium text-status-blocked">
          <span aria-hidden className="size-1.5 rounded-full bg-status-blocked ring-2 ring-status-blocked/25" />
          Waiting on you
        </span>
        {title && <span className="min-w-0 truncate text-muted-foreground">· {title}</span>}
        {steps.length === 1 && <span className="min-w-0 truncate text-muted-foreground"><span aria-hidden>· </span><span>{steps[0]!.label}</span></span>}
        {steps.length > 1 && (
          <span className="ml-auto flex shrink-0 items-center gap-1 font-medium tabular-nums text-muted-foreground">
            {back && <StepButton label="Previous question" disabled={locked} onClick={() => press(back)}><ChevronLeft aria-hidden className="size-4" /></StepButton>}
            <span>{current >= 0 ? `${current + 1} of ${steps.length}` : "Review"}</span>
            {next && <StepButton label="Next question" disabled={locked} onClick={() => press(next)}><ChevronRight aria-hidden className="size-4" /></StepButton>}
          </span>
        )}
      </div>
      {steps.length > 1 && !compact && <Stepper steps={steps} />}
      <p className={cn("text-foreground", compact ? "line-clamp-3 text-sm" : "text-[17px] leading-[22px] font-semibold tracking-[-0.01em] text-pretty")}>{i.question}</p>
      {i.answers || i.incomplete ? <ReviewAnswers answers={i.answers ?? []} incomplete={Boolean(i.incomplete)} />
        : i.subject ? <Subject subject={i.subject} folded={codeFolded} onOpenAll={() => setOpened(true)} />
        : plan !== undefined ? <PlanText text={plan} compact={compact} folded={planFolded} overflows={planOverflows} onMeasure={(overflows) => setPlanMeasure({ text: plan, overflows })} onOpenAll={() => setOpened(true)} />
        : i.context && <Context interaction={i} text={i.context} compact={compact} clamp={clampOnly} folded={codeFolded} onOpenAll={() => setOpened(true)} />}

      {typing ? (
        <div className="flex flex-col items-start gap-3">
          <div className="flex items-start gap-3">
            <Keyboard aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-0.5">
              <p className="text-[15px] leading-5 font-medium text-foreground">The terminal's text box has focus</p>
              <p className="text-[13px] leading-[18px] text-muted-foreground">Answers come back when typing ends</p>
            </div>
          </div>
          {onOpen && (
            <button type="button" onClick={onOpen} className={cn(compact ? PILL : DECISION, "bg-foreground text-background")}>
              {!compact && <TerminalSquare aria-hidden className="size-4 shrink-0" />}{openLabelFor}
            </button>
          )}
        </div>
      ) : <>
        {lockLine && <p className="text-[13px] leading-[18px] text-muted-foreground">{lockLine}</p>}
        {/* A plan without its hint shows only its on-screen tail; a command may well be whole, just unverified. */}
        {approvalHidden && !i.detailComplete && i.kind === "plan" && (
          <p className="text-[13px] leading-[18px] text-muted-foreground">The full plan isn't on this card.</p>
        )}

        {staticList ? <>
          <StaticOptions options={choices} />
          {compact && onOpen && (
            <button type="button" onClick={onOpen} className={cn(PILL, OUTLINED, "self-start")}>
              <TerminalSquare aria-hidden className="size-4 shrink-0" />{openLabel}
            </button>
          )}
        </> : compact ? <>
          {inTerminal.map((option) => (
            <p key={option.index} data-in-terminal className="min-w-0 break-words text-xs text-muted-foreground">
              <span className="text-foreground">{option.label}</span> Answer in the terminal.
            </p>
          ))}
          <div className="flex flex-row flex-wrap gap-2">
            {approvalHidden && onOpen && (
              <button type="button" onClick={onOpen} className={cn(PILL, "bg-foreground text-background")}>Review in thread</button>
            )}
            {choices.map((option) => <Pill key={option.index} {...rowProps(option)} toggle={isToggle(i, option)} />)}
            {!reply && replies.map((option) => replyButton(option, cn(PILL, OUTLINED)))}
            {notable && !writing && <NoteButton locked={locked} textId={textId} className={cn(PILL, OUTLINED)} onClick={() => write({ to: "note" })} />}
            {onOpen && !approvalHidden && (
              <button type="button" onClick={onOpen} className={cn(PILL, OUTLINED, "ml-auto")}>
                <TerminalSquare aria-hidden className="size-4 shrink-0" />{openLabel}
              </button>
            )}
          </div>
        </> : <>
          {(listed.length > 0 || (answers && replies.length > 0 && !reply)) && (
            <div role="group" aria-label="Answers" className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
              {listed.map((option) => <AnswerRow key={option.index} {...rowProps(option)} toggle={isToggle(i, option)} />)}
              {answers && !reply && replies.map((option) => replyButton(option, cn(LIST_ROW, "text-muted-foreground disabled:text-muted-foreground/70")))}
            </div>
          )}
          {(decisions.length > 0 || (!answers && replies.length > 0 && !reply)) && (
            <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
              {decisions.map((option) => <DecisionButton key={option.index} {...rowProps(option)} label={decisionLabel(option)} quiet={quiet(option)} />)}
              {!answers && !reply && replies.map((option) => replyButton(option, cn(DECISION, OUTLINED)))}
            </div>
          )}
        </>}

        {notice?.at === "options" && noticeView}

        {writing && (
          <form ref={form} id={textId} className="flex flex-col gap-2" onSubmit={(e) => {
            e.preventDefault();
            if (reply && !locked && draft.trim()) void send(reply, { text: draft });
          }}>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={FEEDBACK_MAX_LENGTH} rows={compact ? 2 : 3} autoFocus
              aria-label={reply ? reply.label : "Note with your answer"}
              placeholder={reply ? reply.label : "Add a note, then pick an answer"} disabled={lockLine !== null}
              className="min-h-16 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
            <div className="flex items-center gap-2">
              {reply && (
                <button type="submit" disabled={locked || !draft.trim()}
                  className={cn(compact ? PILL : DECISION, locked || !draft.trim() ? DISABLED : "bg-foreground text-background")}>
                  {busy === reply.index && <Loader2 aria-hidden className="size-4 animate-spin" />}Send
                </button>
              )}
              <button type="button" disabled={busy !== null} onClick={() => write(null)}
                className={cn(compact ? PILL : DECISION, "border border-border text-muted-foreground")}>Cancel</button>
              <span aria-live="polite" className="ml-auto text-xs tabular-nums text-muted-foreground">{draft.length}/{FEEDBACK_MAX_LENGTH}</span>
            </div>
          </form>
        )}

        {notice?.at === "reply" && noticeView}

        {i.terminalOnly && i.terminalOnly.length > 0 && (
          <p className="min-w-0 break-words text-[13px] leading-[18px] text-muted-foreground">
            Also in the terminal: <span className="text-foreground">{i.terminalOnly.join(" · ")}</span>
          </p>
        )}

        {!compact && ((!staticList && (escapes.length > 0 || (notable && !writing))) || (inTerminal.length > 0 && onKeys) || onOpen) && (
          <div data-secondary-actions className="-mx-1.5 -mb-1.5 flex flex-wrap items-center">
            {!staticList && escapes.map((option) => (
              <button key={option.index} type="button" data-role={option.role} disabled={rowProps(option).disabled} onClick={() => press(option)} className={SECONDARY}>
                {busy === option.index && <Loader2 aria-label="Sending" className="size-3.5 animate-spin" />}{option.label}
              </button>
            ))}
            {!staticList && notable && !writing && <NoteButton locked={locked} textId={textId} className={SECONDARY} onClick={() => write({ to: "note" })} />}
            {onKeys && inTerminal.map((option) => (
              <button key={option.index} type="button" data-in-terminal onClick={onKeys} className={SECONDARY}
                aria-label="Type your own answer in the terminal" title={`${bare(option.label)} in the terminal`}>
                <Keyboard aria-hidden className="size-3.5 shrink-0" />Type your own
              </button>
            ))}
            {onOpen && (
              <button type="button" onClick={onOpen} className={cn(SECONDARY, "sm:ml-auto")}>
                <TerminalSquare aria-hidden className="size-3.5 shrink-0" />{openLabel}
              </button>
            )}
          </div>
        )}
      </>}
    </Frame>
  );
}

function Frame({ compact, answered, label, children }: { compact: boolean; answered?: boolean; label?: string; children: ReactNode }) {
  return (
    <section aria-label={label ?? "Answered"} data-question-card={compact ? "compact" : "full"}
      className={cn(
        "flex min-w-0 flex-col",
        compact ? "gap-2 rounded-2xl p-3" : answered ? "rounded-xl px-3.5 py-2.5" : "gap-3 rounded-2xl p-4",
        answered
          ? "border border-border/60 bg-muted/30"
          // A thread card is a message in the conversation, not an alarm: the dot and its label carry
          // the urgency. Home's card keeps the tint, since it sits among other panes' summaries.
          : compact ? "border border-status-blocked/40 bg-status-blocked/[0.06]" : "border border-border bg-card shadow-sm",
      )}>
      {children}
    </section>
  );
}

/** Back or Next across a wizard's questions: a 32 px chevron with the 44 px touch target. */
function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="hit-area flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted active:bg-muted disabled:text-muted-foreground">
      {children}
    </button>
  );
}

/** A multi-question dialog's questions, as its header chips: answered, on screen, still to come. */
function Stepper({ steps }: { steps: InteractionStep[] }) {
  return (
    <ol aria-label="Questions" className="-mx-2 flex min-w-0 flex-wrap items-center gap-1">
      {steps.map((step, n) => (
        <li key={n} aria-current={step.current ? "step" : undefined}
          aria-label={`${step.label}${step.answered ? ", answered" : ""}`}
          className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs",
            step.current ? "bg-foreground/10 font-medium text-foreground" : "text-muted-foreground",
          )}>
          {step.answered && <Check aria-hidden className="size-3 shrink-0 text-status-done" />}
          <span className="truncate">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

const CODE = "w-full min-w-0 whitespace-pre-wrap rounded-lg bg-muted px-3 py-2.5 font-mono text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]";

function ShowAll({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-mx-1 min-h-11 rounded-md px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
      Show all {count} lines
    </button>
  );
}

/**
 * What a permission asks for, as the dialog draws it: the tool, what it is for, then the command or
 * file as code. The command is whole unless it is folded past SUBJECT_ROWS rows.
 */
function Subject({ subject, folded, onOpenAll }: { subject: InteractionSubject; folded: boolean; onOpenAll: () => void }) {
  const rows = (subject.command ?? subject.preview ?? "").split("\n");
  const visible = folded ? rows.slice(0, SUBJECT_ROWS) : rows;
  return (
    <div data-subject className="flex min-w-0 flex-col items-start gap-1.5">
      {subject.tool && <p className="text-[13px] leading-[18px] font-semibold text-muted-foreground">{subject.tool}</p>}
      {subject.description && <p className="text-[15px] leading-5 text-foreground text-pretty">{subject.description}</p>}
      {subject.file && <p aria-label="File" className="w-full min-w-0 font-mono text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">{subject.file}</p>}
      {subject.command !== undefined && <pre aria-label="Command" className={CODE}>{visible.join("\n")}</pre>}
      {subject.preview !== undefined && <Preview rows={visible} />}
      {folded && <ShowAll count={rows.length} onClick={onOpenAll} />}
      {subject.meta && subject.meta.length > 0 && <p className="text-[13px] leading-[18px] text-muted-foreground">{subject.meta.join(" · ")}</p>}
    </div>
  );
}

/** A file preview's rows, the dialog's own line numbers in a gutter apart from the text. */
function Preview({ rows }: { rows: string[] }) {
  const lines = rows.map((row) => /^(\d+)(?:\s(.*))?$/.exec(row));
  const gutter = Math.max(1, ...lines.map((m) => m?.[1]?.length ?? 0));
  return (
    <div aria-label="Preview" className="w-full min-w-0 rounded-lg bg-muted py-2 font-mono text-[13px] leading-5 text-foreground">
      {rows.map((row, n) => (
        <div key={n} className="flex gap-3 px-3">
          <span aria-hidden="true" className="shrink-0 text-right tabular-nums text-muted-foreground select-none" style={{ width: `${gutter}ch` }}>{lines[n]?.[1] ?? ""}</span>
          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{lines[n] ? lines[n][2] ?? "" : row}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The plan as formatted text, folded to its first lines with a fade. The fold is measured: a plan
 * that fits is never folded, and until it is measured it counts as folded, so Home never offers to
 * approve a plan it is still cutting (ADR 0057 §4).
 */
function PlanText({ text, compact, folded, overflows, onMeasure, onOpenAll }: {
  text: string; compact: boolean; folded: boolean; overflows: boolean | null; onMeasure: (overflows: boolean) => void; onOpenAll: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Measured once per text, while folded: unfolding needs no new measure.
  useLayoutEffect(() => {
    const el = box.current;
    if (el && overflows === null) onMeasure(el.scrollHeight > el.clientHeight + 1);
  }, [text, overflows, onMeasure]);
  // Its own surface, so the plan's headings read as the document under the question, not as more questions.
  return (
    <div className="flex min-w-0 flex-col items-start rounded-xl border border-border px-3.5 pt-3 pb-1">
      <div ref={box} aria-label="Plan" className={cn(
        "w-full min-w-0 pb-2 [&>div]:text-[15px] [&_li]:leading-6 [&_p]:leading-6",
        // The fade reaches nothing before the edge, so a cut line never peeks through.
        folded && "overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-4rem),transparent_calc(100%-0.5rem))]",
        folded && (compact ? "max-h-36" : "max-h-64"),
      )}>
        <MarkdownText text={text} />
      </div>
      {folded && overflows && (
        <button type="button" onClick={onOpenAll} className="-mx-1 -mt-1 min-h-11 rounded-md px-1 text-[13px] font-medium text-foreground/80 hover:text-foreground">
          Read the full plan
        </button>
      )}
    </div>
  );
}

/**
 * A question's own detail as text; anything else in mono, folded past SUBJECT_ROWS rows. Home's card
 * without the whole request clamps it to three lines instead: it cannot approve it either way.
 */
function Context({ interaction: i, text, compact, clamp, folded, onOpenAll }: {
  interaction: Interaction; text: string; compact: boolean; clamp: boolean; folded: boolean; onOpenAll: () => void;
}) {
  if (ANSWER_KINDS.has(i.kind)) {
    return <p className={cn("min-w-0 whitespace-pre-wrap break-words text-[13px] text-muted-foreground", compact && "line-clamp-2")}>{text}</p>;
  }
  const rows = text.split("\n");
  return (
    // The padding sits outside the clamped box: a clamp only cuts at its own padding edge, so
    // padding on the clamped element itself shows the top half of the next line.
    <div className="flex min-w-0 flex-col items-start gap-1 rounded-lg bg-muted/60 px-2.5 py-2">
      <pre aria-label="Request details" className={cn(
        "w-full min-w-0 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-foreground",
        clamp && "line-clamp-3",
      )}>{folded ? rows.slice(0, SUBJECT_ROWS).join("\n") : text}</pre>
      {folded && <ShowAll count={rows.length} onClick={onOpenAll} />}
    </div>
  );
}

/** A review: what Submit sends, question over answer, and a warning when a question has none. */
function ReviewAnswers({ answers, incomplete }: { answers: InteractionAnswer[]; incomplete: boolean }) {
  return <>
    {answers.length > 0 && (
      <ul aria-label="Your answers" className="flex flex-col gap-1.5 rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] leading-snug">
        {answers.map((a, n) => (
          <li key={n} className="flex min-w-0 flex-col">
            <span className="text-muted-foreground">{a.question}</span>
            <span className="font-medium text-foreground">{a.answer}</span>
          </li>
        ))}
      </ul>
    )}
    {incomplete && (
      <p className="flex items-center gap-2 text-[15px] leading-5 text-status-working">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />Some questions have no answer
      </p>
    )}
  </>;
}

/** A read-only device's options: what the agent offers, with nothing to press. */
function StaticOptions({ options }: { options: InteractionOption[] }) {
  return (
    <ul aria-label="Options" className="flex flex-col gap-2 border-l border-border pl-3">
      {options.map((option) => (
        <li key={option.index} className="flex min-w-0 flex-col">
          <span className="text-[15px] leading-5 text-foreground">{recommendedLabel(option.label).text}</span>
          {option.description && <span className="text-[13px] leading-[18px] text-muted-foreground">{option.description}</span>}
        </li>
      ))}
    </ul>
  );
}

function NoteButton({ locked, textId, className, onClick }: { locked: boolean; textId: string; className: string; onClick: () => void }) {
  return (
    <button type="button" disabled={locked} aria-expanded={false} aria-controls={textId} onClick={onClick} className={className}>
      Add a note…
    </button>
  );
}

// Touch targets reach 44 px on a coarse pointer (direction.md); a mouse keeps the denser 40.
const PILL = "inline-flex min-h-10 pointer-coarse:min-h-11 items-center gap-2 rounded-xl px-3.5 text-left text-sm font-medium transition-colors active:scale-[0.99]";
const DECISION = "inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-left text-base font-medium transition-colors active:scale-[0.99]";
const LIST_ROW = "flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left text-base transition-colors hover:bg-muted/50 active:bg-muted";
const OUTLINED = "border border-border bg-transparent text-muted-foreground disabled:text-muted-foreground/70";
const NEUTRAL = "border border-border bg-secondary text-foreground";
const SECONDARY = "inline-flex min-h-10 pointer-coarse:min-h-11 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted disabled:text-muted-foreground/70";
/** A control that cannot fire: muted, never a faded fill that reads as highlighted. */
const DISABLED = "border border-transparent bg-muted text-muted-foreground cursor-not-allowed";
/** The tapped option a refusal is about, until the next tap. */
const FAILED = "outline outline-1 -outline-offset-1 outline-destructive";

interface RowProps {
  option: InteractionOption;
  armed: boolean;
  busy: boolean;
  failed: boolean;
  disabled: boolean;
  onPress: () => void;
}

/** A label without its trailing dots or ellipsis, to end it with our own. */
const bare = (label: string) => label.replace(/[.…]+$/, "");

/** Weight by role: the one-tap answer filled, a persistent one dashed, a deny outlined in red. */
function toneClass(tone: InteractionOption["role"]) {
  return cn(
    tone === "primary" && "bg-foreground text-background",
    (tone === "neutral" || tone === "nav") && NEUTRAL,
    tone === "persistent" && "border border-dashed border-border bg-secondary text-foreground",
    tone === "deny" && "border border-status-blocked/40 bg-transparent text-status-blocked",
  );
}

/** One answer of a question: title, the agent's description in small grey, a quiet Recommended. */
function AnswerRow({ option, toggle, busy, failed, disabled, onPress }: RowProps & { toggle: boolean }) {
  const { text, recommended } = recommendedLabel(option.label);
  const dim = disabled && !busy;
  return (
    <button type="button" disabled={disabled} onClick={onPress} data-role={option.role} data-failed={failed || undefined}
      aria-pressed={toggle ? Boolean(option.checked) : undefined}
      className={cn(LIST_ROW, dim && "cursor-not-allowed", failed && FAILED)}>
      {toggle && <Checkbox checked={Boolean(option.checked)} />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn("min-w-0 break-words font-medium", dim ? "text-muted-foreground" : "text-foreground")}>{text}</span>
          {recommended && <RecommendedBadge />}
        </span>
        {option.description && <span className="text-[13px] leading-[18px] text-muted-foreground">{option.description}</span>}
      </span>
      {busy && <Loader2 aria-label="Sending" className="size-4 shrink-0 animate-spin text-muted-foreground" />}
    </button>
  );
}

/**
 * The armed state of a persistent option: its label stays, a Confirm pill trails it with a ring that
 * runs out with CONFIRM_MS, and the line under it says what the second tap applies to.
 */
function ConfirmPill() {
  const ring = useRef<SVGCircleElement>(null);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const animation = ring.current?.animate?.([{ strokeDashoffset: 0 }, { strokeDashoffset: 38 }], { duration: CONFIRM_MS, easing: "linear", fill: "forwards" });
    return () => animation?.cancel();
  }, []);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground py-1 pr-2.5 pl-1.5 text-[13px] font-medium text-background">
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 -rotate-90">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" />
        <circle ref={ring} cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="38" strokeDashoffset="0" />
      </svg>
      Confirm
    </span>
  );
}

/** A decision (approve, deny, submit): a button whose weight follows its role. */
function DecisionButton({ option, armed, busy, failed, disabled, onPress, label, quiet }: RowProps & { label?: ReactNode; quiet?: boolean }) {
  const detail = armed ? "Applies to future prompts" : option.role === "persistent" ? "Changes a setting beyond this answer" : option.description;
  const dim = disabled && !busy;
  const tone = quiet && option.role === "primary" ? "neutral" : option.role;
  return (
    <button type="button" disabled={disabled} onClick={onPress} data-role={option.role} data-failed={failed || undefined} data-quiet={quiet || undefined}
      aria-label={armed ? `Confirm: ${option.label}` : undefined}
      className={cn(DECISION, "w-full lg:w-auto", dim ? DISABLED : toneClass(tone), failed && FAILED)}>
      <span className="flex min-w-0 flex-1 flex-col py-1.5">
        <span className="break-words">{label ?? option.label}</span>
        {(detail || armed) && (
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className={cn("text-[13px] leading-[18px] font-normal", tone === "primary" && !dim ? "text-background/70" : "text-muted-foreground")}>{detail}</span>
            {armed && <ConfirmPill />}
          </span>
        )}
      </span>
      {busy && <Loader2 aria-label="Sending" className="size-4 shrink-0 animate-spin" />}
    </button>
  );
}

/** Home's one-line option. */
function Pill({ option, toggle, armed, busy, failed, disabled, onPress }: RowProps & { toggle: boolean }) {
  const dim = disabled && !busy;
  return (
    <button type="button" disabled={disabled} onClick={onPress} data-role={option.role} data-failed={failed || undefined}
      aria-pressed={toggle ? Boolean(option.checked) : undefined} aria-label={armed ? `Confirm: ${option.label}` : undefined}
      className={cn(PILL, dim ? DISABLED : toneClass(option.role), failed && FAILED)}>
      {toggle && <Checkbox checked={Boolean(option.checked)} />}
      <span className="min-w-0 break-words py-1.5">{option.label}</span>
      {armed && <ConfirmPill />}
      {busy && <Loader2 aria-label="Sending" className="size-4 shrink-0 animate-spin" />}
    </button>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border",
      checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60")}>
      {checked && <Check className="size-3.5" />}
    </span>
  );
}
