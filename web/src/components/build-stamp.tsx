import { cn } from "@/lib/utils";
import { buildLabel } from "@/lib/build";

// The build baked into THIS bundle, so it travels with the cached bundle and names what you are
// actually running. Passive text: when the bridge serves a newer build, the Updates card says so
// and offers the reload (see update-status.ts). See README → Troubleshooting.
export function BuildStamp({ className }: { className?: string }) {
  return (
    <p data-slot="build-stamp" className={cn("text-caption tabular-nums text-subtle-foreground", className)}>
      {buildLabel()}
    </p>
  );
}
