import { createElement, type ReactNode } from "react";

// A formula's MathML, turned into React elements through an allowlist. The TeX engine hands back a
// string; it is parsed into an inert document (no scripts run, nothing loads) and walked here, so
// what reaches the page is only known MathML elements, their layout attributes and Temml's own
// classes. There is no innerHTML on this path: the XSS boundary stays the one CLAUDE.md describes,
// even if the engine ever emitted something it should not.
//
// Inline styles are dropped too. Temml uses them for \textcolor, \boxed and table cell padding;
// math.css covers the padding, and a browser whose MathML elements lack `.style` (jsdom does) would
// make React throw on them.

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

// MathML Core's presentation elements. No `annotation-xml` (it can carry HTML) and no `maction`.
const ELEMENTS = new Set([
  "math", "semantics", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msub", "msup", "msubsup",
  "munder", "mover", "munderover", "mmultiscripts", "mprescripts", "none", "mfrac", "msqrt", "mroot",
  "mstyle", "mpadded", "mphantom", "merror", "mtable", "mtr", "mtd", "menclose",
]);

// Layout only: never href, src, id, event handlers or anything that names a resource.
const ATTRIBUTES = new Set([
  "display", "displaystyle", "scriptlevel", "mathvariant", "dir", "form", "fence", "separator",
  "stretchy", "symmetric", "largeop", "movablelimits", "accent", "accentunder", "lspace", "rspace",
  "minsize", "maxsize", "width", "height", "depth", "voffset", "linethickness", "notation",
  "columnalign", "rowalign", "columnspacing", "rowspacing", "columnlines", "rowlines", "frame",
]);

// Temml's layout classes (styled in components/math.css). Anything else, a utility class included,
// is dropped.
const TEMML_CLASS = /^(?:tml|wbk)-[\w-]+$/;

function toReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element) || node.namespaceURI !== MATHML_NS || !ELEMENTS.has(node.localName)) return null;
  const props: Record<string, unknown> = { key };
  for (const { name, value } of node.attributes) {
    if (ATTRIBUTES.has(name)) props[name] = value;
    else if (name === "class") {
      const kept = value.split(/\s+/).filter((c) => TEMML_CLASS.test(c)).join(" ");
      if (kept) props.className = kept;
    }
  }
  return createElement(node.localName, props, ...[...node.childNodes].map(toReact));
}

/** React elements for a MathML string, keeping only the allowlisted structure. */
export function mathmlToReact(markup: string): ReactNode {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  return [...doc.body.childNodes].map(toReact);
}
