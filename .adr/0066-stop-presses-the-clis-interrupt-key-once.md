# 0066. Stop presses the CLI's interrupt key once, and only on a running turn

- **Status:** Accepted (2026-10-11). Fran asked for it ("I can't cancel the turn"); the probes below
  set the keys and the guards.
- **Extends:** [ADR 0056](./0056-queued-messages-follow-each-clis-native-queue.md), whose queue a Stop
  holds, and [ADR 0057](./0057-the-bridge-reads-and-answers-dialogs-through-the-screen.md): the screen is
  still the only actuator.
- **Trail:** `web/src/lib/harness/types.ts` (`TurnInterrupt`) · `harness/claude/chrome.ts`
  (`readClaudeTurn`) · `harness/codex/interrupt.ts` · `bridge/interrupt.ts` · `bridge/routes/reply.ts`
  (`interruptPane`) · `bridge/message-queue.ts` (`hold`) · `web/src/components/composer.tsx` ·
  `web/src/lib/grammar/PROBES_2026_10_NOTES.md` (section "Stop")

## Context

Nenu could stop a Codex turn and nothing else. Claude, the CLI most panes run, had no way to cancel a
turn from the phone. Measured on 2026-10-11 in a disposable Herdr 0.9.3 session:

| | Claude Code 2.1.296 | Codex 0.162.1 |
| --- | --- | --- |
| Escape while a turn runs | Stops it (tool call or streamed text), pane idle in ~300 ms | Stops it, pane `done` in ~300 to 600 ms; a running command survives as a background terminal |
| A second Escape at the idle screen | Opens Rewind | Opens "Browsing transcript … rewind" |
| Escape with a message in the CLI's own queue | Stops, then **sends** the queued message as a new turn | Puts the queued follow-up **back in the composer** as a draft |
| Escape with a pending steer (0.160.1, ADR 0056) | n/a | Stops, then sends the steer |
| Escape with a draft typed at the terminal | Stops and keeps the draft, but the statusline drops "esc to interrupt" while the draft is there | not probed |

The Escape that stops a turn does not count as the first of the double press (Escape, Escape 300 ms
and 700 ms apart on a running Claude stopped it and opened nothing). Two Escapes at an idle screen
do. So the danger is not the stop itself but any Escape that reaches an idle CLI: a stale tap, a
double tap that lands after the repaint, or two devices.

Ctrl+C was the other candidate. At an idle Codex or Claude prompt it arms "press again to quit", so a
late or doubled Ctrl+C can close the CLI. Escape stops both CLIs and its worst case is a menu.

## Decision

1. **The adapter owns the key and the reading.** `HarnessAdapter.interrupt` holds the measured key and
   reads one screen into `running` (the CLI paints its own interrupt hint) and `queued` (what the key
   does to the CLI's own queue). An agent without it gets no Stop. Today that is Claude and Codex;
   pi, OpenCode and the others stay without one until their key is measured.
2. **The bridge presses once, and only on a running turn.** It re-reads the screen inside the pane's
   write lock and presses only while `running` holds. After a press the pane is in a two-second
   cooldown: any Stop in it answers `pressed: false` and sends nothing. A Stop tapped right after Send
   waits up to four seconds for the turn to show, outside the lock, so it never blocks the queue that
   is typing that message.
3. **Claude's hint, not Herdr's status, says a turn runs.** Herdr's `working` can lag the screen and
   does not say whether Escape would land on a turn. When a terminal draft hides Claude's hint, Stop
   is refused with that reason; it does not guess.
4. **The CLI's own queue keeps the CLI's semantics.** When Escape would send what the CLI's queue
   holds (Claude's queue, a Codex steer), the first tap answers `confirm_required` and the composer
   asks "Really stop?". Nenu does not recall the queue first (Up, then Escape): Up on an empty queue
   recalls history instead, and the queue can drain between the read and the key.
5. **Nenu's own queue is held.** Every row of the conversation still waiting to be typed is parked
   (`held`, read as `waitingFor: "stopped"`). It is never delivered when the agent goes idle; the
   operator sends, edits or removes it. Rows queued after the Stop pass the held ones.
6. **Each press is audited** as `agent.interrupt`, sent or not.

## Consequences

The phone can stop either CLI the way Escape does at the keyboard, and a double tap, a second device
or a late tap cannot open a rewind menu through Nenu. The cost is that Stop depends on reading each
CLI's running-turn hint: a release that moves or renames it (Codex already says "Waiting for
background terminal" instead of "Working" while a command runs) turns Stop into a refusal until the
reader learns it. That failure is safe, and the probe captures under `harness/*/fixtures/interrupt-*`
are what a re-probe compares against.

A held message waits until the operator acts on it, even when they meant it to go after the turn.
That is the point of a Stop, and the row says why it waits.

Revisit if a CLI exposes a structured interrupt Nenu can call without a keystroke, or if a probe shows
a stopping Escape counting toward the double press.
