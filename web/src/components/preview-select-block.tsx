import { useId, useState } from "react";
import { Check, Loader2, Pencil, StickyNote, Trash2 } from "lucide-react";

import { WizardStepper } from "@/components/wizard-stepper";
import { PreviewContent } from "@/components/preview-content";
import { cn } from "@/lib/utils";
import type { PreviewOption, PreviewSelectModel } from "@/lib/blocks";
import {
  DialogCard,
  OptionLabel,
  optionSurface,
  PRIMARY_ACTION,
  QuestionHeading,
  SECONDARY_ACTION,
  SecondaryActions,
} from "@/components/option-button";
import { NOTE_MAX_LENGTH } from "@/lib/preview-action";
import { recommendedLabel } from "@/components/recommended-badge";
import { WIZARD_BACK_KEYS, WIZARD_NEXT_KEYS } from "@/lib/harness/wizard-model";

/** One tap's intent, resolved to keystrokes by the injected handler (preview-action.ts). */
export type PreviewBlockAction =
  | { kind: "point"; option: PreviewOption } // move the pointer: its preview shows, nothing is chosen
  | { kind: "choose"; option: PreviewOption } // the pointed row, committed
  | { kind: "note"; text: string } // "" removes the note
  | { kind: "nav"; keys: string[] };

export interface PreviewSelectBlockProps {
  /** The detected preview-variant dialog (single question or one wizard step). */
  preview: PreviewSelectModel;
  /**
   * Injected send handler (from AgentChat). Presentational contract: this component NEVER touches
   * the network — it maps taps to intents while the handler runs the race-guarded choreography
   * (digit→verify to point; one guarded Enter to choose; n→verify→type→Escape for notes).
   * Returning/throwing simply clears the busy state.
   */
  onAction: (action: PreviewBlockAction) => void | Promise<void>;
  /** Read-only device or a gone pane: everything renders (for context) but can't be pressed. */
  disabled?: boolean;
}

// Native, tappable rendering of Claude's preview-variant AskUserQuestion (options + a preview pane
// + the per-question note; grammar/NOTES_NOTES.md). Mirrors what the TUI shows — the preview pane
// belongs to the POINTED option, and the note belongs to the QUESTION — because the terminal is
// the single source of truth. Choosing takes two taps: a row points at it (its preview replaces the
// last one), then "Choose <label>" commits the pointed row, so no design is picked unseen. Every
// visible string (labels, preview text, note text) is a React text node — the XSS boundary is
// unchanged. One control can be in flight at a time.
//
// While the TUI's own note input is focused (note.state === "editing" — someone is typing in the
// terminal) EVERY control locks: any keystroke we sent would be typed into their note instead of
// driving the dialog. A banner says so; polling clears it when the input blurs.
export function PreviewSelectBlock({ preview, onAction, disabled }: PreviewSelectBlockProps) {
  const [sending, setSending] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const captionId = useId();
  const terminalEditing = preview.note.state === "editing";
  const locked = disabled || sending !== null || terminalEditing;

  async function press(id: string, action: PreviewBlockAction) {
    if (locked) return;
    setSending(id);
    try {
      await onAction(action);
    } finally {
      setSending(null);
    }
  }

  async function saveNote() {
    const text = draft.trim();
    if (text.length === 0) return;
    await press("note-save", { kind: "note", text });
    setEditorOpen(false);
  }

  const wizard = preview.steps !== null;
  const pointed = preview.options.find((o) => o.pointed);
  const pointedName = pointed && recommendedLabel(pointed.label).text;
  const busyIcon = (
    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Sending" />
  );

  return (
    <DialogCard label={preview.question}>
      {/* Wizard form only: the stepper chips + Left/Right navigation, exactly as in WizardBlock —
          a preview question is just one step of the same dialog. */}
      {wizard && (
        <WizardStepper
          steps={preview.steps!}
          locked={locked}
          busyBack={sending === "nav-back"}
          busyNext={sending === "nav-next"}
          busyIcon={busyIcon}
          onBack={() => press("nav-back", { kind: "nav", keys: WIZARD_BACK_KEYS })}
          onNext={() => press("nav-next", { kind: "nav", keys: WIZARD_NEXT_KEYS })}
        />
      )}
      <QuestionHeading>{preview.question}</QuestionHeading>

      {/* A row points at its option (its preview shows below); the pointed row is already shown. One
          choice, so the rows are radios and the pointed one is checked. */}
      <div role="radiogroup" aria-label={preview.question} className="flex flex-col gap-2">
        {preview.options.map((option, i) => {
          const id = `opt-${i}`;
          const busy = sending === id;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={option.pointed}
              disabled={locked}
              onClick={() => { if (!option.pointed) void press(id, { kind: "point", option }); }}
              className={optionSurface(busy ? "busy" : option.pointed ? "selected" : "default")}
            >
              <span aria-hidden className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                option.pointed ? "border-primary" : "border-muted-foreground/60",
              )}>
                {option.pointed && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex-1">
                <OptionLabel label={option.label} />
              </span>
              {busy ? busyIcon : option.chosen ? (
                <Check className="size-4 shrink-0 text-primary" aria-label="Current answer" />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Native preview content, without the terminal widget's frame. */}
      {preview.preview.length > 0 && (
        <div role="group" aria-labelledby={captionId} className="flex min-w-0 flex-col gap-1.5">
          <p id={captionId} className="text-[13px] leading-[18px] text-muted-foreground">
            {pointedName ? `Preview of ${pointedName}` : "Preview"}
          </p>
          <PreviewContent lines={preview.preview} />
        </div>
      )}

      {/* The question's note: the terminal-editing banner (everything locked), our own editor, or the
          attached note with edit/remove. Adding one sits with the card's other utilities below. */}
      {terminalEditing ? (
        <p className="rounded-xl border border-dashed border-status-working/50 px-3.5 py-2.5 text-[15px] leading-5 text-status-working">
          Note is being edited in the agent session — controls resume when editing finishes.
          {preview.note.text ? <span className="text-muted-foreground"> ({preview.note.text})</span> : null}
        </p>
      ) : editorOpen ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={NOTE_MAX_LENGTH}
            rows={2}
            autoFocus
            aria-label="Note text"
            placeholder="Add context for your answer…"
            className="min-h-16 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={locked || draft.trim().length === 0}
              onClick={() => void saveNote()}
              className={cn(PRIMARY_ACTION, "w-auto")}
            >
              {sending === "note-save" ? busyIcon : null}
              Save note
            </button>
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
      ) : preview.note.state === "attached" ? (
        <div className="flex items-center gap-2 rounded-xl bg-muted/60 py-1 pr-1 pl-3.5">
          <StickyNote className="size-4 shrink-0 text-muted-foreground" aria-label="Note" />
          <span className="min-w-0 flex-1 text-[15px] leading-5 text-foreground">{preview.note.text}</span>
          <button
            type="button"
            aria-label="Edit note"
            disabled={locked}
            onClick={() => {
              setDraft(preview.note.text);
              setEditorOpen(true);
            }}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted disabled:opacity-50"
          >
            <Pencil className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Remove note"
            disabled={locked}
            onClick={() => void press("note-remove", { kind: "note", text: "" })}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors active:bg-muted disabled:opacity-50"
          >
            {sending === "note-remove" ? busyIcon : <Trash2 className="size-4" />}
          </button>
        </div>
      ) : null}

      {/* An open note editor owns the card until it is saved or dropped: choosing now would lose it. */}
      {pointed && !editorOpen && (
        <button
          type="button"
          disabled={locked}
          onClick={() => void press("choose", { kind: "choose", option: pointed })}
          className={PRIMARY_ACTION}
        >
          {sending === "choose" ? busyIcon : null}
          Choose {pointedName}
        </button>
      )}

      {!terminalEditing && !editorOpen && preview.note.state !== "attached" && (
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
            <StickyNote aria-hidden className="size-4 shrink-0" />
            Add a note…
          </button>
        </SecondaryActions>
      )}
    </DialogCard>
  );
}
