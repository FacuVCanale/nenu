import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MultiSelectModel } from "@/lib/blocks";
import type { MultiSelectIntent } from "@/lib/multi-select-action";
import {
  DialogCard,
  optionSurface,
  PRIMARY_ACTION,
  QuestionHeading,
  SECONDARY_ACTION,
  SecondaryActions,
} from "@/components/option-button";
import { WizardStepper } from "@/components/wizard-stepper";
import { WIZARD_BACK_KEYS, WIZARD_NEXT_KEYS } from "@/lib/harness/wizard-model";

export interface MultiSelectBlockProps {
  /** The detected multi-select dialog (checkbox screen or review screen). */
  multi: MultiSelectModel;
  /**
   * Injected send handler (from AgentChat). Presentational contract: this component NEVER touches
   * the network — it maps taps to intents while the handler runs the race-guarded choreography
   * (toggle = one digit; submit = the closed-loop Down→Up→verify→Enter macro). Returning/throwing
   * simply clears the busy state.
   */
  onAction: (action: MultiSelectIntent) => void | Promise<void>;
  /** Read-only device or a gone pane: everything renders (for context) but can't be pressed. */
  disabled?: boolean;
}

// Native, tappable rendering of Claude's multiSelect AskUserQuestion. The terminal is the single
// source of truth for the checkbox state — a digit is an XOR (a double-fire would invert it), so
// there is NO optimistic local `checked`; each tap locks EVERY control (a `sending` state) until the
// round-trip re-derives the fresh state. That per-tap lock is an acknowledged v1 limitation (you
// can't queue toggles). Every visible string (labels, descriptions) is a React text node — the XSS
// boundary is unchanged.
export function MultiSelectBlock({ multi, onAction, disabled }: MultiSelectBlockProps) {
  const [sending, setSending] = useState<string | null>(null);
  const locked = disabled || sending !== null;

  async function press(id: string, action: MultiSelectIntent) {
    if (locked) return;
    setSending(id);
    try {
      await onAction(action);
    } finally {
      setSending(null);
    }
  }

  if (multi.phase === "review") {
    return <ReviewPhase incomplete={multi.incomplete} locked={locked} sending={sending} onPress={press} />;
  }
  return <CheckboxPhase multi={multi} locked={locked} sending={sending} onPress={press} />;
}

const spinner = (
  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Sending" />
);

function CheckboxPhase({
  multi,
  locked,
  sending,
  onPress,
}: {
  multi: Extract<MultiSelectModel, { phase: "checkbox" }>;
  locked: boolean;
  sending: string | null;
  onPress: (id: string, action: MultiSelectIntent) => void;
}) {
  return (
    <DialogCard label={multi.question}>
      {multi.steps && (
        <WizardStepper
          steps={multi.steps}
          locked={locked}
          busyBack={sending === "nav-back"}
          busyNext={sending === "nav-next"}
          busyIcon={spinner}
          onBack={() => onPress("nav-back", { kind: "nav", keys: WIZARD_BACK_KEYS })}
          onNext={() => onPress("nav-next", { kind: "nav", keys: WIZARD_NEXT_KEYS })}
        />
      )}
      <QuestionHeading>{multi.question}</QuestionHeading>
      <div className="flex flex-col gap-2">
        {multi.options.map((option) => {
          const id = `opt-${option.n}`;
          const busy = sending === id;
          const tone = busy ? "busy" : "default";
          return (
            <button
              key={option.n}
              type="button"
              role="checkbox"
              aria-checked={option.checked}
              disabled={locked}
              onClick={() => onPress(id, { kind: "toggle", n: option.n })}
              className={optionSurface(tone)}
            >
              {/* The checkbox reflects the TERMINAL state (option.checked), never a local guess. */}
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md border",
                  option.checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/60",
                )}
              >
                {option.checked ? <Check className="size-3.5" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-base leading-5 font-medium text-foreground">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="text-[13px] leading-[18px] text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              {busy ? spinner : null}
            </button>
          );
        })}
      </div>

      {/* The advance row — "Submit" on the last question, "Next" before it. The handler drives the
          closed-loop macro that walks the pointer onto it and verifies before pressing Enter. */}
      <button
        type="button"
        disabled={locked}
        // The name is on the ATTRIBUTE, not just the text: this same button element is renamed
        // "Next" → "Submit" underneath a user who may already have it focused, and a plain
        // child-text swap on a focused control is not reliably re-announced.
        aria-label={multi.advanceLabel}
        onClick={() => onPress("advance", { kind: "advance" })}
        className={PRIMARY_ACTION}
      >
        {sending === "advance" ? spinner : null}
        {multi.advanceLabel}
      </button>

      {/* "Chat about this" ABORTS the tool — with the card's utilities, apart from the answers. */}
      {multi.escape ? (
        <SecondaryActions>
          <button
            type="button"
            disabled={locked}
            onClick={() => onPress("escape", { kind: "escape" })}
            className={SECONDARY_ACTION}
          >
            {multi.escape.label}
            <span className="font-normal"> — ends the questions</span>
            {sending === "escape" ? spinner : null}
          </button>
        </SecondaryActions>
      ) : null}
    </DialogCard>
  );
}

function ReviewPhase({
  incomplete,
  locked,
  sending,
  onPress,
}: {
  incomplete: boolean;
  locked: boolean;
  sending: string | null;
  onPress: (id: string, action: MultiSelectIntent) => void;
}) {
  return (
    <DialogCard label="Ready to submit your answers?">
      <QuestionHeading>Ready to submit your answers?</QuestionHeading>
      {incomplete ? (
        // role="alert" so a screen reader announces the incomplete-answers warning when the review
        // screen mounts — otherwise a user could confirm a partial set without ever hearing it.
        <p role="alert" className="flex items-center gap-2 text-[15px] leading-5 text-status-working">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          You have not answered all questions
        </p>
      ) : null}
      <button
        type="button"
        disabled={locked}
        onClick={() => onPress("confirm", { kind: "confirm" })}
        className={PRIMARY_ACTION}
      >
        {sending === "confirm" ? spinner : null}
        Submit answers
      </button>
      <SecondaryActions>
        <button
          type="button"
          disabled={locked}
          onClick={() => onPress("cancel", { kind: "cancel" })}
          className={SECONDARY_ACTION}
        >
          {sending === "cancel" ? spinner : null}
          Cancel
        </button>
      </SecondaryActions>
    </DialogCard>
  );
}
