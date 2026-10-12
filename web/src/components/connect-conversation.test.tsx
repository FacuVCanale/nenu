import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { connectConversation, fetchConversations } from "@/lib/api";
import { ConnectConversation } from "./connect-conversation";

vi.mock("@/lib/api", () => ({ fetchConversations: vi.fn(), connectConversation: vi.fn() }));
vi.mock("react-router", async (original) => ({ ...await original<typeof import("react-router")>(), useRevalidator: () => ({ revalidate: async () => {}, state: "idle" }) }));
beforeEach(() => {
  vi.mocked(fetchConversations).mockReset();
  vi.mocked(connectConversation).mockReset().mockResolvedValue({ ok: true });
});

const ID = "11111111-2222-3333-4444-555555555555";

// T18: the empty Codex pane stacked a second explanation, a bare ID field and a dim Connect button
// under the composer. One way forward shows; the ID waits behind its own disclosure.
describe("ConnectConversation", () => {
  it("keeps the session ID behind a disclosure and connects the typed one", async () => {
    const user = userEvent.setup();
    const connected = vi.fn();
    render(<ConnectConversation paneId="w2:codex" session="work" disabled={false} onConnected={connected} />);
    expect(screen.getByRole("button", { name: "Find Codex conversations" })).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: "Session ID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect history" })).not.toBeInTheDocument();

    const disclosure = screen.getByRole("button", { name: "Enter a session ID" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Connect history" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Session ID" }), ` ${ID} `);
    await user.click(screen.getByRole("button", { name: "Connect history" }));

    expect(connectConversation).toHaveBeenCalledWith("w2:codex", ID, "work");
    await waitFor(() => expect(connected).toHaveBeenCalledOnce());
  });

  it("lists the conversations running here and connects the chosen one", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchConversations).mockResolvedValue({ conversations: [{ id: ID, title: "My terminal session" }] });
    render(<ConnectConversation paneId="w2:codex" disabled={false} onConnected={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Find Codex conversations" }));
    await user.selectOptions(await screen.findByLabelText("Conversation to connect"), ID);
    await user.click(screen.getByRole("button", { name: "Connect history" }));
    expect(connectConversation).toHaveBeenCalledWith("w2:codex", ID, undefined);
  });

  it("says when no conversation runs here instead of an empty list", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchConversations).mockResolvedValue({ conversations: [] });
    render(<ConnectConversation paneId="w2:codex" disabled={false} onConnected={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Find Codex conversations" }));
    expect(await screen.findByText("No Codex conversation is running in this folder.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conversation to connect")).not.toBeInTheDocument();
  });
});
