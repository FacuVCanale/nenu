import { lazy, Suspense, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// Agent math, drawn by the browser from MathML. The TeX engine loads with the first formula on
// screen, so a chat without math never fetches it. Until it arrives, if its chunk can't load, or if a
// formula doesn't parse, the TeX shows as written.
const MathView = lazy(() =>
  import("./math-view")
    .then(({ loadMathView }) => loadMathView())
    .then((view) => ({ default: view }), () => ({ default: ({ fallback }: { fallback: ReactNode }) => fallback })),
);

function TexSource({ tex }: { tex: string }) {
  return <code className="font-mono text-[0.875em] text-muted-foreground [overflow-wrap:anywhere]">{tex}</code>;
}

/** A formula in the reading size of the text around it. Display math gets its own line, and pans when wider than the phone. */
export function TexMath({ tex, display }: { tex: string; display: boolean }) {
  const source = <TexSource tex={tex} />;
  return (
    <span className={cn(display && "block overflow-x-auto overflow-y-hidden py-0.5")}>
      <Suspense fallback={source}>
        <MathView tex={tex} display={display} fallback={source} />
      </Suspense>
    </span>
  );
}
