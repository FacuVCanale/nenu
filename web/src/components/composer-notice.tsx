import { useId, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A notice on the draft it is about, in flow above the composer box: what happened, in the
 * operator's terms, and the controls that get them out of it. The refused send and the password
 * prompt share it, so the two read as one family and neither floats over the transcript.
 */
export function ComposerNotice({
  icon: Icon,
  title,
  children,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  tone = "info",
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** "error" announces itself and marks the icon; "info" is a polite status. */
  tone?: "info" | "error";
}) {
  const titleId = useId();
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-labelledby={titleId} className={cn("composer-notice", tone === "error" && "composer-notice-error")}>
      <Icon aria-hidden="true" className="composer-notice-icon" />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="composer-notice-title">{title}</p>
        <div className="composer-notice-body">{children}</div>
        {actions && <div className="composer-notice-actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="composer-notice-dismiss hit-area" aria-label={dismissLabel} onClick={onDismiss}>
          <X aria-hidden="true" className="size-3.5" />
        </button>
      )}
    </div>
  );
}
