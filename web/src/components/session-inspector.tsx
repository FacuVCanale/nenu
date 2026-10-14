import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react";
import { PanelRightOpen } from "lucide-react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { isLocked } from "@/lib/idle";
import type { HomeData } from "@/lib/loaders";
import type { ProjectThreadView, ThreadPullRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

// The panel is its own chunk: a phone never loads it, a desk on first open.
const SessionPanel = lazy(() => import("./inspector-panels"));

export type InspectorTab = "changes" | "files" | "artifacts";
/** What the panel shows: one of the session's tabs, or the project behind ⋯. */
export type InspectorView = InspectorTab | "project";

export const INSPECTOR_TABS: readonly InspectorTab[] = ["changes", "files", "artifacts"];

/** The breakpoint where the workbench shows its sidebar; the panel exists only from there. */
const DESK = "(min-width: 1024px)";
const STORE_KEY = "nenu:session-panel:v1";
export const PANEL_WIDTH = { min: 320, initial: 460, max: 760, step: 16 } as const;

interface Stored { open: boolean; width: number; tab: InspectorTab }
const INITIAL: Stored = { open: true, width: PANEL_WIDTH.initial, tab: "changes" };
export const clampWidth = (width: number) => Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)));

function readStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<Stored> | null;
    return {
      open: typeof raw?.open === "boolean" ? raw.open : INITIAL.open,
      width: typeof raw?.width === "number" ? clampWidth(raw.width) : INITIAL.width,
      tab: INSPECTOR_TABS.includes(raw?.tab as InspectorTab) ? raw!.tab! : INITIAL.tab,
    };
  } catch {
    return INITIAL;
  }
}

function writeStored(value: Stored) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // A blocked store only forgets the choice.
  }
}

export interface SessionInspectorState {
  /** Wide enough for the panel; below this nothing of it renders and its shortcut does nothing. */
  desk: boolean;
  open: boolean;
  width: number;
  view: InspectorView;
  /** The session tab last picked, which ⋯ hands back to. */
  tab: InspectorTab;
  setOpen: (open: boolean) => void;
  setView: (view: InspectorView) => void;
  setWidth: (width: number) => void;
  /** Whichever of the two toggles is on screen, so a press hands focus to its counterpart. */
  toggleRef: React.RefObject<HTMLButtonElement | null>;
}

/**
 * The desk's session panel: open or folded, its width and its tab, kept per device. ⌘⌥B (Ctrl+Alt+B
 * elsewhere) folds it. Owned by the pane route, so a switch between sessions keeps it as it was.
 */
export function useSessionInspector(): SessionInspectorState {
  const desk = useMediaQuery(DESK);
  const [stored, setStored] = useState(readStored);
  const [project, setProject] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const pressed = useRef(false);
  const update = (patch: Partial<Stored>) => setStored((current) => {
    const next = { ...current, ...patch };
    writeStored(next);
    return next;
  });
  const setOpen = (open: boolean) => {
    pressed.current = true;
    update({ open });
  };

  useEffect(() => {
    if (pressed.current) toggleRef.current?.focus({ preventScroll: true });
    pressed.current = false;
  }, [stored.open]);

  const latest = useRef({ desk, open: stored.open, setOpen });
  latest.current = { desk, open: stored.open, setOpen };
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      // `code`, not `key`: Option+B types "∫" on a Mac.
      if (event.defaultPrevented || event.shiftKey || !event.altKey || !(event.metaKey || event.ctrlKey) || event.code !== "KeyB") return;
      if (!latest.current.desk || isLocked()) return;
      event.preventDefault();
      latest.current.setOpen(!latest.current.open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return {
    desk,
    open: stored.open,
    width: stored.width,
    view: project ? "project" : stored.tab,
    tab: stored.tab,
    setOpen,
    setView: (view) => {
      setProject(view === "project");
      if (view !== "project") update({ tab: view });
    },
    setWidth: (width) => update({ width: clampWidth(width) }),
    toggleRef,
  };
}

/** A session's pull request as the panel's Changes shows it, from GitHub or from Organizations. */
export interface SessionPr {
  number?: number;
  title: string;
  url?: string;
  head?: string;
  base?: string;
  state?: ThreadPullRequest["state"];
  review?: ThreadPullRequest["review"];
  checks?: ThreadPullRequest["checks"];
  diff?: { additions: number; deletions: number };
}

/** The PR of the branch a pane's folder is on (GitHub), else the one its thread carries (Organizations). */
export function sessionPr(data: Pick<HomeData, "pullRequests">, paneId: string, thread?: ProjectThreadView): SessionPr | undefined {
  const repo = data.pullRequests?.find((pr) => pr.paneIds.includes(paneId));
  const pr = thread?.pr;
  // Organizations' ticker reads checks and review GitHub's list may leave out.
  if (repo) return { number: repo.number, title: repo.title, url: repo.url, head: repo.branch, base: repo.base, state: repo.draft ? "draft" : "open",
    review: repo.review ?? pr?.review, checks: repo.checks ?? pr?.checks, diff: repo.diff };
  return pr && { number: pr.number, title: thread.title, url: pr.url, head: thread.branch || undefined, state: pr.state, review: pr.review, checks: pr.checks, diff: pr.diff };
}

export const ICON_BUTTON = "flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground active:bg-muted aria-pressed:bg-accent aria-pressed:text-foreground";

/** The chat header's way back to a folded panel, with the PR's size when Nenu already knows it. */
export function InspectorToggle({ inspector, pr }: { inspector: SessionInspectorState; pr?: SessionPr }) {
  return (
    <button ref={inspector.toggleRef} type="button" aria-label="Show session panel" title="Show session panel (⌘⌥B)" onClick={() => inspector.setOpen(true)}
      className={cn(ICON_BUTTON, pr?.diff && "w-auto gap-1.5 px-2 text-xs")}>
      <PanelRightOpen aria-hidden className="size-4" />
      {pr?.diff && <span className="font-mono tabular-nums">
        <span className="text-status-done">+{pr.diff.additions}</span> <span className="text-status-blocked">−{pr.diff.deletions}</span>
      </span>}
    </button>
  );
}

/**
 * A session's panel on a desk, right of its chat (inspector-panels.tsx). Until its chunk lands it
 * holds its width empty, so the chat does not jump.
 */
export function SessionInspector(props: ComponentProps<typeof SessionPanel>) {
  return (
    <Suspense fallback={<div aria-hidden className="session-panel" style={{ width: props.inspector.width }} />}>
      <SessionPanel {...props} />
    </Suspense>
  );
}
