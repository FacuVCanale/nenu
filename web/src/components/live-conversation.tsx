import { type ReactNode, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, MessageSquare } from "lucide-react";

import { WorkActivityLabel } from "@/components/work-activity-label";
import { TranscriptView } from "@/components/transcript-view";
import { fetchHistory } from "@/lib/api";
import type { AgentStatus, PaneHistoryResponse } from "@/lib/types";
import { matchingEntries } from "@/lib/transcript-search";
import { PendingTurns } from "@/components/pending-turns";
import { atTail, useEditShift } from "@/hooks/use-auto-scroll";
import { TURN_PENDING_MS } from "@/hooks/use-stop-turn";
import { localSendScope, reconcileLocalSends, useLocalSendActions, useLocalSends } from "@/lib/local-sends";

interface LiveConversationProps {
  paneId: string;
  session?: string;
  activityStatus?: AgentStatus;
  history: PaneHistoryResponse | null;
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
  recovery?: ReactNode;
  /** Change after a successful send to release the reading window and follow the latest turn. */
  followKey?: number;
  historyRequest?: number;
  searching?: boolean;
  query?: string;
  currentMatch?: number;
  onMatchCount?: (count: number) => void;
  /** Rendered after the newest turn, inside the scroller (a coordinator's thread cards, the question card). */
  footer?: ReactNode;
  /** A question waits at the tail: the way back to it says so. */
  waiting?: boolean;
}

type AvailableHistory = Extract<PaneHistoryResponse, { available: true }>;
const OLDER_PAGE_SIZE = 120;
/** How close to the top, in px, a reader moving up gets before the next older page starts loading. */
const OLDER_PAGE_MARGIN = 800;
/** Room kept above a `[data-follow-stop]` element when following lands on it. */
const STOP_MARGIN = 12;

/**
 * Where following stops for a question at the tail taller than the list: its first line. Null when
 * there is none or it fits, so the bottom is the stop.
 */
function stopCap(el: HTMLElement): number | null {
  const stop = el.querySelector<HTMLElement>("[data-follow-stop]");
  if (!stop) return null;
  const cap = el.scrollTop + stop.getBoundingClientRect().top - el.getBoundingClientRect().top - STOP_MARGIN;
  return cap < el.scrollHeight - el.clientHeight ? cap : null;
}

/** The operator is typing in a box inside the question (a reply, a note). */
function typingIn(el: HTMLElement): boolean {
  const active = document.activeElement;
  return (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) && Boolean(active.closest("[data-follow-stop]")) && el.contains(active);
}
const UNAVAILABLE_COPY = {
  disabled: "Conversation history is disabled on this bridge.",
  "no-session": "Send the first message to start the conversation, or connect an existing session.",
  "no-log": "Waiting for the first conversation entry…",
};

/** Scope pagination to a pane/session without remounting the surrounding live composer. */
export const LiveConversation = memo(function LiveConversation(props: LiveConversationProps) {
  return <ScopedConversation key={JSON.stringify([props.paneId, props.session, props.history?.available ? props.history.sessionKey : null])} {...props} />;
});

/** Journal prose and tool calls; older pages stay inside this live, writable pane route. */
function ScopedConversation({ paneId, session, activityStatus, history, loading, error, onRetry, recovery, followKey, historyRequest = 0, searching = false, query = "", currentMatch = 0, onMatchCount, footer, waiting = false }: LiveConversationProps) {
  const [frozen, setFrozen] = useState<PaneHistoryResponse | null>(null);
  const [paused, setPaused] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [olderStopped, setOlderStopped] = useState(false);
  const request = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  // Where the list last stood, set by every pin: only a move up from here is the reader leaving the
  // tail (see useAutoScroll for why geometry alone can't tell).
  const lastTop = useRef(0);
  // The last pin landed on a question's first line, so a shift above it should carry the view along.
  const onCap = useRef(false);
  const restoring = useRef(false);
  const restoreFrame = useRef<number | null>(null);
  // The list's height just before an older page goes in above the reader. Restoring adds only the
  // growth to wherever the list stands by then: a reader still scrolling keeps moving from there.
  const anchorHeight = useRef<number | null>(null);
  const editShift = useEditShift(scrollRef);
  const shown = frozen ?? history;
  const entries = shown?.available ? shown.entries : [];
  const latest = history?.available ? history.entries.at(-1) : undefined;
  const lastShown = entries.at(-1);
  const hasNew = frozen !== null && history?.available && (
    latest?.uuid !== lastShown?.uuid || latest?.turn?.status !== lastShown?.turn?.status ||
    latest?.turn?.durationMs !== lastShown?.turn?.durationMs
  );
  const matches = useMemo(() => matchingEntries(entries, query), [entries, query]);
  // This client's sends the journal has not caught up with yet. Reconciled against the LIVE window,
  // not a frozen one, so scrolling back to read never holds a delivered bubble on screen.
  const sendScope = localSendScope(paneId, session);
  const localSends = useLocalSends(sendScope);
  const localSendActions = useLocalSendActions(sendScope);
  const liveEntries = history?.available ? history.entries : null;
  useEffect(() => {
    if (liveEntries) reconcileLocalSends(sendScope, liveEntries);
  }, [sendScope, liveEntries, localSends]);
  // A new bubble is the operator's own action: bring the tail into view even if they had scrolled up.
  const localSendCount = localSends.length;
  // A message the agent received starts its turn, as Stop already counts it in the composer: Working…
  // shows at once and holds until the agent's state has reported the turn and then its end. The
  // journal row and that state arrive on separate reads, in either order. Gives up like Stop does if
  // nothing ever reports the turn.
  const handed = localSends.at(-1);
  const delivered = handed?.state === "sent" && !handed.native && !handed.unverified ? handed.id : null;
  const [starting, setStarting] = useState<{ id: string; ran: boolean } | null>(null);
  useEffect(() => {
    if (delivered) setStarting((current) => current?.id === delivered ? current : { id: delivered, ran: false });
  }, [delivered]);
  useEffect(() => {
    if (!starting) return;
    if (activityStatus === "working") {
      if (!starting.ran) setStarting({ ...starting, ran: true });
      return;
    }
    if (starting.ran) {
      setStarting(null);
      return;
    }
    const timer = setTimeout(() => setStarting(null), TURN_PENDING_MS);
    return () => clearTimeout(timer);
  }, [starting, activityStatus]);
  const activity = error || frozen ? undefined : starting ? "working" : activityStatus;
  // Under this client's bubble while the journal does not show it yet; the transcript's own after that.
  const labelUnderSend = activity === "working" && delivered !== null;
  const startingLabel = labelUnderSend && <div className="mt-3 px-0.5 py-1" role="status"><WorkActivityLabel /></div>;
  const previousSendCount = useRef(localSendCount);
  useEffect(() => { onMatchCount?.(matches.length); }, [matches.length, onMatchCount]);
  useEffect(() => {
    if (searching) {
      following.current = false;
      setPaused(true);
      setFrozen((current) => current ?? history);
    }
  }, [searching, history]);
  useEffect(() => {
    const uuid = entries[matches[currentMatch] ?? -1]?.uuid;
    if (!searching || !uuid) return;
    const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-turn]") ?? [])
      .find((element) => element.dataset.turn === uuid);
    target?.scrollIntoView({ block: "center" });
  }, [searching, currentMatch, matches, entries]);

  const cancelOlder = useCallback(() => {
    request.current?.abort();
    request.current = null;
  }, []);

  // Following lands on the newest line, except that a question at the tail taller than the list is
  // read from its first line: the view never passes that line, and a reader already further down
  // inside the question stays where they are. While the operator types in the question (its reply
  // box sits at its foot) the bottom wins again, so the phone keyboard never hides the box.
  const pin = useCallback((el: HTMLElement) => {
    const bottom = el.scrollHeight - el.clientHeight;
    const cap = typingIn(el) ? null : stopCap(el);
    const top = cap === null ? bottom : onCap.current ? cap : Math.max(cap, Math.min(el.scrollTop, bottom));
    el.scrollTo({ top, behavior: "auto" });
    onCap.current = cap !== null && top === cap;
    lastTop.current = el.scrollTop;
  }, []);

  const followLatest = useCallback(() => {
    cancelOlder();
    anchorHeight.current = null;
    following.current = true;
    setPaused(false);
    setFrozen(null);
    setLoadingOlder(false);
    setOlderError(false);
    setOlderStopped(false);
    const el = scrollRef.current;
    if (el) pin(el);
  }, [cancelOlder, pin]);

  useEffect(() => {
    if (localSendCount > previousSendCount.current) followLatest();
    previousSendCount.current = localSendCount;
  }, [localSendCount, followLatest]);

  // Also runs when a successful send occurs during an outstanding history request.
  useLayoutEffect(() => {
    followLatest();
  }, [followKey, followLatest]);

  useEffect(() => {
    if (historyRequest === 0) return;
    following.current = false;
    setPaused(true);
    setFrozen((current) => current ?? history);
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    // The toolbar enters the same older-message flow; the composer and route stay mounted.
    void loadOlder();
  }, [historyRequest]);

  useEffect(() => () => {
    cancelOlder();
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
  }, [cancelOlder]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (anchorHeight.current !== null) {
      const before = anchorHeight.current;
      anchorHeight.current = null;
      restoring.current = true;
      el.scrollTop += el.scrollHeight - before;
      if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
      restoreFrame.current = requestAnimationFrame(() => { restoring.current = false; });
    } else if (following.current) {
      pin(el);
    }
  }, [entries, pin]);

  // Follow viewport/content resizing (including the mobile keyboard) only while at the live tail.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (following.current) pin(el);
    });
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, [pin]);

  const onWorkToggle = useCallback((target: HTMLElement) => {
    const el = scrollRef.current;
    if (!el) return;
    const before = target.getBoundingClientRect().top;
    following.current = false;
    setPaused(true);
    setFrozen((current) => current ?? history);
    restoring.current = true;
    if (restoreFrame.current !== null) cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      if (target.isConnected) el.scrollTop += target.getBoundingClientRect().top - before;
      restoring.current = false;
      restoreFrame.current = null;
    });
  }, [history]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const up = el.scrollTop < lastTop.current;
    // Our own pins leave scrollTop where they put it; any other move is the reader's.
    if (Math.abs(el.scrollTop - lastTop.current) >= 1) onCap.current = false;
    lastTop.current = el.scrollTop;
    if (restoring.current) return;
    // Reading inside a question at the tail is being at the tail: its foot may be far below.
    const cap = stopCap(el);
    if (atTail(el) || (cap !== null && el.scrollTop >= cap - 1)) {
      if (!following.current) followLatest();
    } else if (up && !(following.current && editShift())) {
      following.current = false;
      setPaused(true);
      setFrozen((current) => current ?? history);
      // Heading for the top: fetch the next page before the reader gets there. Not after a failure
      // (Retry asks again) nor during find (a page landing would shift its matches).
      if (el.scrollTop < OLDER_PAGE_MARGIN && !olderError && !searching) void loadOlder();
    } else if (following.current) {
      pin(el);
    }
  }

  async function loadOlder() {
    if (request.current || olderStopped || !shown?.available || !shown.hasMore) return;
    const before = shown.entries[0]?.uuid;
    if (!before) return;
    const base: AvailableHistory = shown;
    const controller = new AbortController();
    request.current = controller;
    following.current = false;
    setPaused(true);
    setFrozen(base);
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await fetchHistory(paneId, { limit: OLDER_PAGE_SIZE, before }, session, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      if (page.paneId !== paneId) throw new Error("History response belongs to another pane");
      if (!page.available) {
        setOlderStopped(true);
        return;
      }
      const seen = new Set(base.entries.map((entry) => entry.uuid));
      const older = page.entries.filter((entry) => {
        if (seen.has(entry.uuid)) return false;
        seen.add(entry.uuid);
        return true;
      });
      // A tail-capped log or a missing cursor can return the same page. Stop at this boundary.
      if (older.length === 0) {
        setOlderStopped(true);
        return;
      }
      const el = scrollRef.current;
      anchorHeight.current = el ? el.scrollHeight : null;
      setFrozen({
        ...base,
        entries: [...older, ...base.entries],
        hasMore: page.hasMore,
        fileTruncated: base.fileTruncated || page.fileTruncated,
        total: Math.max(base.total, page.total),
      });
    } catch {
      if (request.current === controller && !controller.signal.aborted) setOlderError(true);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setLoadingOlder(false);
      }
    }
  }

  let emptyCopy = "Waiting for the first conversation entry…";
  if (loading) emptyCopy = "Loading conversation…";
  else if (shown && !shown.available) emptyCopy = UNAVAILABLE_COPY[shown.reason];
  else if (error) emptyCopy = "Your draft is safe. Retry to load the conversation.";
  const canLoadOlder = shown?.available && shown.hasMore && !olderStopped;
  const historyBoundary = olderStopped || (shown?.available && shown.fileTruncated && !shown.hasMore);

  return (
    <section aria-label="Live conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      {error && (
        <div role="status" className="flex items-center justify-between gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
          <span>{entries.length ? "Conversation refresh failed. Showing the last update." : "Couldn't load the conversation."}</span>
          {onRetry && <button type="button" onClick={onRetry} className="min-h-11 shrink-0 rounded-md px-3 font-medium hover:bg-muted">Retry</button>}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full min-w-0 overflow-y-auto overflow-x-hidden px-(--page-gutter) py-6" style={{ overflowAnchor: "none" }}>
          <div ref={contentRef} className="mx-auto w-full max-w-(--chat-column)">
            {entries.length > 0 ? <>
              {(canLoadOlder || historyBoundary || olderError) && <div className="mb-6 text-center text-xs text-muted-foreground">
                {canLoadOlder && <button type="button" disabled={loadingOlder} onClick={() => void loadOlder()} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 hover:bg-muted hover:text-foreground disabled:opacity-50">
                  {loadingOlder ? <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" /> : <ArrowUp aria-hidden="true" className="size-3" />}
                  {loadingOlder ? "Loading older messages…" : olderError ? "Retry older messages" : "Load older messages"}
                </button>}
                {olderError && <p role="status">Couldn't load older messages. Your conversation is still live.</p>}
                {historyBoundary && <p role="status">You've reached the oldest messages available from this session log.</p>}
              </div>}
              <TranscriptView entries={entries} query={query}
                focusedUuid={searching ? entries[matches[currentMatch] ?? -1]?.uuid : undefined}
                activityStatus={activity} activityLabel={!labelUnderSend} onWorkToggle={onWorkToggle} />
              <PendingTurns sends={localSends} actions={localSendActions} />
              {startingLabel}
              {footer}
            </> : localSends.length > 0 ? <><PendingTurns sends={localSends} actions={localSendActions} />{startingLabel}{footer}</> : <><div className="flex flex-col items-center gap-3 px-4 py-16 text-center text-sm text-muted-foreground">
              {loading ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> : <MessageSquare className="size-5" />}
              <p>{emptyCopy}</p>
              {shown && !shown.available && shown.reason !== "disabled" && recovery}
              {!error && activityStatus === "working" && <WorkActivityLabel />}
            </div>{footer}</>}
          </div>
        </div>
        {paused && <button type="button" onClick={followLatest} aria-label="Scroll to latest" className="absolute bottom-3 left-1/2 z-10 flex min-h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs shadow-md hover:bg-muted">
          {waiting
            ? <><span aria-hidden className="size-1.5 rounded-full bg-status-blocked" />Waiting on you<ArrowDown aria-hidden="true" className="size-4" /></>
            : <><ArrowDown aria-hidden="true" className="size-4" />{hasNew ? "New messages" : "Latest"}</>}
        </button>}
      </div>
    </section>
  );
}
