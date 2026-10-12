import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/test/setup";
import type { Interaction } from "@/lib/types";
import { useInteractions } from "./use-interactions";

const card: Interaction = {
  paneId: "w1:p1", agent: "claude", kind: "question", family: "select", question: "Which fruit?", signature: "sig-1",
  revision: 1, detectedAt: 0, options: [{ index: 0, label: "Apple", role: "neutral" }, { index: 1, label: "Pear", role: "neutral" }],
};

describe("useInteractions", () => {
  it("hides an answered dialog behind its receipt even when a read still returns it", async () => {
    server.use(http.get("/api/interactions", () => HttpResponse.json({ interactions: [card] })));
    const { result } = renderHook(() => useInteractions());
    await waitFor(() => expect(result.current.interactions).toHaveLength(1));
    await act(async () => { await result.current.answer(card, card.options[0]!); });
    expect(result.current.interactions).toEqual([]);
    expect(result.current.receipts).toMatchObject([{ paneId: "w1:p1", label: "Apple" }]);
  });

  it("names what an answer did in its receipt: the command approved, the answer chosen", async () => {
    const bash: Interaction = {
      ...card, kind: "permission", family: "permission", question: "Do you want to proceed?",
      subject: { tool: "Bash", command: "echo hi > hello.txt" },
      options: [{ index: 0, label: "Yes", role: "primary" }, { index: 1, label: "No", role: "deny" }],
    };
    server.use(http.get("/api/interactions", () => HttpResponse.json({ interactions: [bash, { ...card, paneId: "w1:p2" }] })));
    const { result } = renderHook(() => useInteractions());
    await waitFor(() => expect(result.current.interactions).toHaveLength(2));
    await act(async () => { await result.current.answer(bash, bash.options[0]!); });
    await act(async () => { await result.current.answer({ ...card, paneId: "w1:p2" }, { index: 0, label: "Apple (Recommended)", role: "neutral" }); });
    expect(result.current.receipts.map((r) => r.summary)).toEqual(["Approved · echo hi > hello.txt", "Answered · Apple"]);
  });

  it("leaves a wizard's Back and Next without a receipt: the dialog is still there", async () => {
    const wizard: Interaction = { ...card, kind: "wizard", options: [...card.options, { index: 2, label: "Next", role: "nav" }] };
    server.use(http.get("/api/interactions", () => HttpResponse.json({ interactions: [wizard] })));
    const { result } = renderHook(() => useInteractions());
    await waitFor(() => expect(result.current.interactions).toHaveLength(1));
    await act(async () => { await result.current.answer(wizard, wizard.options[2]!); });
    expect(result.current.receipts).toEqual([]);
  });

  it("leaves a multi-select toggle without a receipt", async () => {
    const multi: Interaction = { ...card, kind: "multi-select", options: [{ index: 0, label: "Cheese", role: "neutral", checked: false }] };
    server.use(http.get("/api/interactions", () => HttpResponse.json({ interactions: [multi] })));
    const { result } = renderHook(() => useInteractions());
    await waitFor(() => expect(result.current.interactions).toHaveLength(1));
    await act(async () => { await result.current.answer(multi, multi.options[0]!); });
    expect(result.current.receipts).toEqual([]);
  });

  // The thread draws the card from this object; a fresh copy on every poll re-renders the conversation.
  it("keeps the same dialog object across reads that say the same thing", async () => {
    server.use(http.get("/api/interactions", () => HttpResponse.json({ interactions: [card] })));
    const { result } = renderHook(() => useInteractions());
    await waitFor(() => expect(result.current.interactions).toHaveLength(1));
    const first = result.current.interactions[0];
    let reads = 0;
    server.use(http.get("/api/interactions", () => { reads++; return HttpResponse.json({ interactions: [{ ...card }] }); }));
    act(() => result.current.refresh());
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.interactions[0]).toBe(first));
  });

  it("reports a 409 refusal as the bridge's outcome", async () => {
    server.use(http.post(/\/api\/interactions\/[^/]+\/answer$/, () =>
      HttpResponse.json({ ok: false, error: "The dialog changed.", code: "interaction_changed" }, { status: 409 })));
    const { result } = renderHook(() => useInteractions());
    let outcome;
    await act(async () => { outcome = await result.current.answer(card, card.options[0]!); });
    expect(outcome).toEqual({ ok: false, error: "The dialog changed.", code: "interaction_changed" });
    expect(result.current.receipts).toEqual([]);
  });
});
