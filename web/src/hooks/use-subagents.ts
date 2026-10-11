import { useEffect, useRef, useState } from "react";

import { fetchSubagents, isApiErrorStatus } from "@/lib/api";
import { concerns } from "@/lib/live-events";
import type { SubagentsResponse, SubagentView } from "@/lib/types";
import { useLivePoll } from "./use-live-poll";

/** A subagent opened in place of the main conversation, tied to the parent session it came from. */
export type SubagentSelection = { agent: SubagentView; parentKey: string };

/** Fallback poll: brisk while the list is on screen, relaxed otherwise. */
export const SUBAGENTS_POLL_MS = { open: 3_000, closed: 12_000 } as const;

export interface SubagentsState {
  list: SubagentsResponse | null;
  /** The last refresh failed; `list` is what was last known. */
  stale: boolean;
  refresh: () => void;
}

/**
 * The subagents of the session in `paneId`. Pauses behind the idle cover and while the page is
 * hidden, wakes when the pane's journal changes, and keeps a fallback poll (ADR 0054). Access
 * revoked (401/403) drops the list. `onLost` hears when the pane's conversation changed or
 * the selected agent left the list, so a caller can close what it opened from the old one.
 */
export function useSubagents({ paneId, session, enabled, open = false, selected = null, onLost }: {
  paneId: string;
  session?: string;
  enabled: boolean;
  open?: boolean;
  selected?: SubagentSelection | null;
  /** The selected subagent no longer belongs to what the pane shows. */
  onLost?: () => void;
}): SubagentsState {
  const [list, setList] = useState<SubagentsResponse | null>(null);
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);
  const scope = JSON.stringify([paneId, session]);
  const loadedKey = useRef<string | null>(null);
  const latest = useRef({ selected, onLost });
  latest.current = { selected, onLost };

  useEffect(() => {
    setList(null);
    setStale(false);
    loadedKey.current = null;
  }, [scope]);

  useLivePoll<SubagentsResponse>({
    enabled,
    deps: [scope, tick],
    read: async (signal) => {
      try {
        return await fetchSubagents(paneId, session, signal);
      } catch (failure) {
        if (isApiErrorStatus(failure, 401) || isApiErrorStatus(failure, 403)) {
          setList(null);
          if (latest.current.selected) latest.current.onLost?.();
        }
        throw failure;
      }
    },
    onRead: (next) => {
      setList(next);
      setStale(false);
      const key = next.available ? next.sessionKey : null;
      const changed = loadedKey.current !== null && loadedKey.current !== key;
      loadedKey.current = key;
      const chosen = latest.current.selected;
      if (chosen && (changed || !next.available || !next.agents.some((entry) => entry.id === chosen.agent.id))) latest.current.onLost?.();
    },
    onFail: () => setStale(true),
    delay: () => (open ? SUBAGENTS_POLL_MS.open : SUBAGENTS_POLL_MS.closed),
    wakes: (event) => concerns(event, "journal", paneId),
  });

  return { list, stale, refresh: () => setTick((n) => n + 1) };
}
