import { Lock } from "lucide-react";

import { isReadOnly } from "@/lib/types";
import type { DeviceAuth } from "@/lib/types";
import { cn } from "@/lib/utils";

// Shown when the bridge enforces per-device auth and this device isn't on the allowlist: the UI
// drops to read-only (the backend rejects every terminal-driving action anyway). Renders nothing
// when the feature is off, the device is authorised, or the state isn't known yet — so it costs
// nothing on a normal single-user deployment. `device` comes from the snapshot (HomeData.device).
// One neutral line: the restriction is the fact, and the device name is the part that may give way.
export function ReadOnlyBanner({
  device,
  className,
}: {
  device: DeviceAuth | undefined;
  className?: string;
}) {
  if (!isReadOnly(device)) return null;
  return (
    <div
      role="status"
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted px-4 text-footnote text-muted-foreground",
        className,
      )}
    >
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="shrink-0 font-medium text-foreground">Read-only on this device</span>
      {device?.device && <span className="min-w-0 truncate"> · {device.device}</span>}
    </div>
  );
}
