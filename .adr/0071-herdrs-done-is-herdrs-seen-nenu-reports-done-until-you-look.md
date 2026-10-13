# 0071. Herdr's `done` is Herdr's seen; Nenu reports `done` only until you look in Nenu

- **Status:** Accepted (2026-10-14). Lands with 1.0.2. Amends [ADR 0003](./0003-one-shared-seen.md) in
  what the snapshot reports; the ledger it describes is unchanged.
- **Trail:** `bridge/activity.ts` (`shownStatus`) · `bridge/routes/snapshot.ts` ·
  `bridge/activity.test.ts`

## Context

Herdr keeps its own seen state. Its agent guide (`herdr --skill`, Herdr 0.9.3) says: "`idle` and
`done` both mean the agent is ready for input. The CLI/API uses the server's seen state to
distinguish them; explicit focus commands mark the target seen, while reads do not."

Nenu only reads. A session the operator opened from the phone stayed `done` until someone focused it
at the desk, and every list (Home, the drawer's Recent, the workspace tree, a project's threads)
drew `done` as a green dot. Nenu's own ledger had recorded the visit, so "New" was gone, but the green
dot stayed: the operator read it as "Nenu doesn't mark it read". Measured on the live install: three
sessions opened in Nenu still reported `done`.

## Decision

The snapshot reports `done` only while Nenu's ledger says the pane finished after the last look in
Nenu (`activeAt > seenAt`); otherwise it reports `idle`. A project's threads and coordinator get the
same status. The state engine, the notifications and the ledger keep Herdr's raw status.

## Consequences

- Every surface agrees with "New": green means finished and not yet seen in Nenu. Nenu no longer
  mirrors the desk's Done badge.
- Rejected: drawing Herdr's raw `done`, which keeps the bug; and having Nenu send a focus to clear
  Herdr's seen, which moves the desk's focus, and ADR 0003 already makes Nenu's seen its own.
