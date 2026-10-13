import { useMemo, type ReactNode } from "react";
import temmlUrl from "temml?url";

import { mathmlToReact } from "@/lib/mathml";
import "./math.css";

type Props = { tex: string; display: boolean; fallback: ReactNode };

/**
 * The lazy half of <TexMath>: Temml turns TeX into MathML, which the browser draws with its own math
 * font. `trust: false` keeps \href, \class, \style and friends out; mathmlToReact is the boundary.
 *
 * Temml loads as its own published file, copied byte for byte, never through the bundle: rolldown 1.1
 * folds Temml's lexer regex into one template literal and writes its surrogate-pair class as U+FFFD,
 * after which every \command fails to lex in a production build (only `E = mc^2`-style math would
 * render). Checked against the built chunk; drop the indirection once the bundler is fixed.
 */
export async function loadMathView() {
  const { default: temml } = (await import(/* @vite-ignore */ temmlUrl)) as typeof import("temml");
  return function MathView({ tex, display, fallback }: Props) {
    const math = useMemo(() => {
      try {
        return mathmlToReact(temml.renderToString(tex, { displayMode: display, throwOnError: true, trust: false }));
      } catch {
        return null;
      }
    }, [tex, display]);
    // The span is what Suspense hides and shows: a MathML element has no `.style` in every engine.
    return math ? <span>{math}</span> : fallback;
  };
}
