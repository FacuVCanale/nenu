import { useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";

import type { PromptFeedbackPurpose, PromptModel, PromptOption } from "@/lib/blocks";
import { FEEDBACK_MAX_LENGTH } from "@/lib/prompt-action";
import {
  DialogCard,
  OptionButton,
  OptionList,
  QuestionHeading,
  SECONDARY_ACTION,
  SecondaryActions,
} from "@/components/option-button";
import { PromptRequestContext } from "@/components/prompt-request-context";
import { Button } from "@/components/ui/button";

/** What a tap on this block asks for: an option's keystroke plan, or feedback typed on the phone. */
export type PromptBlockAction =
  | { kind: "option"; option: PromptOption }
  | { kind: "feedback"; text: string };

export interface PromptSelectBlockProps {
  /** The detected dialog: question (screen-reader label) + selectable options as buttons. */
  prompt: PromptModel;
  /**
   * Injected send handler (from AgentChat). Presentational contract: this component NEVER touches
   * the network — it just reflects the sending state while the handler runs the race guard and
   * sends the option's keys (or drives the feedback choreography). Returning/throwing simply clears
   * the busy state.
   */
  onAction: (action: PromptBlockAction) => boolean | void | Promise<boolean | void>;
  /** Read-only device or a gone pane: buttons still render (for context) but can't be pressed. */
  disabled?: boolean;
}

// Copy is purpose-aware: Claude's plan-approval input is deny-with-feedback; Grok's `z` row is
// a custom answer. Missing purpose is Claude (the only row submitPromptFeedback will type into).
const FEEDBACK_COPY: Record<
  PromptFeedbackPurpose,
  {
    offer: string | null;
    editorLabel: string;
    placeholder: string;
    help: string;
    send: string;
    sending: string;
    focused: string;
    typedPrefix: string;
  }
> = {
  "plan-change": {
    offer: "Tell Claude what to change",
    editorLabel: "What should Claude change?",
    placeholder: "Say what to do differently…",
    help: "Sends the plan back with your notes — Claude keeps planning instead of starting work.",
    send: "Send feedback",
    sending: "Sending feedback…",
    focused:
      "Feedback is being edited in the agent session. Options resume when editing finishes.",
    typedPrefix: "Existing feedback: ",
  },
  "free-text": {
    // No phone composer: the Claude plan-feedback send path is the wrong recipe for this row.
    offer: null,
    editorLabel: "",
    placeholder: "",
    help: "",
    send: "",
    sending: "",
    focused:
      "A custom answer is being edited in the agent session. Options resume when editing finishes.",
    typedPrefix: "Existing custom answer: ",
  },
};

// Native, tappable rendering of a Claude single-choice dialog. Every visible string — the option
// label and its description — is a React text node (the XSS boundary is unchanged; nothing is ever
// set as innerHTML). Real <button>s, so they're keyboard-focusable and screen-reader-announced; the
// group contains its own visible question and signed request context. The option's verified key
// plan stays internal; its native label is what the reader chooses. One option can be in flight at
// a time — its spinner shows and the rest lock, preventing a double-send.
//
// A dialog carrying an inline text input (the plan approval's "Tell Claude what to change") adds two
// surfaces below the options, and one state in which the options themselves are dead:
//
//   * FOCUSED — `❯` is on the input row, so the terminal routes every digit into it as a character
//     and no button on this dialog can fire (issue #95: they used to render as ordinary buttons and
//     silently type into the desktop user's sentence). Everything locks behind a banner; polling
//     clears it the moment the pointer moves off. Same treatment as PreviewSelectBlock's note field.
//   * TEXT ALREADY IN THE BOX — the options answer normally, but Nenu will not type: re-entering a
//     non-empty field puts the caret at position 0, so our words would be prepended to theirs. The
//     affordance is replaced by a read-only card showing what is in there.
//
// Only the empty, unfocused state offers the composer, whose Send drives digit → focus → type →
// Enter and lands as DENY-with-feedback (the agent re-plans) — which is what the button says.
export function PromptSelectBlock({ prompt, onAction, disabled }: PromptSelectBlockProps) {
  const [sending, setSending] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const feedback = prompt.feedback;
  const terminalFocused = feedback?.focused ?? false;
  const locked = Boolean(disabled) || sending !== null || terminalFocused;
  const feedbackCopy = feedback
    ? FEEDBACK_COPY[feedback.purpose === "free-text" ? "free-text" : "plan-change"]
    : null;

  async function press(id: string, action: PromptBlockAction): Promise<boolean> {
    if (locked) return false;
    setSending(id);
    try {
      // A handler that returns nothing is taken at its word (the presentational tests inject one);
      // only an explicit `false` means "didn't send".
      return (await onAction(action)) !== false;
    } finally {
      setSending(null);
    }
  }

  async function sendFeedback() {
    const text = draft.trim();
    if (text.length === 0) return;
    // The editor closes only on a send that actually landed. A refused one (the guard saw the dialog
    // move) would otherwise throw away up to FEEDBACK_MAX_LENGTH characters someone thumb-typed on a
    // phone — the longest text this app ever asks anyone to type — with no way to get them back.
    if (await press("feedback", { kind: "feedback", text })) setEditorOpen(false);
  }

  const busyIcon = (
    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Sending" />
  );

  return (
    <DialogCard label={prompt.question}>
      <QuestionHeading>{prompt.question}</QuestionHeading>
      <PromptRequestContext prompt={prompt} />
      <OptionList aria-label="Answers">
        {prompt.options.map((option, index) => {
          const id = `opt-${index}`;
          const busy = sending === id;
          return (
            <OptionButton
              key={index}
              tone={busy ? "busy" : "default"}
              label={option.label}
              description={option.description}
              disabled={locked}
              onClick={() => press(id, { kind: "option", option })}
              trailing={
                busy ? (
                  <Loader2
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                    aria-label="Sending"
                  />
                ) : null
              }
            />
          );
        })}
      </OptionList>

      {/* The inline text input, in whichever of its states this screen is in. OUR OWN send comes
          first: the choreography focuses the row and fills it, so from the moment Send is pressed the
          screen is briefly indistinguishable from "someone at the terminal is typing" — and saying
          that to the person who just pressed the button would be a lie about their own action. */}
      {feedback && feedbackCopy && sending === "feedback" ? (
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          {busyIcon}
          {feedbackCopy.sending}
        </p>
      ) : feedback && feedbackCopy && terminalFocused ? (
        <p className="rounded-lg border border-dashed border-status-working/50 px-3.5 py-2.5 text-body text-status-working">
          {feedbackCopy.focused}
          {feedback.text ? <span className="text-muted-foreground"> ({feedback.text})</span> : null}
        </p>
      ) : feedback && feedbackCopy && feedback.text !== "" ? (
        <div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3.5 py-2.5">
          <MessageSquarePlus
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-label="Existing feedback"
          />
          <span className="min-w-0 flex-1 text-body text-foreground">
            {feedbackCopy.typedPrefix}
            {feedback.text}
          </span>
        </div>
      ) : feedback && feedbackCopy && feedbackCopy.offer && editorOpen ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-1.5 text-footnote font-medium text-muted-foreground">
            <MessageSquarePlus className="size-4 shrink-0" />
            {feedbackCopy.editorLabel}
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={FEEDBACK_MAX_LENGTH}
            rows={3}
            autoFocus
            aria-label="Feedback text"
            placeholder={feedbackCopy.placeholder}
            className="min-h-16 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-footnote text-muted-foreground">{feedbackCopy.help}</p>
          <Button
            type="button"
            size="block"
            disabled={locked || draft.trim().length === 0}
            aria-busy={sending === "feedback" || undefined}
            onClick={() => void sendFeedback()}
          >
            {feedbackCopy.send}
          </Button>
          <div className="-mx-2 flex items-center">
            <button
              type="button"
              disabled={sending !== null}
              onClick={() => setEditorOpen(false)}
              className={SECONDARY_ACTION}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : feedback && feedbackCopy && feedbackCopy.offer ? (
        <SecondaryActions>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              setDraft("");
              setEditorOpen(true);
            }}
            className={SECONDARY_ACTION}
          >
            <MessageSquarePlus aria-hidden className="size-4 shrink-0" />
            {feedbackCopy.offer}
          </button>
        </SecondaryActions>
      ) : null}
    </DialogCard>
  );
}
