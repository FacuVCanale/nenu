import { describe, expect, test } from "bun:test";

import { AwaitingReplies } from "./awaiting-replies.ts";

// What Nenu sent an agent and has not heard back about: the one signal that a thread's next finish
// answers the operator rather than its coordinator.
describe("AwaitingReplies", () => {
  test("a message sent from Nenu is awaited until the pane's next finish takes it, once", () => {
    const awaiting = new AwaitingReplies();
    expect(awaiting.take("s", "p1")).toBe(false);
    awaiting.sent("s", "p1");
    expect(awaiting.take("s", "p2")).toBe(false);
    expect(awaiting.take("other", "p1")).toBe(false);
    expect(awaiting.take("s", "p1")).toBe(true);
    expect(awaiting.take("s", "p1")).toBe(false);
  });
});
