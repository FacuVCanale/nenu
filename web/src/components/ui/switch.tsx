import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

// Minimal accessible toggle (no Radix dependency): a button with role="switch". iOS proportions on a
// coarse pointer (51x31, a 27px thumb), 40x24 on a fine one, and a white thumb in both themes; the
// hit-area reaches 44px on touch. Focus is the app-wide ring (index.css).
function Switch({ checked, onCheckedChange, disabled, id, ...rest }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      data-slot="switch"
      className={cn(
        "hit-area inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none coarse:h-[31px] coarse:w-[51px] disabled:cursor-not-allowed disabled:opacity-50",
        // Off is a solid track, not a hollow outline. The track alone is 1.27:1 on a white card, so
        // an inset ring carries the 3:1 that WCAG 1.4.11 asks of the state: 3.3:1 light, 3.6:1 dark.
        checked ? "bg-primary" : "bg-switch-off shadow-[inset_0_0_0_1px_var(--switch-ring)]",
      )}
      {...rest}
    >
      <span
        className={cn(
          "pointer-events-none block size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-out motion-reduce:transition-none coarse:size-[27px]",
          checked ? "translate-x-[18px] coarse:translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export { Switch };
