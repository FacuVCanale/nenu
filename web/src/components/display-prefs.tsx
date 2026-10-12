import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { AArrowDown, AArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DOCK_TILE, SEGMENT_TRACK, segmentClass } from "@/components/dock-tile";
import type { DisplayPrefs } from "@/hooks/use-display-prefs";
import { CHAT_TEXT_SIZES, FONT_MAX, FONT_MIN, useChatText } from "@/hooks/use-display-prefs";

// The display prefs, as LABELLED rows behind the header menu's "Display" row.
//
// These used to be a permanent icon-only "View" row above the composer — five 28px glyphs that
// cost a whole row of a phone viewport for settings you touch once and then never again. Behind the
// menu each persistent preference gets a real name and explanation. The workbench/terminal escape
// hatch lives in the header, where it is reachable without opening another panel.
//
// The dock holds only what changes the view on screen: over the conversation, its text size; over the
// mirror, the mirror's wrap, tap and text size. Offering the mirror's rows over the chat read as
// controls that do nothing. It rides the same in-flow ComposerDock as Keys/Quick rather than a
// covering sheet, deliberately: every control here changes how the page LOOKS, so you have to see it
// while you flip it.

/** What the pane shows: the conversation, or the terminal mirror. */
export type DisplaySurface = "chat" | "terminal";

interface DisplayPrefsContentProps {
  surface: DisplaySurface;
  prefs: DisplayPrefs;
  setWrap: (wrap: boolean) => void;
  stepFontSize: (delta: number) => void;
  setTapToFocus: (tapToFocus: boolean) => void;
}

// One settings row: name (+ optional explanation) on the left, control on the right. Module-level so
// it isn't a fresh component type each render.
function Row({
  label,
  hint,
  htmlFor,
  labelId,
  control,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  labelId?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body">
            {label}
          </label>
        ) : (
          <span id={labelId} className="block text-body">
            {label}
          </span>
        )}
        {hint && <p className="mt-0.5 text-footnote text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

// Small / Default / Large as one radio group: arrows move the choice, the group is one tab stop.
function ChatTextControl({ labelId }: { labelId: string }) {
  const [size, setSize] = useChatText();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + CHAT_TEXT_SIZES.length) % CHAT_TEXT_SIZES.length;
    setSize(CHAT_TEXT_SIZES[next]!.id);
    radios.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-labelledby={labelId} className={SEGMENT_TRACK}>
      {CHAT_TEXT_SIZES.map(({ id, label }, index) => (
        <button
          key={id}
          ref={(node) => { radios.current[index] = node; }}
          type="button"
          role="radio"
          aria-checked={size === id}
          tabIndex={size === id ? 0 : -1}
          onClick={() => setSize(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={segmentClass(size === id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function DisplayPrefsContent({
  surface,
  prefs,
  setWrap,
  stepFontSize,
  setTapToFocus,
}: DisplayPrefsContentProps) {
  const chatTextId = useId();
  if (surface === "chat") {
    return (
      <div className="px-3 pb-2">
        <Row label="Text size" labelId={chatTextId} control={<ChatTextControl labelId={chatTextId} />} />
      </div>
    );
  }
  return (
    <div className="divide-y divide-border px-3 pb-2">
      <Row
        label="Wrap lines"
        hint="Off shows column-faithful output for TUI tables — you pan instead."
        htmlFor="pref-wrap"
        control={
          <Switch
            id="pref-wrap"
            checked={prefs.wrap}
            onCheckedChange={setWrap}
            aria-label="Wrap lines"
          />
        }
      />
      <Row
        label="Tap to type"
        hint="On, tapping the mirror anywhere opens the keyboard. Off, the mirror behaves like a document — taps land on the text and only the composer opens the keyboard."
        htmlFor="pref-tap-to-focus"
        control={
          <Switch
            id="pref-tap-to-focus"
            checked={prefs.tapToFocus}
            onCheckedChange={setTapToFocus}
            aria-label="Tap to type"
          />
        }
      />
      <Row
        label="Text size"
        control={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={DOCK_TILE}
              disabled={prefs.fontSize <= FONT_MIN}
              onClick={() => stepFontSize(-1)}
              aria-label="Decrease font size"
            >
              <AArrowDown className="size-4" />
            </Button>
            <span className="w-8 text-center text-footnote tabular-nums text-muted-foreground">
              {prefs.fontSize}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className={DOCK_TILE}
              disabled={prefs.fontSize >= FONT_MAX}
              onClick={() => stepFontSize(1)}
              aria-label="Increase font size"
            >
              <AArrowUp className="size-4" />
            </Button>
          </div>
        }
      />
    </div>
  );
}
