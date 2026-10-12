import { useRef, type KeyboardEvent } from "react";
import { Moon, MonitorSmartphone, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import type { Theme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

// Appearance lives in ONE place: a labelled three-way in Settings. An earlier revision also put a
// cycling icon in every header; it was removed because a control you meet three times per screen
// implies you are meant to keep reaching for it, and this is a set-once preference — System already
// follows the phone, which is the situational flip (outdoors, in bed) happening on its own.

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: LucideIcon }> = [
  { value: "system", label: "System", icon: MonitorSmartphone },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** A segmented control: a neutral thumb slides under the selected option. The accent stays for
 *  focus and on-states, so a setting never reads as the page's call to action. One tab stop; the
 *  arrow keys move the selection, as a radio group's do. */
export function ThemeControl() {
  const { theme, setTheme } = useTheme();
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, OPTIONS.findIndex((o) => o.value === theme));

  function onKeyDown(event: KeyboardEvent) {
    // Alt+Left is Back and Cmd+arrows move through text: the browser's, not a theme change.
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const step = STEP[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    setTheme(OPTIONS[next]!.value);
    radios.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      onKeyDown={onKeyDown}
      className="relative grid h-9 grid-cols-3 rounded-md bg-muted p-0.5 coarse:h-11"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-sm bg-card shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-transform duration-200 ease-out motion-reduce:transition-none dark:bg-input"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((option, i) => {
        const selected = i === index;
        return (
          <button
            key={option.value}
            ref={(el) => {
              radios.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setTheme(option.value)}
            className={cn(
              "hit-area relative flex select-none items-center justify-center gap-1.5 rounded-sm text-subhead transition-colors duration-150 ease-out motion-reduce:transition-none",
              selected ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <option.icon aria-hidden="true" className="size-4 shrink-0" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
