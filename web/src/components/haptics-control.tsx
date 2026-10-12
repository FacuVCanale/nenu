import { ListRow } from "@/components/ui/list-group";
import { Switch } from "@/components/ui/switch";
import { hapticsSupported, setHapticsEnabled, useHapticsEnabled } from "@/lib/haptics";

// Haptics live in SETTINGS, not the pane's Display dock: that dock is explicitly "how the mirror
// looks", and a buzz is device behaviour, not a rendering pref. Default on. A row for a list group.
//
// Hidden entirely where the platform has no vibrate API (iOS Safari) — a toggle that provably
// cannot do anything is worse than no toggle, because flipping it teaches the user the app lies.
export function HapticsControl() {
  const enabled = useHapticsEnabled();
  if (!hapticsSupported()) return null;

  return (
    <ListRow title="Haptics" hint="A buzz on key and quick-reply taps.">
      <Switch checked={enabled} onCheckedChange={setHapticsEnabled} aria-label="Haptics" />
    </ListRow>
  );
}
