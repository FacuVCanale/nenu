// The bridge pushes no retraction (iOS revokes a web-push subscription after a few pushes that show
// nothing, ADR 0072), so the open app closes the notifications it no longer needs on the lock screen:
// an agent's stays only while it still waits on you or finished without you having looked.

interface NotificationLike {
  data?: { paneId?: unknown } | null;
}

/** The notifications to close: every agent notification whose pane no longer needs you, and the
 *  pane on screen. One without a pane (an update notice) is left alone. */
export function staleNotifications<N extends NotificationLike>(
  notifications: readonly N[],
  panes: ReadonlyArray<{ paneId: string; status: string }>,
  openPaneId?: string | null,
): N[] {
  const wanted = new Set(panes.filter((p) => p.status === "blocked" || p.status === "done").map((p) => p.paneId));
  return notifications.filter((n) => {
    const paneId = n.data?.paneId;
    if (typeof paneId !== "string") return false;
    return paneId === openPaneId || !wanted.has(paneId);
  });
}
