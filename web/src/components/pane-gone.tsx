import { MessageSquareX, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A chat whose pane is gone, while the route cannot move off it (Herdr is not answering, or the link
 * named a pane this page never saw): what happened, and the way on. A pane that closed under you
 * offers the one beside it first; Home is always there. Nothing here writes, so it has no composer.
 */
export function PaneGone({ closed, unsure, next, onOpen, onHome }: {
  /** The pane closed while this page showed it. */
  closed: boolean;
  /** Nenu cannot ask Herdr right now, so a pane it never saw may still exist. */
  unsure: boolean;
  /** The pane beside it, with the name its row shows. */
  next?: { paneId: string; name: string };
  onOpen: (paneId: string) => void;
  onHome: () => void;
}) {
  const [title, body] = closed
    ? ["This pane is closed", "It was closed in Herdr, or its terminal exited."]
    : unsure
      ? ["Nenu can't find this pane yet", "It isn't in the last update from Herdr. Nenu looks again once it reconnects."]
      : ["That pane no longer exists", "This link points to a pane Herdr no longer has."];
  return (
    <EmptyState icon={closed ? MessageSquareX : SearchX} title={title} className="my-auto" action={
      <div className="flex flex-wrap items-center justify-center gap-2">
        {next && <Button type="button" onClick={() => onOpen(next.paneId)} className="max-w-[min(20rem,80vw)]">
          <span className="truncate">Open {next.name}</span>
        </Button>}
        <Button type="button" variant={next ? "outline" : "default"} onClick={onHome}>Home</Button>
      </div>
    }>{body}</EmptyState>
  );
}
