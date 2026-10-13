import { afterEach, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/setup";
import { fakeLiveStream } from "@/test/live-stream";
import { resetLiveEvents } from "@/lib/live-events";
import type { SubagentsResponse } from "@/lib/types";
import { useSubagents } from "./use-subagents";

afterEach(() => resetLiveEvents());

const list = (status: "running" | "completed"): SubagentsResponse => ({
  available: true, sessionKey: "s1", truncated: false,
  agents: [{ id: "a1", parentId: "p", name: "Explore", task: "map the repo", status }],
});

// Every journal append re-reads the list; an answer equal to the one on screen keeps its object, so
// the chat around it does not re-render for nothing.
test("an unchanged re-read keeps the list object; a changed one replaces it", async () => {
  let reads = 0;
  let body = list("running");
  server.use(http.get("/api/pane/:id/subagents", () => { reads++; return HttpResponse.json(body); }));
  const live = fakeLiveStream();
  live.open();
  const { result } = renderHook(() => useSubagents({ paneId: "w1:p1", enabled: true }));
  await waitFor(() => expect(result.current.list).toEqual(body));
  const first = result.current.list;
  act(() => live.send({ topic: "journal", paneId: "w1:p1" }));
  await waitFor(() => expect(reads).toBe(2));
  await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(result.current.list).toBe(first);
  body = list("completed");
  act(() => live.send({ topic: "journal", paneId: "w1:p1" }));
  await waitFor(() => expect(result.current.list).not.toBe(first));
  live.stop();
});
