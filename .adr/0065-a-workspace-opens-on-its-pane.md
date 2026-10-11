# 0065. A workspace opens on its pane, not on a page

- **Status:** Accepted (2026-10-11)
- **Trail:** `web/src/lib/spaces.ts` (`workspaceEntry`) · `web/src/lib/nav.ts` (`workspacePath`) ·
  `web/src/routes/space.tsx` · `web/src/components/tab-strip.tsx` · `web/src/components/pane-strip.tsx`

## Context

Up to 0.61, tapping a workspace opened `/space/:id`: a page with the workspace's name, its folder,
its tabs and the shown tab's panes, each one tap from its chat. 0.61 redesigned that page and, to
spare a tap, opened a workspace of one pane straight onto it. The operator then reported, on
2026-10-11 with 0.61 deployed, that the page added nothing ("toco esto y no me aporta nada"), that
some workspaces showed it and others did not, and that on a desk it was a narrow column in a wide
empty pane. Everything the page offered already sat above every chat: the tab strip (switch, New
tab, rename and close) and the pane strip (switch, rename and close).

## Decision

1. **Every way into a workspace opens the same pane**, chosen by `workspaceEntry`: the agent asking
   for you (the latest to ask), else the pane you had open last, else the pane Herdr's active tab
   opens on (its first agent, else its shell), else its first pane. The sidebar, search, the rail,
   the phone's Browse and an old `/space/:id` link all go through it.
2. **A workspace's tabs and panes are navigated from the strips above its chat.** Don't add a
   workspace overview page or make a workspace pane's title open one.
3. `/space/:id` stays as a route only to resolve old links and to show a workspace with no pane as an
   empty chat that starts one.

## Consequences

A workspace behaves the same whatever it holds, and one tap reaches work instead of a list of it.
What the page showed at a glance, every pane of every tab with its state, lives in the sidebar's
workspace tree. Revisit if a workspace gains something of its own that no pane can show (Herdr
exposing workspace-wide actions such as rename or close is a candidate); give it a place in the
chat's chrome before giving it a page.
