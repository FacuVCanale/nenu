# 0070. Each agent gets its own notification

- **Status:** Accepted (2026-10-13). Lands with 1.0.2.
- **Trail:** `bridge/notifications.ts` (`NotificationCoordinator`, `makeNotifySink`, `notice`) ·
  `bridge/push.ts` (`agentTopic`) · `bridge/notifications.test.ts` · `bridge/push.test.ts`

## Context

Since the first push support, a session's whole herd shared one notification slot (`collie:herd`)
and one push collapse topic (`collie-herd`). The coordinator rendered a single summary: the named
agent while one was outstanding, then "N agents finished" or "N agents need you" once a second
arrived. Each new alert re-rendered that slot.

With 16 agents, the operator reported that the phone kept buzzing a count that named nobody: the
first agent's notification said who finished and what it answered, and the second agent's arrival
replaced it with "2 agents finished". The fixed collapse topic also meant a phone coming back online
received only the last message of the whole herd.

## Decision

1. Every agent's alert is its own notification, tagged `collie:herd:<paneId>`, with its own title
   (who and what), body (its answer's first line and where it runs) and deep link.
2. Resolving an agent closes its own notification only.
3. Each agent's pushes use their own collapse topic, a 16-character hash of the tag, so a
   reconnecting phone receives the latest alert of every agent.

## Consequences

- Several agents finishing together show as several notifications; iOS and Android group them by
  app. The kinds and switches in Settings (Needs input, Agents finish, Threads finish, Coordinators
  answer, Subagent results) decide how many arrive.
- Closes the option of coalescing the herd into one digest notification, which reads as fewer
  buzzes and loses who each one was about.
- A notification shown before 1.0.2 on the shared `collie:herd` tag is not closed by the new clears;
  swiping it away once is enough.
