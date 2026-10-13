// What Nenu sent an agent and has not heard back about. A thread's typed turns usually come from its
// coordinator, so only this tells the bridge that a thread's next finish answers the operator. Kept
// in memory: a bridge restart forgets a pending reply, which costs at most one missed notification.

export class AwaitingReplies {
  private readonly pending = new Set<string>();

  /** The operator sent this pane a message from Nenu. */
  sent(session: string, paneId: string): void {
    this.pending.add(`${session}\u0000${paneId}`);
  }

  /** Whether this pane's finish answers a message Nenu sent; answers true once per message. */
  take(session: string, paneId: string): boolean {
    return this.pending.delete(`${session}\u0000${paneId}`);
  }
}
