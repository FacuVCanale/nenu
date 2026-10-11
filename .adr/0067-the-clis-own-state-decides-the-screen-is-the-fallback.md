# 0067. The CLI's own state decides whether a turn runs; the screen is the fallback

- **Status:** Accepted (2026-10-11). Amends [ADR 0066](./0066-stop-presses-the-clis-interrupt-key-once.md)
  rules 2 and 3 (what "a running turn" means). Keeps 0066's single press, cooldown, write lock, queue
  confirmation and held rows, and keeps [ADR 0057](./0057-the-bridge-reads-and-answers-dialogs-through-the-screen.md):
  the screen still chooses the keys that answer a dialog.
- **Trail:** `bridge/agent-state.ts` · `bridge/agent-state-sources.ts` · `bridge/interrupt.ts` ·
  `bridge/routes/reply.ts` (`interruptPane`) · `bridge/routes/snapshot.ts` (`turn`) ·
  `bridge/queue-readiness.ts` · `bridge/interactions.ts` (`waiting`) · `web/src/lib/turn.ts` ·
  `bridge/test-support/agent-state/` (real files) · `scripts/e2e/run.ts` (`stop-state`)

## Context

Stop refused to stop Claude for any operator with a custom `statusLine`. ADR 0066 made Claude's
"esc to interrupt" hint the proof that a turn runs, and Claude drops that hint whenever a custom
statusline is set (documented, https://code.claude.com/docs/en/statusline). The button showed because
Herdr said `working`; the press was refused because the screen said nothing. Two sources, two answers.

Both CLIs already record their real state on disk (measured 2026-10-11 in a disposable Herdr 0.9.3,
Claude Code 2.1.296, Codex 0.162.1):

| | Claude | Codex |
| --- | --- | --- |
| Source | `~/.claude/sessions/<pid>.json`: `status` = `idle`, `busy`, `waiting` (+ `waitingFor`), `shell`; `statusUpdatedAt` | Rollout JSONL: `task_started` / `task_complete` / `turn_aborted` with a `turn_id` |
| Latency | busy 8-28 ms after Enter, idle 3-12 ms after the turn ends or Escape | `task_started` 14-68 ms after Enter, `turn_aborted` 35-148 ms after Escape |
| Pane mapping | `pane.process_info` pid → `<pid>.json`, `procStart` checked against the process | `pane.process_info` pid → the rollout it holds open (newest UUIDv7 after `/new`) |
| Traps | `busy` stays on while a background agent or workflow runs after the main turn ended, and Escape then does nothing | The "Working (esc to interrupt)" row vanishes for 1-3 s while the answer streams, yet Escape still interrupts |

Hooks were considered as the source and rejected as the authority: no hook fires when the operator
presses Escape (measured, Claude), Codex's `PermissionRequest` does not run under
`approval_policy = "never"`, and hooks only exist for sessions opened after an install that touches the
operator's settings. They stay observers that make the bridge re-read the files sooner.

## Decision

1. **One structured state per Claude or Codex pane, kept by the bridge** (`AgentStates`). Claude's is
   its session file, plus its transcript while busy: a busy session whose transcript ended a turn
   inside this busy spell, and has not moved since, is background work, not a turn. Codex's is the
   open turn in its rollout. Files are watched, never polled. Unknown shapes (a missing `status`, a new
   status word, an unknown kind) decode to nothing, which is the fallback.
2. **The real state wins; the screen is the fallback** only for a pane no structured source knows
   (no session file, no rollout yet, another agent).
3. **Stop's button and Stop's press read the same entry.** The snapshot carries it as `turn`; the press
   re-reads the same files inside the pane's write lock. Escape goes out only on `running`. A dialog
   (`waiting`) is refused at once; background work alone is refused, because Escape does not reach it.
   After the press, the state confirms the stop (idle, an interruption row, `turn_aborted`).
4. **What still reads the screen, and why.** The keys that answer a dialog (no protocol answers a TUI
   that is already open); whether the input box is on screen and holds a draft before typing; Codex's
   steer and follow-up queue (it lives only in Codex's memory, no file records it); trust prompts.
   Claude's own queue comes from its `queue-operation` rows.
5. **Hooks are optional.** Nenu works fully without them; installed, a delivery only triggers a re-read.

## Consequences

Stop works with any statusline, in every theme and width, and the button no longer appears for a turn
that is not there (background-only Claude) or disappears while Codex streams its answer. The cost is
a dependence on undocumented file formats: `status`/`waitingFor` and the rollout event names can change
in a release. That failure is safe by construction (an unknown shape is the screen fallback), and the
real files under `bridge/test-support/agent-state/` are what a re-probe compares against.

Revisit if a CLI exposes a documented local state or interrupt API, or if a probe shows the session
file reporting `busy` while a dialog owns the keyboard.
