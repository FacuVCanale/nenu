import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// The quiet name over a group of controls: the docks' Keys · Quick · Display, the desk's Panes, the
// palette's list. Sentence case in the tertiary tone, so it names the group without competing with it.
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("shrink-0 text-footnote font-medium text-subtle-foreground", className)}>{children}</span>;
}
