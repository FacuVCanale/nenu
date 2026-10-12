import type { ReactNode } from "react";

import { ListRow, ListSection } from "@/components/ui/list-group";
import { Switch } from "@/components/ui/switch";
import { useNotifyPrefs } from "@/hooks/use-notify-prefs";
import type { NotifyPrefs } from "@/lib/api";

// Which lifecycle events are worth a push. Bridge-wide (fans out to every device, like the snooze),
// so the footer says so, and says where THIS device stands: a blocked phone still sees these rows
// live, because they decide what every other device gets. Three switches: "Needs input" (blocked,
// default on), "Finished" (done, default off), and "App updates" (updates, default on). Optimistic
// toggle with revert on failure — see useNotifyPrefs.

const ROWS: ReadonlyArray<{ key: keyof NotifyPrefs; label: string; hint: string }> = [
  { key: "blocked", label: "Needs input", hint: "When an agent is waiting on you." },
  { key: "done", label: "Finished", hint: "When an agent completes its task." },
  { key: "updates", label: "App updates", hint: "When a new Nenu version is out." },
];

/** Push on this device: on, off, blocked by the browser, or unavailable here (HTTP, no Push API). */
export type DevicePush = "on" | "off" | "blocked" | "unavailable";

export function NotifyPrefsControl({ thisDevice, children }: { thisDevice?: DevicePush; children?: ReactNode }) {
  const { prefs, busy, toggle } = useNotifyPrefs();
  const footer = `Applies to every device with push on.${thisDevice ? ` This device: ${thisDevice}.` : ""}`;

  return (
    <ListSection title="Notify when" footer={footer}>
      {/* Rendered before `prefs` lands, not after. ROWS is static, so the group's SHAPE is known from
          the first frame — only the switch values are pending. Gating the list on `prefs` grew the
          page a moment after paint and pushed everything under it down. The switches stay disabled
          until the real values arrive, so nothing can be toggled from a placeholder state. */}
      {ROWS.map((row) => (
        <ListRow key={row.key} title={row.label} hint={row.hint}>
          <Switch
            checked={prefs?.[row.key] ?? false}
            disabled={busy || !prefs}
            onCheckedChange={(next) => void toggle(row.key, next)}
            aria-label={row.label}
          />
        </ListRow>
      ))}
      {children}
    </ListSection>
  );
}
