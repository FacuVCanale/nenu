import { describe, expect, test } from "vitest";

import { staleNotifications } from "@/lib/stale-notifications";

// Without a retraction push (iOS revokes a subscription after a few pushes that show nothing), the
// app closes what it no longer needs on the lock screen whenever it is open.
describe("staleNotifications", () => {
  const note = (paneId?: string) => ({ data: paneId ? { paneId } : {} });
  test("keeps a notification only while its agent still waits on you or finished unseen", () => {
    const notes = [note("waits"), note("unseen"), note("seen"), note("gone"), note()];
    const panes = [
      { paneId: "waits", status: "blocked" },
      { paneId: "unseen", status: "done" },
      { paneId: "seen", status: "idle" },
    ];
    expect(staleNotifications(notes, panes).map((n) => n.data.paneId)).toEqual(["seen", "gone"]);
  });

  test("the pane on screen is never kept", () => {
    expect(staleNotifications([note("open")], [{ paneId: "open", status: "blocked" }], "open")).toHaveLength(1);
  });
});
