import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Keyboard, Loader2, MessageSquareText, TerminalSquare } from "lucide-react";

import { isToggle, type AnswerExtra, type Receipt } from "@/hooks/use-interactions";
import { FEEDBACK_MAX_LENGTH } from "@/lib/prompt-action";
import type { AnswerOutcome, Interaction, InteractionAnswer, InteractionKind, InteractionOption, InteractionStep } from "@/lib/types";
import { cn } from "@/lib/utils";

// One card for every dialog the bridge detected (ADR 0057): the newest line of a thread, and compact
// on Home. A tap is one POST naming the option by index; the bridge re-reads the screen, refuses a
// stale signature and owns every key. Text stays React text nodes (the XSS boundary).

/** How long a persistent option stays armed for its confirming second tap. */
export const CONFIRM_MS = 5_000;

/** Dialogs whose plain options are answers of equal weight, drawn as one list. */
const ANSWER_KINDS = new Set<InteractionKind>(["question", "wizard", "multi-select"]);
/** Rows of a command or plan shown before "Show all": the thread's own scroll reads the rest. */
const SUBJECT_ROWS = 8;
/** The agent's own marker for the option it suggests; the card shows it as a badge. */
const RECOMMENDED = /\s*\(recommended\)\s*$/i;

export interface QuestionCardProps {
  interaction?: Interaction;
  /** Shown instead of a card once the dialog was answered and before the pane's next one. */
  receipt?: Receipt;
  onAnswer: (option: InteractionOption, extra?: AnswerExtra) => Promise<AnswerOutcome>;
  readOnly?: boolean;
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
   * A permission may be approved only while its full command or file is on the card; otherwise the
   * card offers `onOpen` instead. Defaults to on for the compact (Home) card.
   */
  approveNeedsDetail?: boolean;
}

type Notice = { tone: "warn" | "error"; text: string };
/** The text box open on the card: a text row's reply (required), or a note other answers may carry. */
type Writing = { to: "reply"; option: InteractionOption } | { to: "note" } | null;

export function QuestionCard({
  interaction: i, receipt, onAnswer, readOnly = false, compact = false, title, onOpen,
  openLabel = compact ? "Open" : "Terminal", onKeys, approveNeedsDetail = compact,
}: QuestionCardProps) {
  const [busy, setBusy] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [writing, setWriting] = useState<Writing>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
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
  // A refusal is read at the card's foot, which a tall card can hold below the fold.
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
          <span className="min-w-0 truncate">Answered: {receipt.label}</span>
        </p>
      </Frame>
    );
  }

  const typing = Boolean(i.typing);
  const locked = readOnly || typing || busy !== null;
  // Approving needs the whole request on the card; a deny never does.
  const approvalHidden = approveNeedsDetail && i.kind === "permission" && !i.detailComplete;
  const shown = i.options.filter((o) => !(approvalHidden && o.role !== "deny"));
  // A text row the bridge can type takes a reply on the card; one without a measured recipe is typed
  // in the terminal. Any other option that accepts text may carry an optional note.
  const replies = shown.filter((o) => o.role === "freeText" && o.acceptsText);
  const inTerminal = shown.filter((o) => o.role === "freeText" && !o.acceptsText);
  const choices = shown.filter((o) => o.role !== "freeText");
  const notable = choices.some((o) => o.acceptsText);
  const note = writing?.to === "note" ? draft.trim() : "";
  // A question's deny row ("Chat about this", a review's Cancel) leaves the dialog without answering;
  // a permission's or a plan's No is an answer and stays among them.
  const answers = ANSWER_KINDS.has(i.kind);
  const escapes = answers ? choices.filter((o) => o.role === "deny") : [];
  const listed = answers ? choices.filter((o) => o.role === "neutral") : [];
  const decisions = choices.filter((o) => !escapes.includes(o) && !listed.includes(o));

  async function send(option: InteractionOption, extra: AnswerExtra = {}) {
    setBusy(option.index);
    setNotice(null);
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
    if (outcome.code === "interaction_changed") setNotice({ tone: "warn", text: "Menu changed. Refreshing." });
    else if (outcome.code === "confirm_required") {
      setArmed(option.index);
      setNotice({ tone: "warn", text: outcome.error });
    } else setNotice({ tone: "error", text: outcome.error || "Answer failed" });
  }

  function press(option: InteractionOption) {
    if (locked) return;
    if (option.role === "persistent" && armed !== option.index) {
      setNotice(null);
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
  const replyLabel = (o: InteractionOption) => (i.kind === "plan" ? "Reply…" : `${bare(o.label)}…`);
  const rowProps = (option: InteractionOption) => ({
    option, armed: armed === option.index, busy: busy === option.index,
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
  const steps = i.steps ?? [];
  // The bridge marks the question on screen; a review marks none.
  const current = steps.findIndex((s) => s.current);

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
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {current >= 0 ? `${current + 1} of ${steps.length}` : "Review"}
          </span>
        )}
      </div>
      {steps.length > 1 && !compact && <Stepper steps={steps} />}
      <p className={cn("text-foreground", compact ? "line-clamp-3 text-sm" : "text-base font-medium leading-snug")}>{i.question}</p>
      {i.answers ? <ReviewAnswers answers={i.answers} />
        : i.context && <Context interaction={i} text={i.context} compact={compact} approvable={i.kind === "permission" && !approvalHidden} />}
      {typing && <p className="text-xs text-muted-foreground">Someone is typing in this dialog in the terminal. Answer there, or wait.</p>}
      {readOnly && <p className="text-xs text-muted-foreground">Read-only on this device.</p>}
      {approvalHidden && <p className="text-xs text-muted-foreground">The full request isn't on this card. {compact ? "Open the thread" : "Open the terminal"} to approve it.</p>}

      {compact ? <>
        {inTerminal.map((option) => (
          <p key={option.index} data-in-terminal className="min-w-0 break-words text-xs text-muted-foreground">
            <span className="text-foreground">{option.label}</span> Answer in the terminal.
          </p>
        ))}
        <div className="flex flex-row flex-wrap gap-2">
          {choices.map((option) => <Pill key={option.index} {...rowProps(option)} toggle={isToggle(i, option)} />)}
          {!reply && replies.map((option) => replyButton(option, cn(PILL, OUTLINED)))}
          {notable && !writing && <NoteButton locked={locked} textId={textId} className={cn(PILL, OUTLINED)} onClick={() => write({ to: "note" })} />}
          {onOpen && (
            <button type="button" onClick={onOpen} className={cn(PILL, OUTLINED, "ml-auto")}>
              <TerminalSquare aria-hidden className="size-4 shrink-0" />{openLabel}
            </button>
          )}
        </div>
      </> : <>
        {(listed.length > 0 || (answers && replies.length > 0 && !reply)) && (
          <div role="group" aria-label="Answers" className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
            {listed.map((option) => <AnswerRow key={option.index} {...rowProps(option)} toggle={isToggle(i, option)} />)}
            {answers && !reply && replies.map((option) => replyButton(option, cn(LIST_ROW, "text-muted-foreground disabled:opacity-50")))}
          </div>
        )}
        {(decisions.length > 0 || (!answers && replies.length > 0 && !reply)) && (
          <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
            {decisions.map((option) => <DecisionButton key={option.index} {...rowProps(option)} />)}
            {!answers && !reply && replies.map((option) => replyButton(option, cn(DECISION, OUTLINED)))}
          </div>
        )}
      </>}

      {writing && (
        <form ref={form} id={textId} className="flex flex-col gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (reply && !locked && draft.trim()) void send(reply, { text: draft });
        }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={FEEDBACK_MAX_LENGTH} rows={compact ? 2 : 3} autoFocus
            aria-label={reply ? reply.label : "Note with your answer"}
            placeholder={reply ? reply.label : "Add a note, then pick an answer"} disabled={readOnly || typing}
            className="min-h-16 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm" />
          <div className="flex items-center gap-2">
            {reply && (
              <button type="submit" disabled={locked || !draft.trim()}
                className={cn(compact ? PILL : DECISION, "bg-foreground text-background disabled:opacity-50")}>
                {busy === reply.index && <Loader2 aria-hidden className="size-4 animate-spin" />}Send
              </button>
            )}
            <button type="button" disabled={busy !== null} onClick={() => write(null)}
              className={cn(compact ? PILL : DECISION, "border border-border text-muted-foreground")}>Cancel</button>
            <span aria-live="polite" className="ml-auto text-xs tabular-nums text-muted-foreground">{draft.length}/{FEEDBACK_MAX_LENGTH}</span>
          </div>
        </form>
      )}

      {!compact && (escapes.length > 0 || (notable && !writing) || (inTerminal.length > 0 && onKeys) || onOpen) && (
        <div data-secondary-actions className="-mx-1.5 -mb-1.5 flex flex-wrap items-center">
          {escapes.map((option) => (
            <button key={option.index} type="button" data-role={option.role} disabled={rowProps(option).disabled} onClick={() => press(option)} className={SECONDARY}>
              {busy === option.index && <Loader2 aria-label="Sending" className="size-3.5 animate-spin" />}{option.label}
            </button>
          ))}
          {notable && !writing && <NoteButton locked={locked} textId={textId} className={SECONDARY} onClick={() => write({ to: "note" })} />}
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

      {notice && <p ref={noticeLine} role="status" className={cn("text-xs", notice.tone === "error" ? "text-destructive" : "text-status-working")}>{notice.text}</p>}
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

/**
 * What the operator decides on: a command or plan in mono, a question's own detail as text.
 * A command Home can approve is never clamped: approving needs it whole (ADR 0057 §4).
 */
function Context({ interaction: i, text, compact, approvable }: { interaction: Interaction; text: string; compact: boolean; approvable: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (ANSWER_KINDS.has(i.kind)) {
    return <p className={cn("min-w-0 whitespace-pre-wrap break-words text-[13px] text-muted-foreground", compact && "line-clamp-2")}>{text}</p>;
  }
  const rows = text.split("\n");
  const folded = !compact && !expanded && rows.length > SUBJECT_ROWS;
  return (
    // The padding sits outside the clamped box: a clamp only cuts at its own padding edge, so
    // padding on the clamped element itself shows the top half of the next line.
    <div className="flex min-w-0 flex-col items-start gap-1 rounded-lg bg-muted/60 px-2.5 py-2">
      <pre aria-label="Request details" className={cn(
        "w-full min-w-0 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-foreground",
        compact && !approvable && "line-clamp-3",
      )}>{folded ? rows.slice(0, SUBJECT_ROWS).join("\n") : text}</pre>
      {folded && (
        <button type="button" onClick={() => setExpanded(true)} className="-mx-1 min-h-10 rounded-md px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground">
          Show all {rows.length} lines
        </button>
      )}
    </div>
  );
}

/** A review: what Submit sends, question over answer. */
function ReviewAnswers({ answers }: { answers: InteractionAnswer[] }) {
  return (
    <ul aria-label="Your answers" className="flex flex-col gap-1.5 rounded-xl bg-muted/60 px-3 py-2.5 text-[13px] leading-snug">
      {answers.map((a, n) => (
        <li key={n} className="flex min-w-0 flex-col">
          <span className="text-muted-foreground">{a.question}</span>
          <span className="font-medium text-foreground">{a.answer}</span>
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

const PILL = "inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-left text-sm font-medium transition-colors active:scale-[0.99]";
const DECISION = "inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-left text-[15px] font-medium transition-colors active:scale-[0.99]";
const LIST_ROW = "flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-left text-[15px] transition-colors hover:bg-muted/50 active:bg-muted";
const OUTLINED = "border border-border bg-transparent text-muted-foreground disabled:opacity-50";
const SECONDARY = "inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted disabled:opacity-50";

interface RowProps {
  option: InteractionOption;
  armed: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}

/** A label without its trailing dots or ellipsis, to end it with our own. */
const bare = (label: string) => label.replace(/[.…]+$/, "");

/** Weight by role: the one-tap answer filled, a persistent one dashed, a deny outlined in red. */
function toneClass(tone: InteractionOption["role"] | "armed") {
  return cn(
    tone === "primary" && "bg-foreground text-background",
    tone === "neutral" && "border border-border bg-secondary text-foreground",
    tone === "persistent" && "border border-dashed border-border bg-secondary text-foreground",
    tone === "deny" && "border border-status-blocked/40 bg-transparent text-status-blocked",
    tone === "armed" && "border border-status-working bg-status-working/15 text-foreground",
  );
}

/** The label without the agent's "(Recommended)" suffix, and whether it carried one. */
function labelOf(option: InteractionOption): { text: string; recommended: boolean } {
  return { text: option.label.replace(RECOMMENDED, ""), recommended: RECOMMENDED.test(option.label) };
}

/** One answer of a question: title, the agent's description in small grey, a quiet Recommended. */
function AnswerRow({ option, toggle, busy, disabled, onPress }: RowProps & { toggle: boolean }) {
  const { text, recommended } = labelOf(option);
  return (
    <button type="button" disabled={disabled} onClick={onPress} data-role={option.role}
      aria-pressed={toggle ? Boolean(option.checked) : undefined}
      className={cn(LIST_ROW, "disabled:opacity-50", busy && "disabled:opacity-100")}>
      {toggle && <Checkbox checked={Boolean(option.checked)} />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words font-medium text-foreground">{text}</span>
          {recommended && (
            <span className="shrink-0 rounded-full bg-primary/12 px-1.5 py-px text-[11px] font-medium leading-4 text-primary">Recommended</span>
          )}
        </span>
        {option.description && <span className="text-[13px] leading-snug text-muted-foreground">{option.description}</span>}
      </span>
      {busy && <Loader2 aria-label="Sending" className="size-4 shrink-0 animate-spin text-muted-foreground" />}
    </button>
  );
}

/** A decision (approve, deny, submit): a button whose weight follows its role. */
function DecisionButton({ option, armed, busy, disabled, onPress }: RowProps) {
  const tone = armed ? "armed" : option.role;
  const text = option.label;
  const detail = option.role === "persistent" ? "Changes a setting beyond this answer" : option.description;
  return (
    <button type="button" disabled={disabled} onClick={onPress} data-role={option.role}
      className={cn(
        DECISION, "w-full lg:w-auto", "disabled:opacity-50", busy && "disabled:opacity-100",
        toneClass(tone),
      )}>
      <span className="flex min-w-0 flex-1 flex-col py-1.5">
        <span className="break-words">{armed ? `Tap again to confirm: ${text}` : text}</span>
        {(armed || detail) && (
          <span className={cn("text-xs font-normal", tone === "primary" ? "text-background/70" : "text-muted-foreground")}>{detail}</span>
        )}
      </span>
      {busy && <Loader2 aria-label="Sending" className="size-4 shrink-0 animate-spin" />}
    </button>
  );
}

/** Home's one-line option. */
function Pill({ option, toggle, armed, busy, disabled, onPress }: RowProps & { toggle: boolean }) {
  const tone = armed ? "armed" : option.role;
  const text = option.label;
  return (
    <button type="button" disabled={disabled} onClick={onPress} data-role={option.role}
      aria-pressed={toggle ? Boolean(option.checked) : undefined}
      className={cn(
        PILL, "disabled:opacity-50", busy && "disabled:opacity-100",
        toneClass(tone),
      )}>
      {toggle && <Checkbox checked={Boolean(option.checked)} />}
      <span className="min-w-0 break-words py-1.5">{armed ? `Tap again to confirm: ${text}` : text}</span>
      {busy && <Loader2 aria-label="Sending" className="size-4 shrink-0 animate-spin" />}
    </button>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded border",
      checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/60")}>
      {checked && <Check className="size-3" />}
    </span>
  );
}
