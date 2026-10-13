# 0069. What the bridge copies from a Herdr map comes out in a fixed order

- **Status:** Accepted (2026-10-13). Lands with 1.0.1.
- **Trail:** `bridge/state-engine.ts` (`allowedTokens`) · `bridge/state-engine.test.ts` ·
  `bridge/routes/snapshot.ts` (the ETag) · `bridge/live-events.ts` · `bridge/event-poker.ts`

## Context

The bridge decides that something changed by comparing JSON: the snapshot's ETag hashes the view,
the live `pane` and `journal` events fire when a pane's serialized state differs from the last read,
and the poker keys a pane on the same text. Herdr does not promise an order for the keys of a map,
and it returns a pane's `tokens` in a different order from one read to the next.

`allowedTokens` copied the allowed tokens in the order they arrived. Measured on 1.0.0 against a live
herd of 17 panes: 10 polls of the same unchanged herd produced 45 changes that were not there; with no
client open the bridge published about 130 `pane`/`journal` events a minute instead of about 10; and
no snapshot request could ever be answered 304, because the ETag moved on every read.

## Decision

Anything the bridge copies out of a Herdr map is emitted in a canonical order, its allowlist's,
never in the order Herdr sent it. A new field copied from Herdr gets the same treatment before any
JSON comparison sees it.

## Consequences

- Change detection compares what Herdr means, not how it ordered it. The snapshot answers 304 when
  the herd is unchanged, and the client keeps the herd object it already holds.
- Closes the option of comparing `JSON.stringify` of Herdr's payload as it arrived, which looks
  equivalent and is not.
- Revisit only if Herdr documents a stable key order for every map it returns.
