import type { LucideIcon } from "lucide-react";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** An icon, or a picture where the screen has none of the app's chrome to say whose it is (the crash). */
  icon?: LucideIcon | ReactElement;
  /** What is missing or empty, as a sentence. */
  title: string;
  /** h1 where the screen draws no header of its own (the crash, the boot splash), so the page keeps a title. */
  titleAs?: "h1" | "h2";
  /** Why, or what happens next. */
  children?: ReactNode;
  /**
   * The way forward: the shared Button (or a link wearing buttonVariants) at size lg, ink, so every
   * empty and error page offers it the same way. A second, outline one only where a page needs two.
   */
  action?: ReactNode;
  className?: string;
}

// A not-found, empty or error screen: an icon, what is missing, why, and one way forward. Every such
// page in the app is this one, so the title size and the action read the same everywhere.
export function EmptyState({ icon: Icon, title, titleAs: Title = "h2", children, action, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {isValidElement(Icon) ? <div className="mb-3">{Icon}</div>
        : Icon && <Icon aria-hidden="true" className="mb-3 size-7 text-muted-foreground" strokeWidth={1.75} />}
      <Title className="text-headline text-balance">{title}</Title>
      {children && <p className="mt-1 max-w-sm text-subhead text-muted-foreground text-pretty">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
