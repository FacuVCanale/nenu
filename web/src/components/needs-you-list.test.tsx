import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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
  interactions: [], receipts: [], stale: false, loaded: true, refresh: () => {}, answer: () => Promise.resolve({ ok: true }),
};

function renderRow() {
  render(
    <MemoryRouter>
      <NeedsYouList agents={[blocked]} session="work" items={[{ paneId: blocked.paneId }]} receipts={[]} interactions={interactions} readOnly={false} />
    </MemoryRouter>,
  );
  return screen.getByRole("link");
}

it("reads a blocked row as its thread, where it lives and why it waits", () => {
  const row = renderRow();
  expect(row).toHaveAccessibleName(`${NAME}, ${PLACE}, waiting in the terminal`);
  expect(row).toHaveAttribute("href", "/pane/w5%3Aa2?s=work");
});

// jsdom lays nothing out, so this pins what lets a long name give way inside its card on a phone
// (the regression drew the name at its full width and pushed the chevron off screen). The e2e bench
// measures the result.
it("lets a long name and place shorten inside the row while the status stays readable", () => {
  const row = renderRow();
  expect(row).toHaveClass("overflow-hidden");
  const name = screen.getByText(NAME);
  expect(name).toHaveClass("min-w-0", "truncate");
  expect(name).not.toHaveClass("shrink-0");
  expect(screen.getByText(PLACE)).toHaveClass("min-w-0", "truncate");
  expect(screen.getByText("waiting in the terminal")).toHaveClass("shrink-0");
});
