// The answers a dialog may take in one tap away from its card (ADR 0057 §4): a push notification's
// actions, and Home's row on a desk. The bridge imports this file, so both offer the same ones.

export interface OneTapOption {
  index: number;
  label: string;
  role: string;
}

export interface OneTapDialog<O extends OneTapOption> {
  kind: string;
  options: readonly O[];
  detailComplete?: boolean;
  typing?: boolean;
}

/**
 * Never a persistent or free-text option, only on a question or a permission whose full command or
 * file is on the card, and only when every answer fits in two, so the one left out is never an
 * answer. A question's escape row ("Chat about this") is not an answer; a permission's "No" is.
 * Nothing while someone is typing.
 */
export function oneTapAnswers<O extends OneTapOption>(i: OneTapDialog<O>): O[] {
  if (i.typing || (i.kind !== "question" && !(i.kind === "permission" && i.detailComplete))) return [];
  const answers = i.options.filter((o) => o.role === "primary" || o.role === "neutral" || (i.kind === "permission" && o.role === "deny"));
  return answers.length > 0 && answers.length <= 2 ? answers : [];
}
