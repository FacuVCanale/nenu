// Reads a stylesheet's source as rules, so a test asserts a declared value rather than the exact text
// around it: a reformat or a reordered selector keeps it green, a changed number turns it red.
// jsdom compiles no Tailwind and lays nothing out; the bench measures the rendered result.

export interface CssRule {
  selectors: string[];
  /** The enclosing at-rules, outermost first: "@layer components", "@media (pointer: coarse)". */
  atRules: string[];
  decls: Record<string, string>;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Split on commas outside parentheses, so `:where(a, b):focus` stays one selector. */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(squash(list.slice(start, i)));
      start = i + 1;
    }
  }
  out.push(squash(list.slice(start)));
  return out.filter(Boolean);
}

function declarationsOf(body: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const part of body.split(";")) {
    const colon = part.indexOf(":");
    if (colon > 0) decls[squash(part.slice(0, colon)).toLowerCase()] = squash(part.slice(colon + 1));
  }
  return decls;
}

export function cssRules(css: string): CssRule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const stack: Array<{ prelude: string; body: string }> = [{ prelude: "", body: "" }];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "{") {
      const parts = src.slice(start, i).split(";");
      const prelude = squash(parts.pop()!);
      stack.at(-1)!.body += parts.join(";");
      stack.push({ prelude, body: "" });
      start = i + 1;
    } else if (src[i] === "}") {
      const block = stack.pop()!;
      block.body += src.slice(start, i);
      start = i + 1;
      if (block.prelude.startsWith("@")) continue;
      const atRules = stack.slice(1).map((b) => b.prelude).filter((p) => p.startsWith("@"));
      rules.push({ selectors: splitTop(block.prelude), atRules, decls: declarationsOf(block.body) });
    }
  }
  return rules;
}

/** The declarations for `selector` under exactly these at-rules, later rules winning as in the cascade. */
export function declarations(css: string, selector: string, atRules: string[] = []): Record<string, string> {
  const want = atRules.map(squash).join(" > ");
  return Object.assign(
    {},
    ...cssRules(css)
      .filter((rule) => rule.selectors.includes(squash(selector)) && rule.atRules.join(" > ") === want)
      .map((rule) => rule.decls),
  );
}
