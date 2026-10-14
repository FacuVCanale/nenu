import { ChevronRight } from "@/components/ui/icon";
import type { MenuModel, StyledLine } from "@/lib/blocks";
import { MENU_ARROW_ROW, parseKeyHintFooter } from "@/lib/harness/menu-hints";
import { PURE_HORIZONTAL_RULE_GLYPH_CLASS } from "@/lib/rule-glyphs";

const OUTER_RULE = new RegExp(`^[${PURE_HORIZONTAL_RULE_GLYPH_CLASS}┌┐└┘╭╮╰╯┏┓┗┛╔╗╚╝\\s]{3,}$`, "u");

function isRenderedFooter(text: string, menu: MenuModel): boolean {
  const hints = parseKeyHintFooter(text);
  // Keep unsupported hints visible. Only hide the footer when every segment has a native action.
  if (hints.length > 0 && text.split(/\s+·\s+/).length === hints.length && hints.length === menu.actions.length) {
    return hints.every((hint, index) => hint.label === menu.actions[index]?.label &&
      hint.keys.join("\n") === menu.actions[index]?.keys.join("\n"));
  }
  return text === "Press enter to confirm or esc to go back" &&
    menu.actions.some((action) => action.label === "Confirm" && action.keys.join() === "Enter") &&
    menu.actions.some((action) => action.label === "Go back" && action.keys.join() === "Escape");
}

/**
 * Display structure only: static rows cannot infer a key recipe from numbering or a cursor. Drawn as
 * the card's text (the card sits in the conversation's scroller, so it has no scroller of its own).
 * The screen's indent, less the margin every row shares, becomes a hanging indent so a wrapped row
 * lines up under itself, and the highlighted row is marked by its chevron, never filled like a
 * button: tapping it does nothing.
 */
export function NativeMenuContent({ menu, lines }: { menu: MenuModel; lines: StyledLine[] }) {
  const text = lines.map((line) => line.segments.map((segment) => segment.text).join("").trimEnd());
  while (text.length && (!text[0]?.trim() || OUTER_RULE.test(text[0]!))) text.shift();
  while (text.length && (!text.at(-1)?.trim() || OUTER_RULE.test(text.at(-1)!))) text.pop();
  if (text[0]?.trim() === menu.title) text.shift();
  if (text.length && isRenderedFooter(text.at(-1)!.trim(), menu)) text.pop();
  const rows = text.filter((line) => line.trim()).filter((line) => {
    const arrow = MENU_ARROW_ROW.exec(line);
    return !arrow || !menu.nav.leftRight || arrow[1]?.trim() !== menu.nav.leftRight.label || arrow[2]?.trim() !== menu.nav.leftRight.verb;
  }).map((line) => {
    // Strip paired Unicode box sides, leaving all subject/command text between them intact.
    const content = line.replace(/^\s*[│┃║]\s?(.*?)\s?[│┃║]$/u, "$1");
    return { indent: content.length - content.trimStart().length, content: content.trimStart() };
  });
  const margin = Math.min(...rows.map((row) => row.indent));

  return (
    <div className="flex flex-col gap-1 break-words text-body">
      {rows.map(({ indent, content }, index) => {
        const style = { paddingLeft: `${indent - margin}ch` };
        const option = /^([❯›])?\s*(?:(\d+)\.\s+)?(.+)$/u.exec(content);
        if (option && (option[1] || option[2])) {
          const selected = Boolean(option[1]);
          const [label = "", ...description] = option[3]!.split(/\s{2,}/);
          return (
            <div key={index} data-row style={style} className={`flex items-start py-0.5 ${selected ? "font-medium text-foreground" : "text-foreground"}`}>
              {/* The cursor's two columns: its chevron, or the gap it leaves on the other rows. */}
              <span className="flex w-[2ch] shrink-0 pt-[5px]">
                {selected && <ChevronRight className="size-3.5" aria-label="Highlighted" />}
              </span>
              <div className="min-w-0 flex-1">
                <p>{option[2] && <span className="mr-1.5 font-normal text-muted-foreground">{option[2]}.</span>}{label}</p>
                {description.length > 0 && <p className="mt-0.5 text-footnote font-normal text-muted-foreground">{description.join(" ")}</p>}
              </div>
            </div>
          );
        }
        return <p key={index} data-row style={style} className="whitespace-pre-wrap py-0.5 text-muted-foreground">{content}</p>;
      })}
    </div>
  );
}
