import { afterEach, expect, test } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/setup";
import { fakeLiveStream } from "@/test/live-stream";
import { resetLiveEvents } from "@/lib/live-events";
import fixture from "@/components/activity/activity.fixture.json";
import { fixtureAgents } from "@/test/handlers";
import type { AgentView } from "@/lib/types";
import { useHomeActivity } from "./ready-to-review-list";

afterEach(() => resetLiveEvents());

// Home re-reads a pane's activity on every live event naming it; an answer equal to the one on screen
// must not hand Home a new map, or every re-read re-renders the whole page for nothing.
test("an unchanged re-read keeps Home's activity map; a changed one replaces it", async () => {
  let reads = 0;
  let body: typeof fixture.list = fixture.list;
  server.use(http.get("/api/pane/:id/activity", () => { reads++; return HttpResponse.json(body); }));
  const live = fakeLiveStream();
  live.open();
  const agents: AgentView[] = [{ ...fixtureAgents[0]!, paneId: "w1:p1", agent: "claude", hasSession: true }];
  const { result } = renderHook(() => useHomeActivity(agents));
  await waitFor(() => expect(result.current.get("w1:p1")).toEqual(fixture.list));
  const first = result.current;
  act(() => live.send({ topic: "activity", paneId: "w1:p1" }));
  await waitFor(() => expect(reads).toBe(2));
  await act(() => new Promise((r) => setTimeout(r, 10)));
  expect(result.current).toBe(first);
  body = { ...fixture.list, truncated: !fixture.list.truncated };
  act(() => live.send({ topic: "activity", paneId: "w1:p1" }));
  await waitFor(() => expect(result.current).not.toBe(first));
  live.stop();
});
