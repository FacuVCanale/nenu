import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Command, Delete, Lock, Option } from "@/components/ui/icon";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Modifier } from "@/lib/key-queue";
import { usePendingConfirm } from "@/hooks/use-pending-confirm";
import { useKeyQueue } from "@/hooks/use-key-queue";
import { useActionEcho } from "@/hooks/use-action-echo";
import { useHoldRepeat } from "@/hooks/use-hold-repeat";
import { KeyQueueStrip } from "@/components/key-queue-strip";
import { DOCK_TILE, DOCK_TILE_PRESSED, SEGMENT_TRACK, segmentClass } from "@/components/dock-tile";
import { CONTROL_PRESETS, type CtrlDef } from "@/lib/operator-keys";

// The inline navigation tray: the keys you need to drive an interactive agent prompt (selection
// menus, multi-select forms, numbered choices) WITHOUT covering the terminal mirror — it docks
// above the composer, so you watch the menu update as you press. Keys follow Herdr's verified
// `pane.send_keys` grammar (see HERDR_API.md): special keys bare, modifier chords joined with "+".
//
// Two modes, driven by useKeyQueue. When nothing is armed and the queue is empty, a key press fires
// immediately (the classic path). Arm one or more modifiers (Shift / Ctrl / Option / Command) — or once any key
// is queued — and the tray enters compose mode: presses stage a visible key queue (the strip) that
// you review and Send as ONE call. Herdr rejects a bare modifier keypress, so modifiers
// only exist as part of a chord. Each modifier is a CHECKBOX that cycles off → once → locked → off:
// tap once for a one-shot (composed into the next staged key, then released), tap again to LOCK it
// armed across presses and Sends, tap a third time to clear. Any subset combines — `ctrl+shift+p`.
//
// An immediate press ECHOES on its own button (useActionEcho): a pressed fill the instant you tap, a ✓
// once the bridge accepts it. Before this the path was silent on success and the mirror — up to ~2s
// behind — was the only acknowledgement, so pressing Enter felt like nothing happened. A STAGED press
// needs no echo: the chip appearing in the strip is already the receipt. Deliberately no sibling
// dimming here (unlike the quick replies): this is a keypad you drum on, and dimming eight keys per
// arrow press would strobe.

interface NavTrayProps {
  /** Resolves true when the bridge accepted the keys — drives the ✓ echo on the pressed button. */
  onSend: (keys: string[]) => Promise<boolean>;
  /**
   * The labelled preset chords under "Presets" — the operator's own `keys.toml` rows when any of
   * them address this pane, otherwise the shipped six (resolved by `ctrlPresetsFor`). Only this
   * list is configurable; everything else in the tray is the fixed keyboard.
   */
  presets?: readonly CtrlDef[];
  /** How many keys are staged, reported up so the Composer can guard closing the dock on a composed
   *  sequence. Reports 0 on unmount. Must be referentially stable (a setState fn is ideal). */
  onQueueChange?: (staged: number) => void;
  disabled?: boolean;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

interface ModifierKey {
  m: Modifier;
  glyph?: ReactNode;
  label: string;
  aria: string;
}

const MODIFIER_KEYS: readonly ModifierKey[] = [
  { m: "ctrl", label: "Ctrl", aria: "Ctrl" },
  { m: "alt", glyph: <Option className="size-3.5" />, label: "Opt", aria: "Option (Alt)" },
  // In its own element: a bare "⇧" beside the label text would merge into one flex item and lose the gap.
  { m: "shift", glyph: <span aria-hidden="true">⇧</span>, label: "Shift", aria: "⇧ Shift" },
  { m: "cmd", glyph: <Command className="size-3.5" />, label: "Cmd", aria: "Command" },
];

// F1–F12 — Herdr's send_keys grammar accepts them bare (HERDR_API.md), and harnesses bind them to
// real actions (tmux windows, CLI hotkeys, agent-extension views like pi's CE Workflow: F7 opens
// its orchestrator). Without buttons for them, a phone-only user has no route to any such keybind.
const FN_KEYS = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];

// Two views behind a segmented toggle: the arrows pad (arrows/Esc, Tab/Space/Enter, modifiers, Ctrl
// presets) and a phone-dialer digit grid. Digits were a cramped nine-across sliver row; on their own
// tab they get large, thumb-sized targets. The tab is component state only (resets to "keys" each
// open — the dock unmounts the tray when closed), while the armed modifier, the key queue, and the
// Ctrl-expand persist across the toggle so a composed sequence survives switching to the digit pad.
// The segments are "Arrows" and "123", not "Keys": the dock that holds them is already titled Keys.
type Tab = "keys" | "digits";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "keys", label: "Arrows" },
  { id: "digits", label: "123" },
];

export function NavTray({ onSend, presets = CONTROL_PRESETS, onQueueChange, disabled: externallyDisabled }: NavTrayProps) {
  const [sendingQueue, setSendingQueue] = useState(false);
  const disabled = externallyDisabled || sendingQueue;
  const [tab, setTab] = useState<Tab>("keys");
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [fkeysOpen, setFkeysOpen] = useState(false);
  const { queue, mods, activeMods, composing, arm, press, pushBase, removeAt, clear, take } =
    useKeyQueue();
  const { pending, confirm, reset } = usePendingConfirm(); // danger ctrl two-tap (immediate path only)
  const echo = useActionEcho();
  const modStateId = useId();
  // Hold-to-repeat, WHITELISTED to the arrows (see navBtn's `repeat` flag). Deliberately a whitelist
  // rather than a blacklist: Enter/Esc/Space/digits/Ctrl-presets structurally must not repeat, and
  // the danger presets' two-tap guard lives on a different code path (pressCtrl) that a future
  // refactor could route around — so repeat capability is opt-in per button, not opt-out.
  // Disabled while composing: a hold must never stage fifteen identical chips into a queue whose
  // entire value is that you can review it before it goes on the wire.
  const repeat = useHoldRepeat(
    (key, n) => onSend(Array<string>(n).fill(key)),
    !disabled && !composing,
  );

  // Report the staged count up. The tray unmounts when the dock closes (which is what discards the
  // queue), so the Composer can't read this state itself — it has to be pushed. The second effect
  // reports 0 on unmount so a stale count can't outlive the tray and arm a phantom confirm.
  useEffect(() => {
    onQueueChange?.(queue.length);
  }, [queue.length, onQueueChange]);
  useEffect(
    () => () => {
      onQueueChange?.(0);
    },
    [onQueueChange],
  );

  // Route a key press through the queue: fire immediately when idle, stage when composing. Only the
  // immediate path echoes — a staged press is already visible as a chip.
  function fire(keys: string[], id: string) {
    if (disabled) return;
    const r = press(keys);
    if (r.mode === "fire") void echo.run(id, () => onSend(r.keys));
  }

  // Ctrl presets. When composing, a tap just stages the chord (the Send review IS the confirm — no
  // two-tap, and the strip's Send shows destructive styling for c/d/z). When firing immediately, the
  // danger chords (d/z) keep the original two-tap confirm.
  function pressCtrl(item: CtrlDef) {
    if (disabled) return;
    if (!composing && item.danger && !confirm(item.label)) return; // first tap arms the confirm
    fire(item.keys, item.label);
  }

  // A queued chord must reach the terminal before a following immediate key can overtake it.
  async function sendQueue() {
    if (disabled) return;
    const keys = take();
    reset();
    if (keys.length === 0) return;
    setSendingQueue(true);
    try {
      await onSend(keys);
    } finally {
      setSendingQueue(false);
    }
  }

  // A key button, echoing its own press. `pending` fills it the instant you tap (no network wait);
  // `done` swaps a ✓ in for the label for ECHO_DONE_MS. Keyed by the wire string, so the same key
  // pressed twice in a row restarts its own cycle rather than inheriting a stale ✓.
  //
  // `repeatable` opts a button into hold-to-repeat. While held, the button shows a live "×N" count
  // instead of running the per-press echo — echo.run per repeat tick would restart the ✓ timer ~11
  // times a second and strobe, the same reason sibling dimming is banned on this pad.
  const navBtn = (content: ReactNode, keys: string[], aria?: string, repeatable = false) => {
    const id = keys.join(" ");
    const phase = echo.phaseOf(id);
    const held = repeatable && repeat.holding === keys[0];
    const bind = repeatable ? repeat.bind(keys[0], () => fire(keys, id)) : undefined;
    return (
      <Button
        key={id}
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        {...(bind ?? { onClick: () => fire(keys, id) })}
        aria-label={aria}
        data-echo={held ? "held" : phase}
        // touch-action/select-none: without them a held button on iOS starts a text selection and
        // Android may treat the hold as a scroll gesture, both of which cancel the pointer stream.
        className={cn(DOCK_TILE, "h-11 touch-manipulation select-none px-0 text-subhead font-normal", (held || phase !== "idle") && DOCK_TILE_PRESSED)}
      >
        {held ? (
          <span className="mx-auto flex items-center gap-1">
            {content}
            {repeat.count > 1 && <span className="font-mono text-xs tabular-nums">×{repeat.count}</span>}
          </span>
        ) : phase === "done" ? (
          <Check className="mx-auto size-4" />
        ) : (
          content
        )}
      </Button>
    );
  };

  // A modifier is the same tile as every key, so the row reads as keys rather than labels, and it
  // shows its own three-state mode from `mods`: a plain tile when off, outlined and tinted in the
  // accent for one key (once), solid ink with a Lock in place of its glyph while locked, the way iOS
  // swaps Shift's arrow for caps lock. White on the accent measured 4.35:1 in dark, under the 4.5 a
  // 15px label needs; ink clears it in both themes. Tapping cycles off → once → locked → off.
  const modBtn = ({ m, glyph, label, aria }: ModifierKey) => {
    const mode = mods[m];
    // aria-pressed says armed; the description says which of the two armed states it is.
    const stateId = `${modStateId}-${m}`;
    return (
      <Button
        key={m}
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => arm(m)}
        aria-label={aria}
        title={aria}
        aria-pressed={mode !== "off"}
        aria-describedby={mode === "off" ? undefined : stateId}
        data-state={mode}
        className={cn(
          DOCK_TILE,
          "h-11 px-0 text-subhead font-normal",
          mode === "once" && "border-primary bg-primary/15 hover:bg-primary/20",
          mode === "locked" && "border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background",
        )}
      >
        {mode === "locked" ? <Lock aria-hidden="true" className="size-3.5 shrink-0" /> : glyph}
        {label}
        {mode !== "off" && <span id={stateId} className="sr-only">{mode === "locked" ? "Locked" : "Next key only"}</span>}
      </Button>
    );
  };

  return (
    <div className="space-y-2 px-3 pb-2">
      {/* Staging strip — visible only while composing (a modifier armed or keys queued). Same on
          both tabs; the review-and-Send surface replaces the old "⇧ armed" hint line. */}
      <KeyQueueStrip
        queue={queue}
        mods={activeMods}
        onRemove={removeAt}
        onClear={clear}
        onSend={sendQueue}
        onBaseChar={pushBase}
        disabled={disabled}
      />

      {/* Segmented toggle: the arrows pad vs. the phone-dialer digit grid. */}
      <div className={SEGMENT_TRACK}>
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={segmentClass(tab === id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "keys" ? (
        <>
          {/* Same physical-keyboard geometry as the composer's inline quick keys, for muscle memory:
              Esc top-left, Tab directly below it, arrows as an inverted-T on the right. The Esc/Up
              gap holds a quick Ctrl+C — the one interrupt chord worth a single tap, without opening
              Presets (which still lists it alongside the other Ctrl chords for discoverability).
              It carries the preset's own spelling, "Ctrl C" — the same chord must not read two ways
              in one drawer, and tmux notation ("C-c") is the spelling this codebase keeps out of
              sight precisely because it is not what Herdr accepts either. */}
          <div className="grid grid-cols-4 gap-2">
            {navBtn("Esc", ["Escape"])}
            {navBtn("Ctrl C", ["ctrl+c"], "Ctrl+C")}
            {navBtn(<ArrowUp className="size-4" />, ["Up"], "Up", true)}
            {navBtn("⏎ Enter", ["Enter"])}
            {navBtn("Tab", ["Tab"])}
            {navBtn(<ArrowLeft className="size-4" />, ["Left"], "Left", true)}
            {navBtn(<ArrowDown className="size-4" />, ["Down"], "Down", true)}
            {navBtn(<ArrowRight className="size-4" />, ["Right"], "Right", true)}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {navBtn(<Delete className="size-4" />, ["Backspace"], "Delete backward")}
            {navBtn("Space", ["Space"])}
            {navBtn("⇧ Tab", ["shift+Tab"], "Shift+Tab")}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {MODIFIER_KEYS.map(modBtn)}
          </div>
          <p className="text-footnote text-subtle-foreground">Tap a modifier to combine keys; tap again to lock. Command is sent to the terminal app.</p>

          <div className="grid grid-cols-2 gap-x-2">
            {/* Presets (collapsed by default; expanding keeps everything inline, never covering the
                mirror). On the immediate path a danger preset needs a second tap; while composing a
                tap just stages its chords for review. An operator's `keys.toml` rows arrive here as
                the same CtrlDef list, so a multi-chord row sends as one batch and an armed modifier
                stages it — no special-casing. */}
            <div className="contents">
              <button
                type="button"
                onClick={() => setCtrlOpen((o) => !o)}
                aria-expanded={ctrlOpen}
                className="flex min-h-11 items-center gap-1 px-1 text-footnote text-muted-foreground"
              >
                Presets
                <ChevronDown className={cn("size-3 transition-transform", ctrlOpen && "rotate-180")} />
              </button>
              {ctrlOpen && (
                <div className="col-span-2 grid grid-cols-3 gap-2">
                  {presets.map((item) => {
                    const isPending = pending === item.label;
                    const phase = echo.phaseOf(item.label);
                    // The armed two-tap confirm outranks the echo — it's the thing you must read.
                    return (
                      <Button
                        key={item.label}
                        type="button"
                        variant={isPending ? "destructive" : "ghost"}
                        size="sm"
                        disabled={disabled}
                        onClick={() => pressCtrl(item)}
                        data-echo={phase}
                        className={cn(
                          "h-11 text-subhead font-normal",
                          !isPending && DOCK_TILE,
                          !isPending && phase !== "idle" && DOCK_TILE_PRESSED,
                          item.danger && !isPending && phase === "idle" && "text-destructive",
                        )}
                      >
                        {isPending ? (
                          "Confirm?"
                        ) : phase === "done" ? (
                          <Check className="size-4" />
                        ) : (
                          item.label
                        )}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
            {/* Function keys (#119) — same collapsible shape as Presets: collapsed by default so the
                tray doesn't grow, expanding to a 4×3 grid. They ride the ordinary navBtn path, so the
                press echo, key-queue staging, and chords with armed modifiers (ctrl+F7, …) all come
                for free — no special-casing. */}
            <div className="contents">
              <button
                type="button"
                onClick={() => setFkeysOpen((o) => !o)}
                aria-expanded={fkeysOpen}
                className="flex min-h-11 items-center gap-1 px-1 text-footnote text-muted-foreground"
              >
                F keys
                <ChevronDown className={cn("size-3 transition-transform", fkeysOpen && "rotate-180")} />
              </button>
              {fkeysOpen && (
                <div className="col-span-2 grid grid-cols-4 gap-2">{FN_KEYS.map((k) => navBtn(k, [k]))}</div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Pick a numbered option — a phone-dialer 3×3 grid of large, thumb-sized digit keys. Same
           fire() path as everything else, so an armed modifier / a queue built on the Arrows tab still
           applies here. */
        <div className="grid grid-cols-3 gap-2">
          {DIGITS.map((d) => {
            const phase = echo.phaseOf(d);
            return (
              <Button
                key={d}
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => fire([d], d)}
                data-echo={phase}
                className={cn(DOCK_TILE, "h-11 text-headline font-normal", phase !== "idle" && DOCK_TILE_PRESSED)}
              >
                {phase === "done" ? <Check className="size-5" /> : d}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
