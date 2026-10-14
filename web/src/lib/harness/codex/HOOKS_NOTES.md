# Codex hooks review — keystroke recipe

Captured 2026-10-14 on Codex 0.162.1 (`fixtures/hooks-review-v0162.txt`): the first screen when the
operator's Codex hooks (`hooks.json`, `[features] hooks = true`) are new or changed since they were
last trusted. Probed in a disposable Herdr 0.9.3 with a temporary `CODEX_HOME` holding three test
hooks (`SessionStart`, `UserPromptSubmit`, `Stop`, each running `true`).

```
  Hooks need review
  3 hooks are new or changed.
  Hooks can run outside the sandbox after you trust them.

› 1. Review hooks
  2. Trust all and continue
  3. Continue without trusting (hooks won't run)

  enter confirm · esc skip
```

Herdr status: `unknown`. Its Codex detection manifest (2026.10.11.1) has rules for the folder-trust
prompt and the update dialog, none for this screen. The bridge therefore reads `unknown` agent panes
too, and the snapshot shows `blocked` while it holds a card for one.

| Key | Effect |
|---|---|
| `2` | Moved the pointer to row 2. Nothing confirmed. Digits only move the pointer here. |
| `Enter` on row 2 | Trusted all three hooks (`[hooks.state."…:session_start:0:0"] trusted_hash = …` and the other two written to `config.toml`) and opened the composer. Herdr: `idle`. |
| `Down`, `Down`, `Enter` | Continued without trusting: composer open, no `hooks.state` written. Herdr: `idle`. |
| `Escape` | Same as row 3: composer open, nothing trusted. |
| `Enter` on row 1 | Opened the hooks manager: a table of events with `Installed`/`Active`/`Review` counts, footer `t trust all · enter review · esc close`. `Escape` there closed it into the composer, nothing trusted. |

What the adapter emits: each row is the arrow walk from the `›` pointer, then the `Enter` the footer
names (`Review hooks` → `Enter`, `Trust all and continue` → `Down, Enter`, `Continue without trusting`
→ `Down, Down, Enter` with the pointer on row 1). No digit is sent. Only the exact captured layout
reads: the three labels in order, one pointer, the footer as the last row and the heading above.
The hooks manager table is not lifted; it stays a terminal screen.
