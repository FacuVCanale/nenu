import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { server } from "@/test/setup";
import { loadAgent, loadPermission, saveAgent, savePermission } from "@/lib/spawn";
import { StartAgent } from "./start-agent";

const starts: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  localStorage.clear();
  starts.length = 0;
  server.use(
    http.post("/api/pane/:paneId/start", async ({ request }) => {
      starts.push({ url: request.url, body: await request.json() });
      return HttpResponse.json({ ok: true });
    }),
  );
});

function renderStart() {
  const router = createMemoryRouter([{ path: "/", element: <StartAgent paneId="w1:p1" session="work" disabled={false} ready />, loader: () => null }]);
  render(<RouterProvider router={router} />);
}

const permissions = () => screen.getByRole("radiogroup", { name: "Permissions" });

describe("StartAgent", () => {
  it("offers New's agent and permission choice, on each agent's remembered level", async () => {
    saveAgent("codex");
    savePermission("claude", "acceptEdits");
    savePermission("codex", "auto");
    renderStart();
    const agents = await screen.findByRole("radiogroup", { name: "Agent" });
    expect(within(agents).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Claude Code", "Codex"]);
    expect(within(agents).getByRole("radio", { name: "Codex" })).toHaveAttribute("aria-checked", "true");
    expect(within(permissions()).getByRole("radio", { name: "Auto" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(agents).getByRole("radio", { name: "Claude Code" }));
    expect(within(permissions()).getByRole("radio", { name: "Accept edits" })).toHaveAttribute("aria-checked", "true");
  });

  it("names the chosen level and never argv, then remembers it the way New does", async () => {
    renderStart();
    await userEvent.click(await screen.findByRole("radio", { name: "Plan" }));
    await userEvent.click(screen.getByRole("button", { name: "Start Claude Code" }));
    await waitFor(() => expect(starts).toHaveLength(1));
    expect(new URL(starts[0]!.url).pathname).toBe("/api/pane/w1%3Ap1/start");
    expect(new URL(starts[0]!.url).searchParams.get("session")).toBe("work");
    expect(starts[0]!.body).toEqual({ agent: "claude", permission: "plan" });
    expect(loadPermission("claude")).toBe("plan");
    expect(loadAgent()).toBe("claude");
  });

  it("starts Codex with its own levels", async () => {
    renderStart();
    await userEvent.click(await screen.findByRole("radio", { name: "Codex" }));
    expect(within(permissions()).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Ask", "Auto", "Full access"]);
    await userEvent.click(screen.getByRole("radio", { name: "Full access" }));
    expect(screen.getByText(/No sandbox and never asks/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start Codex" }));
    await waitFor(() => expect(starts.map((s) => s.body)).toEqual([{ agent: "codex", permission: "full" }]));
  });
});
