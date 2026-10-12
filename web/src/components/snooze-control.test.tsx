import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { SnoozeControl } from "@/components/snooze-control";

// SnoozeControl calls useRevalidator() to refresh the snapshot after a change. Stub it (hoisted so
// the vi.mock factory can close over it) so the component renders bare, and assert it gets called.
const { revalidate } = vi.hoisted(() => ({ revalidate: vi.fn() }));
vi.mock("react-router", () => ({
  useRevalidator: () => ({ revalidate, state: "idle" }),
}));

let lastBody: { snoozedUntil: number | null } | undefined;
beforeEach(() => {
  revalidate.mockClear();
  lastBody = undefined;
  server.use(
    http.post("/api/notifications/snooze", async ({ request }) => {
      lastBody = (await request.json()) as { snoozedUntil: number | null };
      return HttpResponse.json(lastBody);
    }),
  );
});

describe("SnoozeControl", () => {
  test("is a Do not disturb row that reads Off and offers its pauses in a menu", async () => {
    const user = userEvent.setup();
    const before = Date.now();
    render(<SnoozeControl snoozedUntil={null} />);

    const menu = screen.getByRole("combobox", { name: "Do not disturb" });
    expect(screen.getByText("Off", { selector: "span" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Off",
      "For 30 minutes",
      "For 1 hour",
      "For 4 hours",
      "Until tomorrow",
    ]);

    await user.selectOptions(menu, "For 1 hour");

    await waitFor(() => expect(lastBody).toBeDefined());
    // ~1h in the future (allow a generous lower bound to avoid clock-flake).
    expect(lastBody!.snoozedUntil).toBeGreaterThan(before + 59 * 60_000);
    expect(lastBody!.snoozedUntil).toBeLessThan(Date.now() + 61 * 60_000);
    expect(revalidate).toHaveBeenCalled();
  });

  test("pauses until 8 the next morning, local time", async () => {
    const user = userEvent.setup();
    render(<SnoozeControl snoozedUntil={null} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "Do not disturb" }), "Until tomorrow");

    await waitFor(() => expect(lastBody).toBeDefined());
    const morning = new Date();
    morning.setDate(morning.getDate() + 1);
    morning.setHours(8, 0, 0, 0);
    expect(lastBody!.snoozedUntil).toBe(morning.getTime());
  });

  test("shows the deadline as the row's value and turns off from the same menu", async () => {
    const user = userEvent.setup();
    const until = Date.now() + 60 * 60_000;
    render(<SnoozeControl snoozedUntil={until} />);

    const time = new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(screen.getByText(new RegExp(`Until .*${time}`), { selector: "span" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Do not disturb" }), "Off");

    await waitFor(() => expect(lastBody).toBeDefined());
    expect(lastBody!.snoozedUntil).toBeNull();
    expect(revalidate).toHaveBeenCalled();
  });
});
