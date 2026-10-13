import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { NotifyPrefsControl } from "@/components/notify-prefs-control";

// NotifyPrefsControl fetches the bridge-wide prefs on mount and toggles them optimistically. We drive
// it through MSW: the GET seeds the switches, the POST captures the single-key partial and echoes the
// merged prefs back; a failing POST must leave the switch where it started (revert).

let lastPatch: Record<string, unknown> | undefined;
let currentPrefs: { blocked: boolean; done: boolean; threads: boolean; coordinators: boolean; subagents: boolean; updates: boolean };

beforeEach(() => {
  lastPatch = undefined;
  currentPrefs = { blocked: true, done: false, threads: true, coordinators: false, subagents: false, updates: true };
  server.use(
    http.get("/api/notifications/prefs", () => HttpResponse.json(currentPrefs)),
    http.post("/api/notifications/prefs", async ({ request }) => {
      lastPatch = (await request.json()) as Record<string, unknown>;
      currentPrefs = { ...currentPrefs, ...(lastPatch as Partial<typeof currentPrefs>) };
      return HttpResponse.json(currentPrefs);
    }),
  );
});

describe("NotifyPrefsControl", () => {
  test("renders the fetched prefs onto one switch per kind", async () => {
    render(<NotifyPrefsControl />);
    const switches = await screen.findAllByRole("switch");
    expect(switches.map((s) => [s.getAttribute("aria-label"), s.getAttribute("aria-checked")])).toEqual([
      ["Needs input", "true"],
      ["Agents finish", "false"],
      ["Threads finish", "true"],
      ["Coordinators answer", "false"],
      ["Subagent results", "false"],
      ["App updates", "true"],
    ]);
  });

  test("turning on Subagent results POSTs only that key", async () => {
    const user = userEvent.setup();
    render(<NotifyPrefsControl />);
    await user.click(await screen.findByRole("switch", { name: "Subagent results" }));
    await waitFor(() => expect(lastPatch).toEqual({ subagents: true }));
  });

  test("toggling App updates POSTs the single-key partial update", async () => {
    const user = userEvent.setup();
    render(<NotifyPrefsControl />);
    const updates = await screen.findByRole("switch", { name: /app updates/i });

    await user.click(updates); // on → off

    await waitFor(() => expect(lastPatch).toEqual({ updates: false }));
    await waitFor(() => expect(updates).not.toBeChecked());
  });

  test("toggling a row POSTs the single-key partial update", async () => {
    const user = userEvent.setup();
    render(<NotifyPrefsControl />);
    const finished = await screen.findByRole("switch", { name: "Agents finish" });

    await user.click(finished);

    await waitFor(() => expect(lastPatch).toEqual({ done: true }));
    await waitFor(() => expect(finished).toBeChecked());
  });

  test("reverts the optimistic toggle when the POST fails", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/notifications/prefs", () => new HttpResponse(null, { status: 500 })),
    );
    render(<NotifyPrefsControl />);
    const needs = await screen.findByRole("switch", { name: /needs input/i });
    expect(needs).toBeChecked();

    await user.click(needs); // optimistic → off, POST 500 → revert to on

    await waitFor(() => expect(needs).toBeChecked());
  });

  test("describes each event as a sentence", async () => {
    render(<NotifyPrefsControl />);
    await screen.findByRole("switch", { name: /needs input/i });
    expect(screen.getByText("When an agent is waiting on you.")).toBeInTheDocument();
    expect(screen.getByText("When an agent completes its task.")).toBeInTheDocument();
    expect(screen.getByText("When a new Nenu version is out.")).toBeInTheDocument();
  });

  test("shows no switch until the bridge says how each event is set", async () => {
    let answer: (() => void) | undefined;
    server.use(
      http.get("/api/notifications/prefs", () => new Promise<Response>((resolve) => {
        answer = () => resolve(HttpResponse.json(currentPrefs));
      })),
    );
    render(<NotifyPrefsControl />);

    // A disabled switch in the off position reads as "off", which the bridge never said.
    await waitFor(() => expect(answer).toBeDefined());
    expect(screen.getByText("Needs input")).toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);

    answer!();
    expect(await screen.findByRole("switch", { name: /needs input/i })).toBeChecked();
  });

  test("says the prefs could not be loaded instead of showing them off", async () => {
    server.use(http.get("/api/notifications/prefs", () => new HttpResponse(null, { status: 500 })));
    render(<NotifyPrefsControl thisDevice="on" />);
    const section = screen.getByRole("region", { name: "Notify when" });

    await waitFor(() => expect(section).toHaveTextContent("Couldn't load these settings."));
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(section).toHaveTextContent("Applies to every device with push on. This device: on.");
  });

  test("says the choices reach every device with push on, and where this one stands", async () => {
    const { rerender } = render(<NotifyPrefsControl thisDevice="blocked" />);
    const section = screen.getByRole("region", { name: "Notify when" });
    expect(section).toHaveTextContent("Applies to every device with push on. This device: blocked.");

    rerender(<NotifyPrefsControl thisDevice="on" />);
    expect(section).toHaveTextContent("Applies to every device with push on. This device: on.");

    // Push state still loading: say what is known and nothing about this device.
    rerender(<NotifyPrefsControl />);
    expect(section).toHaveTextContent("Applies to every device with push on.");
    expect(section).not.toHaveTextContent("This device");
  });
});

