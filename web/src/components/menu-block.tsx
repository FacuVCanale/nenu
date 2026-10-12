import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2 } from "lucide-react";

import type { MenuModel, StyledLine } from "@/lib/blocks";
import {
  MENU_DOWN_KEYS,
  MENU_LEFT_KEYS,
  MENU_RIGHT_KEYS,
  MENU_UP_KEYS,
} from "@/lib/harness/menu-hints";
import {
  DialogCard,
  QuestionHeading,
  SECONDARY_ACTION,
  SecondaryActions,
} from "@/components/option-button";
import { Button } from "@/components/ui/button";
import { parseNativeModelMenu } from "@/lib/native-model-menu";
import { NativeModelMenu } from "@/components/native-model-menu";
import { NativeMenuContent } from "@/components/native-menu-content";

/** What a tap asks for: the keys to send, and whether it is a non-committal arrow (which takes the
 *  weaker identity-only guard in lib/menu-action.ts). */
export interface MenuBlockAction {
  keys: string[];
  nav: boolean;
}

export interface MenuBlockProps {
  agent?: string;
  /** The detected menu: its title, the keys its footer named, and the nav it advertised. */
  menu: MenuModel;
  /** The region's content, displayed as native text and rows above the verified controls. */
  lines: StyledLine[];
  /**
   * Injected send handler (from AgentChat). Presentational contract: this component NEVER touches
   * the network — the race guard and the send live in lib/menu-action.ts.
   */
  onAction: (action: MenuBlockAction) => void | Promise<void>;
  /** Read-only device or a gone pane: everything renders (for context) but can't be pressed. */
  disabled?: boolean;
}

// Native, tappable rendering of a generic modal menu — the `/model` picker and its kin.
//
// Known model menus have fully parsed clickable rows. Generic content remains display-only: its
// labels, descriptions and cursor become native text, while only the verified footer/nav acts.
// Content stays React text nodes, never HTML. No terminal palette is needed on these app surfaces.
//
// There are NO digit buttons, and there never will be: in the `/model` picker a digit confirms AND
// persists the choice as the user's default (.adr/0009). Only footer-named keys and arrows ship.
export function MenuBlock(props: MenuBlockProps) {
  const parsed = parseNativeModelMenu(props.menu, props.lines);
  return parsed ? <NativeModelMenu agent={props.agent} menu={props.menu} parsed={parsed} onAction={props.onAction} disabled={props.disabled} /> : <GenericMenuBlock {...props} />;
}

function GenericMenuBlock({ menu, lines, onAction, disabled }: MenuBlockProps) {
  const [sending, setSending] = useState<string | null>(null);
  const locked = disabled || sending !== null;

  async function press(id: string, action: MenuBlockAction) {
    if (locked) return;
    setSending(id);
    try {
      await onAction(action);
    } finally {
      setSending(null);
    }
  }

  const spinner = (
    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Sending" />
  );

  // The arrows are the large primary's neutral sibling, side by side: same height and radius.
  const navButton = (id: string, label: string, keys: string[], icon: ReactNode) => (
    <Button
      key={id}
      type="button"
      size="block"
      variant="secondary"
      aria-label={label}
      disabled={locked}
      aria-busy={sending === id || undefined}
      onClick={() => press(id, { keys, nav: true })}
      className="flex-1"
    >
      {sending === id ? spinner : icon}
    </Button>
  );

  const commits = menu.actions.filter((a) => !a.cancel);
  const cancels = menu.actions.filter((a) => a.cancel);

  return (
    <DialogCard label={menu.title}>
      <QuestionHeading>{menu.title}</QuestionHeading>

      {/* The screen's own lines, read as the card's content. */}
      <NativeMenuContent menu={menu} lines={lines} />

      {/* Arrow pad — only the directions the screen itself advertised (a `❯` row for Up/Down, an
          "←/→ to <verb>" row for Left/Right). Each is one keystroke; they move a highlight and commit
          nothing, so they take the weaker identity guard. */}
      {(menu.nav.upDown || menu.nav.leftRight !== undefined) && (
        <div className="flex items-center gap-2">
          {menu.nav.upDown && navButton("up", "Move up", MENU_UP_KEYS, <ArrowUp className="size-5" />)}
          {menu.nav.upDown &&
            navButton("down", "Move down", MENU_DOWN_KEYS, <ArrowDown className="size-5" />)}
          {/* The ←/→ pair sits AROUND the value it adjusts ("←  ◐ Medium effort  →"): the arrows are
              meaningless without it, and the row is re-derived every poll, so the label tracks the
              live value. Rendered in app space, not mirror space — no `dark:` question arises. */}
          {menu.nav.leftRight !== undefined && (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {navButton(
                "left",
                `Left — ${menu.nav.leftRight.verb} (${menu.nav.leftRight.label})`,
                MENU_LEFT_KEYS,
                <ArrowLeft className="size-5" />,
              )}
              <span className="min-w-0 flex-1 truncate text-center text-footnote text-muted-foreground">
                {menu.nav.leftRight.label}
              </span>
              {navButton(
                "right",
                `Right — ${menu.nav.leftRight.verb} (${menu.nav.leftRight.label})`,
                MENU_RIGHT_KEYS,
                <ArrowRight className="size-5" />,
              )}
            </div>
          )}
        </div>
      )}

      {/* The footer's own actions: the first is the card's one large primary, any other its quieter
          peer. Cancel (Esc) leaves without committing, so it sits with the utilities below. */}
      {commits.length > 0 && (
        <div className="flex flex-col gap-2">
          {commits.map((action, i) => {
            const id = `action-${i}`;
            return (
              <Button
                key={id}
                type="button"
                size="block"
                variant={i === 0 ? "default" : "secondary"}
                disabled={locked}
                aria-busy={sending === id || undefined}
                onClick={() => press(id, { keys: action.keys, nav: false })}
              >
                {sending === id ? <Loader2 className="size-4 shrink-0 animate-spin" aria-label="Sending" /> : null}
                {action.label}
              </Button>
            );
          })}
        </div>
      )}
      {cancels.length > 0 && (
        <SecondaryActions>
          {cancels.map((action, i) => {
            const id = `cancel-${i}`;
            return (
              <button
                key={id}
                type="button"
                disabled={locked}
                onClick={() => press(id, { keys: action.keys, nav: false })}
                className={SECONDARY_ACTION}
              >
                {sending === id ? spinner : null}
                {action.label}
              </button>
            );
          })}
        </SecondaryActions>
      )}
    </DialogCard>
  );
}
