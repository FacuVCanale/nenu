import { useEffect, useId, useRef } from "react";
import { Check, Pending } from "@/components/ui/icon";

import { Button } from "@/components/ui/button";
import { DOCK_TILE } from "@/components/dock-tile";
import { ECHO_DONE_MS, useActionEcho } from "@/hooks/use-action-echo";
import type { EchoPhase } from "@/hooks/use-action-echo";
import { useOperatorQuickReplies } from "@/lib/operator-config";
import { quickRepliesFor } from "@/lib/quick-replies";
import { cn } from "@/lib/utils";

interface QuickActionsContentProps {
  /** Resolves true once the reply is verified sent — drives the ✓ and the deferred close. */
  onSend: (text: string) => Promise<boolean>;
  onClose: () => void;
  /** The pane's agent + kind — pick the reply set (lib/quick-replies). A shell gets y/n, not "skip". */
  agent: string | undefined | null;
  isShell: boolean;
  disabled?: boolean;
}

// The shipped and the operator's group names are lowercase words ("confirm"); a label reads as a
// sentence-case name, never as a shouted tag.
const sentenceCase = (title: string) => title.charAt(0).toLocaleUpperCase() + title.slice(1);

// Module-level so it isn't a fresh component type each render (which would remount the chips).
// Replies are chips in a wrapping flow: the same raised tile as the Keys pad, as a 40px pill, so a
// short "yes" stays short and a long operator phrase gets the width it needs.
function Group({
  title,
  items,
  disabled,
  busy,
  phaseOf,
  onFire,
}: {
  title: string;
  items: readonly string[];
  disabled?: boolean;
  /** Some reply in the dock is in flight — the untapped siblings dim and lock out. */
  busy: boolean;
  phaseOf: (id: string) => EchoPhase;
  onFire: (text: string) => void;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-2 text-footnote text-muted-foreground">{sentenceCase(title)}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((t) => {
          const phase = phaseOf(t);
          return (
            <Button
              key={t}
              type="button"
              // The tapped reply fills with ink, and aria-busy keeps that fill while the dock is
              // disabled, so it reads over its unavailable siblings: the same busy language the dialog
              // option rows use.
              variant={phase === "idle" ? "ghost" : "default"}
              disabled={disabled || busy}
              aria-busy={phase === "pending" || undefined}
              onClick={() => onFire(t)}
              className={cn("hit-area h-10 gap-1.5 rounded-full px-4 text-subhead font-normal", phase === "idle" ? DOCK_TILE : "border border-foreground")}
            >
              {phase === "pending" && <Pending className="size-4" />}
              {phase === "done" && <Check className="size-4" />}
              {t}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// The Quick-actions body — the one-tap reply groups, no chrome of its own. Docked in-flow by the
// composer (same ComposerDock wrapper as Keys), so it never covers the mirror. Padding matches
// NavTray so both docks read identically.
//
// The dock deliberately stays up THROUGH the send. It used to close on the tap itself, which meant
// the reply's only acknowledgement — the ✓ on the composer's Send button — flashed a second later on
// a surface you'd already been navigated away from, so a quick reply felt like it vanished into
// nothing. Now the tapped button owns its own feedback (spinner → ✓, siblings dimmed) and the dock
// closes after the ✓, once you've seen where your tap went. A FAILED send leaves the dock open with
// every button live again, so you can retry without reopening it.
export function QuickActionsContent({
  onSend,
  onClose,
  agent,
  isShell,
  disabled,
}: QuickActionsContentProps) {
  const operatorGroups = useOperatorQuickReplies();
  const groups = quickRepliesFor(agent, isShell, operatorGroups);
  const echo = useActionEcho();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const fire = (text: string) => {
    if (disabled || echo.pending) return;
    void echo.run(text, async () => {
      const ok = await onSend(text);
      // Let the ✓ land before the dock goes. On failure we hold it open — the status bar carries the
      // reason and the user is one tap from trying again.
      if (ok) closeTimer.current = setTimeout(onClose, ECHO_DONE_MS);
      return ok;
    });
  };

  return (
    <div className="space-y-4 px-3 pb-3">
      {groups.map((g) => (
        <Group
          key={g.title}
          title={g.title}
          items={g.items}
          disabled={disabled}
          busy={echo.pending}
          phaseOf={echo.phaseOf}
          onFire={fire}
        />
      ))}
    </div>
  );
}
