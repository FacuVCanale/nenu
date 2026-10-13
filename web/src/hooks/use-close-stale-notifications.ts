import { useEffect } from "react";

import { staleNotifications } from "@/lib/stale-notifications";

/**
 * While Nenu is on screen, close the system notifications it no longer needs: agents that stopped
 * waiting on you, sessions you have since looked at, and the one you are looking at. The bridge
 * sends no retraction push (ADR 0072), so this is what keeps the lock screen current.
 */
export function useCloseStaleNotifications(panes: ReadonlyArray<{ paneId: string; status: string }>, openPaneId: string | null): void {
  useEffect(() => {
    if (typeof document === "undefined" || document.hidden || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.getRegistration().then(async (registration) => {
      if (!registration || cancelled || typeof registration.getNotifications !== "function") return;
      const shown = await registration.getNotifications();
      for (const notification of staleNotifications(shown, panes, openPaneId)) notification.close();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [panes, openPaneId]);
}
