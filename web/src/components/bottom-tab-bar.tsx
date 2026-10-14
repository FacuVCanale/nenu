import { Link } from "react-router";
import { CirclePlus, House, Inbox, Layers, Search } from "lucide-react";

/** Which tab reads as selected: a sheet the bar opened, else Home while Home is on screen. */
export type TabBarTab = "home" | "needs-you" | "browse" | "search" | null;

// The app's stroke; the open tab's glyph is a step heavier (shell.css).
const ICON = { "aria-hidden": true, size: 23 } as const;

/** The phone's primary navigation: Home, Needs you, New in the middle, Browse and Search, all one weight. */
export function BottomTabBar({ active, homeTo, attention, onNeedsYou, onNew, onBrowse, onSearch }: {
  active: TabBarTab;
  homeTo: string;
  /** How many panes are waiting on the operator; the badge hides at zero. */
  attention: number;
  onNeedsYou: () => void;
  /** Absent while creating is not allowed (read-only device, no connection). */
  onNew?: () => void;
  onBrowse: () => void;
  onSearch: () => void;
}) {
  return (
    <nav className="bottom-tab-bar" aria-label="Primary">
      <Link className="bottom-tab" to={homeTo} aria-current={active === "home" ? "page" : undefined}>
        <House {...ICON} />Home
      </Link>
      <button type="button" className="bottom-tab" aria-pressed={active === "needs-you"} onClick={onNeedsYou}
        aria-label={attention > 0 ? `Needs you, ${attention}` : "Needs you"}>
        <Inbox {...ICON} />Needs you
        {attention > 0 && <span className="bottom-tab-badge" aria-hidden>{attention}</span>}
      </button>
      <button type="button" className="bottom-tab" onClick={onNew} disabled={!onNew}>
        <CirclePlus {...ICON} />New
      </button>
      <button type="button" className="bottom-tab" aria-pressed={active === "browse"} onClick={onBrowse}>
        <Layers {...ICON} />Browse
      </button>
      <button type="button" className="bottom-tab" aria-pressed={active === "search"} onClick={onSearch}>
        <Search {...ICON} />Search
      </button>
    </nav>
  );
}
