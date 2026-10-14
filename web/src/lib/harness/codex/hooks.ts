// Codex's hooks review — the startup screen when the operator's hooks are new or changed
// (HOOKS_NOTES.md, captured on 0.162.1):
//
//   Hooks need review
//   3 hooks are new or changed.
//   Hooks can run outside the sandbox after you trust them.
//
// › 1. Review hooks
//   2. Trust all and continue
//   3. Continue without trusting (hooks won't run)
//
//   enter confirm · esc skip
//
// A digit only moves the pointer here (measured), so every row is the arrow walk from the `›`
// pointer plus the Enter the footer names, as on the rewritten folder-trust prompt. The pointer and
// the paragraph above the rows are in the signature: a pointer moved at the desk, or a different
// hook count, refuses a stale tap. Anything off the captured layout refuses (fail-closed null).

import type { StyledLine } from "../../blocks";
import type { PromptModel, PromptOption } from "../prompt-model";
import { lastNonBlankIndex, lineText, regionSignature, rstrip, skipBlanksUp } from "./markers";
import { pointerWalk } from "./trust";

export interface HooksReviewRegion {
  model: PromptModel;
  startLine: number;
}

const QUESTION = "Hooks need review";
const HEADING = /^\s*Hooks need review$/;
const FOOTER = /^\s*enter confirm · esc skip$/;
const OPTION = /^(› |\s{2})([123])\. (.+)$/;
const LABELS = ["Review hooks", "Trust all and continue", "Continue without trusting (hooks won't run)"];
/** The paragraph under the heading wraps with the pane. */
const HEADING_REACH = 8;

export function detectHooksReviewRegion(lines: StyledLine[]): HooksReviewRegion | null {
  const texts = lines.map((l) => rstrip(lineText(l)));
  const fi = lastNonBlankIndex(texts);
  if (fi < 4 || !FOOTER.test(texts[fi]!)) return null;

  const bottom = skipBlanksUp(texts, fi - 1);
  const first = bottom - LABELS.length + 1;
  if (first < 1) return null;
  const rows = LABELS.map((label, i) => {
    const m = OPTION.exec(texts[first + i]!);
    return m && m[2] === String(i + 1) && m[3]!.trim() === label ? m[1] === "› " : null;
  });
  if (rows.some((r) => r === null)) return null;
  // Exactly one row carries the pointer; it is where a bare Enter lands.
  const pointed = rows.indexOf(true);
  if (pointed < 0 || rows.lastIndexOf(true) !== pointed) return null;

  // The heading opens the paragraph above the rows, across the blank rows between them.
  let headingRow = -1;
  const top = skipBlanksUp(texts, first - 1);
  for (let i = top; i >= 0 && top - i < HEADING_REACH; i--) {
    if (HEADING.test(texts[i]!)) {
      headingRow = i;
      break;
    }
    if (texts[i]!.trim() === "") break;
  }
  if (headingRow < 0) return null;

  const signature = regionSignature(lines, headingRow, fi + 1);
  if (signature === "") return null;

  const options: PromptOption[] = LABELS.map((label, i) => ({ label, keys: pointerWalk(pointed, i) }));
  options[pointed] = { ...options[pointed]!, keyLabel: "›" };
  return {
    startLine: headingRow,
    model: { question: QUESTION, options, family: "trust", coreSignature: QUESTION, signature },
  };
}
