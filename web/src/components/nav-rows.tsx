import type { ReactNode } from "react";
import { Terminal } from "lucide-react";

import { StatusDot } from "@/components/status-badge";
import type { DisplayPlace } from "@/lib/display-name";
import { matchRange } from "@/lib/nav-search";
import { TITLE_SEP } from "@/lib/pane-name";
import type { AgentView } from "@/lib/types";

// The parts every list of chats in the navigation shares (the tree, search, Needs you, Recent and
// the pane switcher), so a pane reads the same wherever it is listed: a mark, its name, where it lives.

/** The two-line row: a mark, the name, the line under it, and what sits at the end. */
export function RowBody({ mark, title, detail, end }: { mark: ReactNode; title: ReactNode; detail?: ReactNode; end?: ReactNode }) {
  return <>
    <span className="nav-pane-mark">{mark}</span>
    <span className="nav-pane-text">
      <span className="nav-pane-title">{title}</span>
      {detail && <span className="nav-pane-detail">{detail}</span>}
    </span>
    {end}
  </>;
}

/** A pane's state dot, or the terminal glyph for a shell, which has no agent state. */
export function PaneMark({ pane }: { pane: Pick<AgentView, "kind" | "status"> }) {
  return pane.kind === "shell" ? <Terminal aria-hidden size={14} /> : <StatusDot status={pane.status} surface="bg-transparent" className="size-2" />;
}

/** `text` with the part matching `query` in semibold. */
export function Highlight({ text, query = "" }: { text: string; query?: string }) {
  const range = matchRange(text, query);
  if (!range) return text;
  const [start, end] = range;
  return <>{text.slice(0, start)}<mark className="nav-match">{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

/** Where a pane lives: place then tab, as separate spans so a narrow row gives up the place first. */
export function PlaceText({ place, query }: { place: DisplayPlace; query?: string }) {
  return <>
    <span className="nav-place"><Highlight text={place.place} query={query} /></span>
    {place.tab && <>{TITLE_SEP}<span className="nav-place-tab"><Highlight text={place.tab} query={query} /></span></>}
  </>;
}
