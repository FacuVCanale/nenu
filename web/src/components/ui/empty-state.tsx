import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  /** What is missing or empty, as a sentence. */
  title: string;
  /** Why, or what happens next. */
  children?: ReactNode;
  /** The one way forward: a single button or link, 44px tall on touch. */
  action?: ReactNode;
  className?: string;
}

// A not-found or empty screen: an icon, what is missing, why, and one way forward. Replaces the bare
// sentence that left a dead end.
export function EmptyState({ icon: Icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon && <Icon aria-hidden="true" className="mb-3 size-7 text-muted-foreground" strokeWidth={1.75} />}
      <h2 className="text-headline text-balance">{title}</h2>
      {children && <p className="mt-1 max-w-sm text-subhead text-muted-foreground text-pretty">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
