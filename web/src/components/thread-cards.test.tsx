import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";

import type { ProjectThreadView, ProjectView } from "@/lib/types";
import { ThreadCards } from "./thread-cards";

const node = (id: string, title: string, parentId: string, extra: Partial<ProjectThreadView> = {}): ProjectThreadView =>
  ({ id, title, parentId, role: "worker", status: "open", ...extra });

it("shows the coordinator's open work in the tree's order and leaves the resolved to History", () => {
  const project: ProjectView = {
    slug: "awam", name: "AWAM", status: "active",
    threads: [
      node("t-1", "Hotfix", "root", { group: "idle" }),
      node("t-2", "Depot", "root", { paneId: "depot", liveStatus: "blocked" }),
      node("t-3", "Mobile", "root", { role: "coordinator", group: "working" }),
      node("t-4", "Landing", "t-3", { group: "working" }),
      node("t-5", "Old fix", "root", { status: "resolved", updated: "2026-10-10T13:00:00Z" }),
    ],
  };
  render(<ThreadCards project={project} panes={[]} readOnly={false} onOpen={vi.fn()} onChanged={vi.fn()} />);
  const cards = screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"));
  expect(cards).toEqual(["Mobile", "Depot", "Hotfix"]);
});

it("says why each thread needs you: a question to answer on screen, or a reply the agent waits for in its chat", () => {
  const project: ProjectView = {
    slug: "demo", name: "Demo", status: "active",
    threads: [
      node("t-1", "Checkout copy", "root", { paneId: "copy", liveStatus: "idle", group: "waiting-on-you", note: "idle", selfWaiting: true }),
      node("t-2", "Payments", "root", { paneId: "pay", liveStatus: "blocked", group: "waiting-on-you", note: "blocked" }),
    ],
  };
  const onOpen = vi.fn();
  render(<ThreadCards project={project} panes={[]} readOnly={false} onOpen={onOpen} onChanged={vi.fn()} />);
  const copy = within(screen.getByRole("article", { name: "Checkout copy" }));
  expect(copy.getByText("Waiting for your reply")).toBeInTheDocument();
  expect(copy.queryByText("Asked you a question")).not.toBeInTheDocument();
  expect(copy.queryByRole("button", { name: "Answer" })).not.toBeInTheDocument();
  copy.getByRole("button", { name: "Reply" }).click();
  expect(onOpen).toHaveBeenCalledWith(project.threads[0]);
  const payments = within(screen.getByRole("article", { name: "Payments" }));
  expect(payments.getByText("Asked you a question")).toBeInTheDocument();
  expect(payments.getByRole("button", { name: "Answer" })).toBeInTheDocument();
});
