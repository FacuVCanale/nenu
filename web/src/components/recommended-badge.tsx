/** The agent's own marker on the option it suggests: "Apple (Recommended)". */
const RECOMMENDED = /\s*\(recommended\)\s*$/i;

/** A label without the agent's "(Recommended)" suffix, and whether it carried one. */
export function recommendedLabel(label: string): { text: string; recommended: boolean } {
  return { text: label.replace(RECOMMENDED, ""), recommended: RECOMMENDED.test(label) };
}

/** That suffix as a badge: foreground text on a primary tint, legible in both themes. The badge is the
 *  only mark: the recommended row is drawn like every other row, never filled. */
export function RecommendedBadge() {
  return <span className="shrink-0 rounded-sm bg-primary/15 px-1.5 py-0.5 text-micro text-foreground">Recommended</span>;
}
