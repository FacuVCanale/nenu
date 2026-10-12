import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { NeedsYouList } from "./needs-you-list";
import type { InteractionsState } from "@/hooks/use-interactions";
import type { AgentView } from "@/lib/types";

const NAME = "Investigate the flaky Safari 18 e2e when the keyboard opens";
const PLACE = "acme-enterprise-billing-platform-migration";

const blocked: AgentView = {
  paneId: "w5:a2", workspaceId: "w5", workspaceLabel: PLACE, workspaceNumber: 5, tabId: "w5:t2",
  agent: "claude", status: "blocked", cwd: "/dev/acme", focused: false, paneLabel: NAME,
};

const interactions: InteractionsState = {
  interactions: [], receipts: [], stale: false, loaded: true, refresh: () => {}, answer: () => Promise.resolve({ ok: true }), refusalFor: () => undefined,
};

// A data router, as in the app: a row reads the navigation to say when it is opening.
function renderRow() {
  const element = <NeedsYouList agents={[blocked]} session="work" items={[{ paneId: blocked.paneId }]} receipts={[]} interactions={interactions} lockReason={undefined} opening={null} />;
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element }])} />);
  return screen.getByRole("link");
}

it("reads a blocked row as its thread, where it lives and why it waits", () => {
  const row = renderRow();
  expect(row).toHaveAccessibleName(`${NAME}, ${PLACE}, waiting in the terminal`);
  expect(row).toHaveAttribute("href", "/pane/w5%3Aa2?s=work");
});

// jsdom lays nothing out, so this pins the class the fix stands on: the column that holds the name
// and the place may shrink below its text (min-w-0). Without it the name keeps its full width, crosses
// the card and pushes the chevron off a phone screen while every class below still reads right. The
// geometry itself is measured in a browser at 390 px, outside this suite.
it("lets the name and the place shorten inside the row while the status stays readable", () => {
  renderRow();
  const name = screen.getByText(NAME);
  expect(name.parentElement).toHaveClass("min-w-0");
  expect(name).toHaveClass("truncate");
  expect(screen.getByText(PLACE)).toHaveClass("min-w-0", "truncate");
  expect(screen.getByText("waiting in the terminal")).toHaveClass("shrink-0");
});

// SYS-17 on the card: a tap on a question card's header waits on the thread's read like a row does,
// so the card says it is opening instead of sitting still.
it("says a question card's thread is opening while it loads", () => {
  const interaction = { paneId: blocked.paneId, agent: "claude", signature: "sig", revision: 1, detectedAt: 0, kind: "question", family: "select",
    question: "Which fruit?", options: [{ index: 0, label: "Apple", role: "neutral" }] } as const;
  const element = <NeedsYouList agents={[blocked]} session="work" items={[{ paneId: blocked.paneId, interaction: { ...interaction, options: [...interaction.options] } }]}
    receipts={[]} interactions={interactions} lockReason={undefined} opening="/pane/w5%3Aa2" />;
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element }])} />);
  expect(screen.getByRole("button", { name: /open thread/i })).toHaveAttribute("aria-busy", "true");
});
