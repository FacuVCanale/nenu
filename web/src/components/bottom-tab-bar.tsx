import { Link } from "react-router";
import { CirclePlus, House, Search } from "lucide-react";

import { needYou } from "@/lib/home-stats";

/** Which tab reads as selected: the Search sheet while it is open, else Home while Home is on screen. */
export type TabBarTab = "home" | "search" | null;

// The app's stroke; the open tab's glyph is a step heavier (shell.css).
const ICON = { "aria-hidden": true, size: 23 } as const;

/** The phone's primary navigation: Home, which counts what needs you, New in the middle, and Search. */
export function BottomTabBar({ active, homeTo, attention, onNew, onSearch }: {
  active: TabBarTab;
  homeTo: string;
  /** How many need you, as Home's headline counts them; the badge hides at zero. */
  attention: number;
  /** Absent while creating is not allowed (read-only device, no connection). */
  onNew?: () => void;
  onSearch: () => void;
}) {
  return (
    <nav className="bottom-tab-bar" aria-label="Primary">
      <Link className="bottom-tab" to={homeTo} aria-current={active === "home" ? "page" : undefined}
        aria-label={attention > 0 ? `Home, ${needYou(attention)}` : undefined}>
        <House {...ICON} />Home
        {attention > 0 && <span className="bottom-tab-badge" aria-hidden>{attention}</span>}
      </Link>
      <button type="button" className="bottom-tab" onClick={onNew} disabled={!onNew}>
        <CirclePlus {...ICON} />New
      </button>
      <button type="button" className="bottom-tab" aria-pressed={active === "search"} onClick={onSearch}>
        <Search {...ICON} />Search
      </button>
    </nav>
  );
}
