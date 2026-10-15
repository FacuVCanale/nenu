import type { ComponentProps } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";

import { sendMessage } from "@/lib/api";
import { diffCommentsFor, saveDiffComment } from "@/lib/diff-comments";
import { clearStatus } from "@/lib/status";
import { Composer } from "./composer";

// Comments made on a diff wait as chips over the composer of the pane they are for, and go out with
// the next message, first, through the same guarded send. Sent, they go; refused, they stay.
vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), sendMessage: vi.fn() }));

const cart = { path: "app/cart.ts", side: "+", line: 21, quote: "const discount = applyCoupon(input.coupon, input.total);" } as const;
const checkout = { path: "app/checkout.tsx", side: "-", line: 41, quote: "const value40 = input.items.filter((item) => item).length;" } as const;
const BLOCK = [
  "Comments on the diff:",
  "- app/cart.ts:21 `+ const discount = applyCoupon(input.coupon, input.total);` Check the expiry.",
  "- app/checkout.tsx:41 `- const value40 = input.items.filter((item) => item).length;` Keep filter.",
].join("\n");

const refused = { ok: false as const, requestId: "r", stage: "preflight" as const, error: "The agent's input box isn't on screen.", textDelivered: false, code: "not_ready" as const };
let pane = 0;

beforeEach(() => {
  vi.mocked(sendMessage).mockReset();
  vi.mocked(sendMessage).mockImplementation(async (_pane, request) => ({ ok: true, requestId: request.requestId, ack: "submitted" }));
  clearStatus();
});

/** A composer on a pane of its own, with two comments already made for it. */
function setup(overrides: Partial<ComponentProps<typeof Composer>> = {}) {
  const paneId = `w7:p${++pane}`;
  saveDiffComment(paneId, overrides.session, cart, "Check the expiry.");
  saveDiffComment(paneId, overrides.session, checkout, "Keep filter.");
  const props: ComponentProps<typeof Composer> = {
    paneId, agent: "claude", isShell: false, gone: false, readOnly: false, disconnected: false, dialogPresent: false,
    text: "pane output", terminalDraft: null, rawTerminalDraft: null,
    prefs: { wrap: true, fontSize: 11, rawTerminal: false, tapToFocus: true },
    setWrap: vi.fn(), stepFontSize: vi.fn(), setRawTerminal: vi.fn(), setTapToFocus: vi.fn(), onSent: vi.fn(),
    ...overrides,
  };
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <Composer {...props} /> }])} />);
  return { paneId, user: userEvent.setup() };
}

const chips = () => screen.queryByRole("list", { name: "Comments on the diff" });
const chipLabels = () => within(chips()!).getAllByRole("listitem").map((li) => li.textContent);
const sentTexts = () => vi.mocked(sendMessage).mock.calls.map(([, request]) => request.text);

describe.each([["the terminal view", false], ["the conversation view", true]])("on %s", (_view, nativeWorkbench) => {
  it("shows this pane's comments as file:line chips over the composer, and only this pane's", () => {
    saveDiffComment("w7:elsewhere", undefined, cart, "Another pane's");
    setup({ nativeWorkbench });
    expect(chipLabels()).toEqual(["cart.ts:21", "checkout.tsx:41"]);
  });

  it("removes a comment with its chip's x", async () => {
    const { paneId, user } = setup({ nativeWorkbench });
    await user.click(screen.getByRole("button", { name: "Remove comment on app/cart.ts:21" }));
    expect(chipLabels()).toEqual(["checkout.tsx:41"]);
    expect(diffCommentsFor(paneId).map((c) => c.path)).toEqual(["app/checkout.tsx"]);
  });

  it("sends the comments first and the draft after, in one message, and lets the chips go once sent", async () => {
    const { paneId, user } = setup({ nativeWorkbench });
    await user.type(screen.getByRole("textbox"), "Please address these.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(sentTexts()).toEqual([`${BLOCK}\n\nPlease address these.`]);
    expect(vi.mocked(sendMessage).mock.calls[0]![0]).toBe(paneId);
    await waitFor(() => expect(chips()).toBeNull());
    expect(diffCommentsFor(paneId)).toEqual([]);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("sends the comments alone: Send needs no typed text while comments wait", async () => {
    const { user } = setup({ nativeWorkbench });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(sentTexts()).toEqual([BLOCK]);
    await waitFor(() => expect(chips()).toBeNull());
  });

  it("keeps the chips and the draft when the send is refused, and Try again sends them again", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce(refused);
    const { paneId, user } = setup({ nativeWorkbench });
    await user.type(screen.getByRole("textbox"), "Please address these.");
    await user.click(screen.getByRole("button", { name: "Send" }));
    // The refusal is said once the send's answer is in; only then is "kept" a claim about it.
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(chipLabels()).toEqual(["cart.ts:21", "checkout.tsx:41"]);
    expect(diffCommentsFor(paneId)).toHaveLength(2);
    expect(screen.getByRole("textbox")).toHaveValue("Please address these.");

    await user.click(retry);
    expect(sentTexts()).toEqual([`${BLOCK}\n\nPlease address these.`, `${BLOCK}\n\nPlease address these.`]);
    await waitFor(() => expect(chips()).toBeNull());
  });

  it("sends a slash command alone and keeps the comments for the next message", async () => {
    const { paneId, user } = setup({ nativeWorkbench });
    await user.type(screen.getByRole("textbox"), "/compact");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(sentTexts()).toEqual(["/compact"]);
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
    expect(diffCommentsFor(paneId)).toHaveLength(2);
    expect(chipLabels()).toEqual(["cart.ts:21", "checkout.tsx:41"]);
  });
});

// Text that may already be in the terminal stays on its bubble rather than under Send (a resend would
// duplicate it), and the comments it carried go with it. The terminal view keeps its draft, and them.
it.each([[false, ["cart.ts:21", "checkout.tsx:41"]], [true, null]])("on a send that may have arrived (conversation view: %s), the comments stay with the message", async (nativeWorkbench, left) => {
  vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, requestId: "r", stage: "submit", error: "Typed into the pane but not submitted.", textDelivered: true });
  const { user } = setup({ nativeWorkbench });
  await user.type(screen.getByRole("textbox"), "Please address these.");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(sentTexts()).toEqual([`${BLOCK}\n\nPlease address these.`]);
  await screen.findByRole("alert", { name: "Not confirmed" });
  expect(chips() && chipLabels()).toEqual(left);
});

it("shows a comment made while the composer is on screen", async () => {
  const { paneId } = setup();
  await act(async () => saveDiffComment(paneId, undefined, { ...cart, line: 30 }, "One more"));
  expect(chipLabels()).toEqual(["cart.ts:21", "cart.ts:30", "checkout.tsx:41"]);
});
