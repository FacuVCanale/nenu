import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { server } from "@/test/setup";
import { fixtureAgents } from "@/test/handlers";
import { AgentChat } from "./agent-chat";

// A subagent's conversation takes the chat's place, and the chat's header becomes the subagent's:
// "‹ Main" where every back sits, its name as the title and what it is under it (T37).

const reviewer = { id: "a1", parentId: "", name: "reviewer", task: "Review the diff", status: "waiting", model: "claude-opus-5-5" };

beforeAll(() => { if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}; });
beforeEach(() => {
  server.use(
    http.get(/\/api\/pane\/[^/]+\/subagents$/, () => HttpResponse.json({ available: true, sessionKey: "parent-key", agents: [reviewer], truncated: false })),
    http.get(/\/api\/pane\/[^/]+\/activity$/, () => HttpResponse.json({ available: false })),
    http.get(/\/api\/pane\/[^/]+\/subagent-history$/, () => HttpResponse.json({ sessionKey: "parent-key", agent: reviewer,
      entries: [{ uuid: "child", ts: "", role: "assistant", parts: [{ kind: "text", text: "Child result" }] }], truncated: false })),
  );
});

function renderChat(overrides: Partial<ComponentProps<typeof AgentChat>> = {}) {
  const agent = { ...fixtureAgents[0]!, paneLabel: "Working Claude", status: "working" as const, hasSession: true };
  const tabs = [{ tabId: agent.tabId, workspaceId: agent.workspaceId, number: 1, label: "review", focused: false, paneCount: 1 }];
  const props: ComponentProps<typeof AgentChat> = {
    paneId: agent.paneId, agent, agents: [agent], shellPanes: [], tabs, text: "", onBack: vi.fn(), onSelect: vi.fn(), ...overrides,
  };
  render(<RouterProvider router={createMemoryRouter([{ path: "/pane/:paneId", element: <AgentChat {...props} /> }], { initialEntries: ["/pane/w1:p1"] })} />);
  return { user: userEvent.setup() };
}

async function openReviewer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /^Processes/ }));
  await user.click(screen.getByRole("button", { name: "Expand reviewer" }));
  await user.click(screen.getByRole("button", { name: "Open conversation: reviewer" }));
  await screen.findByText("Child result");
}

it("turns the chat's header into ‹ Main, the subagent's name and what it is, and steps the tab strip aside", async () => {
  const { user } = renderChat();
  expect(document.querySelector('[data-workbench-navigation-band="tabs"]')).not.toBeNull();
  await openReviewer(user);
  const header = screen.getByRole("banner");
  expect(within(header).getByRole("button", { name: "Back to Main" })).toHaveTextContent("Main");
  expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent("reviewer");
  expect(within(header).getByText(/Subagent · Opus 5\.5/)).toBeInTheDocument();
  expect(document.querySelector('[data-workbench-navigation-band="tabs"]')).toBeNull();
  // The conversation has no second row of its own any more.
  expect(screen.getAllByRole("button", { name: "Back to Main" })).toHaveLength(1);

  await user.click(within(header).getByRole("button", { name: "Back to Main" }));
  expect(within(screen.getByRole("banner")).getByRole("heading", { level: 1 })).toHaveTextContent(/^Working Claude/);
  expect(document.querySelector('[data-workbench-navigation-band="tabs"]')).not.toBeNull();
});
