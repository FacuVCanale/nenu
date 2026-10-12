import { createContext, useContext } from "react";

const RECOMMENDED = /\s*\(recommended\)\s*$/i;

export const QuestionReplyContext = createContext<((text: string) => void) | null>(null);
/** Who owns this pane's live dialog: the card at the thread's tail, another dialog surface, or nobody. */
export const QuestionLiveContext = createContext<"card" | "dialog" | null>(null);

export function TranscriptQuestion({ title, options, active }: { title: string; options: string[]; active: boolean }) {
  const live = useContext(QuestionLiveContext);
  const reply = useContext(QuestionReplyContext);
  const prepare = live ? null : reply;
  // The card right under it asks the same question and owns the answer.
  if (active && live === "card") return null;
  return <section aria-label="Agent question" className="space-y-2 rounded-lg border bg-muted/30 p-3">
    <p className="text-sm font-medium">{title}</p>
    {options.length > 0 && <div className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        // The agent's "(Recommended)" reads as a badge, as on the live card.
        const label = option.replace(RECOMMENDED, "");
        return <button key={index} type="button" disabled={!active || !prepare}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border bg-background px-3 text-sm disabled:opacity-60"
          onClick={() => prepare?.(`${title}\n${option}`)}>
          {label}
          {label !== option && <span className="rounded-full bg-primary/12 px-1.5 py-px text-[11px] font-medium leading-4 text-primary">Recommended</span>}
        </button>;
      })}
    </div>}
    {active && prepare && <p className="text-xs text-muted-foreground">Choose an option to prepare your reply, or answer in the message field.</p>}
  </section>;
}
