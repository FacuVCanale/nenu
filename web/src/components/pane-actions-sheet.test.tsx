import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import { clearStatus } from "@/lib/status";
import type { AgentView } from "@/lib/types";
import { PaneActionsSheet } from "./pane-actions-sheet";

// The long-press pane actions sheet: an action-list first view (Rename / Close pane), with rename
// tucked behind its own tap so opening the sheet never shoves a keyboard-triggering input at you.
// Both actions are wired straight to the bridge via lib/api (exercised through MSW here); the parent
// gets onRenamed / onClosed callbacks for the revalidate/navigate side-effects.

beforeEach(() => clearStatus());

const agent: AgentView = {
  paneId: "w1:p1",
  workspaceId: "w1",
  workspaceLabel: "webapp",
  workspaceNumber: 1,
  tabId: "w1:t1",
  agent: "claude",
  status: "idle",
  cwd: "/home/you/webapp",
  focused: false,
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof PaneActionsSheet>> = {}) {
  const props: React.ComponentProps<typeof PaneActionsSheet> = {
    open: true,
    onClose: vi.fn(),
    pane: agent,
    onRenamed: vi.fn(),
    onClosed: vi.fn(),
    ...overrides,
  };
  render(<PaneActionsSheet {...props} />);
  return props;
}

describe("PaneActionsSheet — action list", () => {
  it("opens on the action list, not the rename input", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close pane" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("name this pane")).toBeNull();
  });

  it("color-codes the Close pane row as destructive from the first tap, not just once armed", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Close pane" })).toHaveClass("text-destructive");
  });
});

describe("PaneActionsSheet — rename", () => {
  it("stays on the action list until Rename is tapped, then shows the prefilled input", async () => {
    const user = userEvent.setup();
    renderSheet({ pane: { ...agent, paneLabel: "deploy" } });
    expect(screen.queryByPlaceholderText("name this pane")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this pane")).toHaveValue("deploy");
  });

  it("autofocuses the input once rename mode opens", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.getByPlaceholderText("name this pane")).toHaveFocus());
  });

  it("edits under an iOS edit header, Cancel · Rename pane · Save, with no Back link", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("heading", { name: "Rename pane" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Pane name" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("clears the field in one tap and keeps the keyboard on it", async () => {
    const user = userEvent.setup();
    renderSheet({ pane: { ...agent, paneLabel: "deploy" } });
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Clear name" }));
    expect(screen.getByRole("textbox", { name: "Pane name" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Pane name" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear name" })).toBeNull();
  });

  it("Cancel returns to the action list without saving", async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByPlaceholderText("name this pane")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  it("posts the trimmed label, then calls onRenamed and closes", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(/\/api\/pane\/[^/]+\/rename$/, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const props = renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByPlaceholderText("name this pane");
    await user.type(input, "  deploy  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onRenamed).toHaveBeenCalledTimes(1));
    expect(body).toEqual({ label: "deploy" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the label by saving an empty field (sends an empty label)", async () => {
    const user = userEvent.setup();
    let body: unknown;
    server.use(
      http.post(/\/api\/pane\/[^/]+\/rename$/, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const props = renderSheet({ pane: { ...agent, paneLabel: "deploy" } });
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.clear(screen.getByPlaceholderText("name this pane"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(props.onRenamed).toHaveBeenCalledTimes(1));
    expect(body).toEqual({ label: "" });
  });

  it("does NOT revalidate or close when the rename fails (error goes to the status channel)", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(/\/api\/pane\/[^/]+\/rename$/, () => HttpResponse.json({ ok: false, error: "pane not found" })),
    );
    const props = renderSheet();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await user.type(screen.getByPlaceholderText("name this pane"), "x");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The sheet stays open (Save still enabled) and neither side-effect fires.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
    expect(props.onRenamed).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("resets back to the action list when the sheet reopens, even mid-rename", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PaneActionsSheet open={true} onClose={vi.fn()} pane={agent} onRenamed={vi.fn()} onClosed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this pane")).toBeInTheDocument();

    rerender(<PaneActionsSheet open={false} onClose={vi.fn()} pane={agent} onRenamed={vi.fn()} onClosed={vi.fn()} />);
    rerender(<PaneActionsSheet open={true} onClose={vi.fn()} pane={agent} onRenamed={vi.fn()} onClosed={vi.fn()} />);

    expect(screen.queryByPlaceholderText("name this pane")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });

  it("resets back to the action list when the target pane changes, even mid-rename", async () => {
    const user = userEvent.setup();
    const other: AgentView = { ...agent, paneId: "w1:p2" };
    const { rerender } = render(<PaneActionsSheet open={true} onClose={vi.fn()} pane={agent} onRenamed={vi.fn()} onClosed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByPlaceholderText("name this pane")).toBeInTheDocument();

    rerender(<PaneActionsSheet open={true} onClose={vi.fn()} pane={other} onRenamed={vi.fn()} onClosed={vi.fn()} />);

    expect(screen.queryByPlaceholderText("name this pane")).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
  });
});

describe("PaneActionsSheet — close", () => {
  // Only the clock the settle window reads is faked; user-event and MSW keep real timers.
  beforeEach(() => vi.useFakeTimers({ toFake: ["performance"] }));
  afterEach(() => vi.useRealTimers());

  function countCloses() {
    const calls: string[] = [];
    server.use(
      http.post(/\/api\/pane\/[^/]+\/close$/, ({ request }) => {
        calls.push(request.url);
        return HttpResponse.json({ ok: true });
      }),
    );
    return calls;
  }

  it("asks first, naming the pane and what closing it does, and closes nothing yet", async () => {
    const user = userEvent.setup();
    const calls = countCloses();
    const props = renderSheet();

    await user.click(screen.getByRole("button", { name: "Close pane" }));

    expect(screen.getByRole("heading", { name: "Close “claude”?" })).toBeInTheDocument();
    expect(screen.getByText("The agent in this pane stops. This can't be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(props.onClosed).not.toHaveBeenCalled();
  });

  it("ignores a tap that lands right after the first, so a double tap closes nothing", async () => {
    const user = userEvent.setup();
    const calls = countCloses();
    const props = renderSheet();

    await user.click(screen.getByRole("button", { name: "Close pane" }));
    await user.click(screen.getByRole("button", { name: "Close pane" }));
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(600);
    await user.click(screen.getByRole("button", { name: "Close pane" }));
    await waitFor(() => expect(props.onClosed).toHaveBeenCalledExactlyOnceWith("w1:p1"));
    expect(calls).toHaveLength(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("Cancel goes back to the actions and closes nothing", async () => {
    const user = userEvent.setup();
    const calls = countCloses();
    const props = renderSheet();

    await user.click(screen.getByRole("button", { name: "Close pane" }));
    vi.advanceTimersByTime(600);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Close/ })).toBeNull();
    expect(calls).toEqual([]);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("says a shell's programs stop, not an agent", async () => {
    const user = userEvent.setup();
    renderSheet({ pane: { ...agent, kind: "shell", agent: "shell", paneLabel: "dev server" } });
    await user.click(screen.getByRole("button", { name: "Close pane" }));
    expect(screen.getByRole("heading", { name: "Close “dev server”?" })).toBeInTheDocument();
    expect(screen.getByText("Anything running in this shell stops. This can't be undone.")).toBeInTheDocument();
  });
});

describe("PaneActionsSheet — read-only", () => {
  it("shows a note and no write actions when the device isn't authorised", () => {
    renderSheet({ readOnly: true });
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByPlaceholderText("name this pane")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close pane" })).toBeNull();
  });
});
