import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { AppHeader, SettingsGear, type HeaderBack } from "@/components/app-header";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import type { HomeData } from "@/lib/loaders";
import { cn } from "@/lib/utils";

/**
 * A page (Home, a project, a node): the shared header, the read-only notice, and the page column under
 * it. The page draws its own heading, so the header's title waits until that heading has scrolled
 * under the header, the way a large title folds into a phone's navigation bar.
 */
export function ColumnPage({ data, title, back, bodyClassName, children }: {
  data: HomeData;
  title: string;
  /** Where the back control goes; Home when omitted. */
  back?: HeaderBack;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const body = useRef<HTMLElement>(null);
  const headingInView = useHeadingInView(body);
  return (
    <div className="workbench-home flex min-h-0 min-w-0 flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} title={title} titleHidden={headingInView} back={back}
        rightTrail={<SettingsGear session={data.session} />} />
      <ReadOnlyBanner device={data.device} />
      <main ref={body} className={cn("page-body", bodyClassName)}>
        <div className="page-column">{children}</div>
      </main>
    </div>
  );
}

/** Whether the page's first heading is still in view in its scroller. False without a heading to watch. */
function useHeadingInView(scroller: RefObject<HTMLElement | null>): boolean {
  const [heading, setHeading] = useState<Element | null>(null);
  const [inView, setInView] = useState(true);
  // The heading can change with the page's data (a node that turns up after a refresh), so look again
  // after every render; only a different element starts a new watch.
  useLayoutEffect(() => {
    const found = scroller.current?.querySelector("h1, h2") ?? null;
    if (found !== heading) setHeading(found);
  });
  const watchable = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    const root = scroller.current;
    if (!heading || !root || !watchable) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry!.isIntersecting), { root });
    observer.observe(heading);
    return () => observer.disconnect();
  }, [heading, scroller, watchable]);
  return watchable && heading !== null && inView;
}
