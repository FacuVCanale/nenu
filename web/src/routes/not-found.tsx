import { Link, useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { Unlink } from "lucide-react";

import { AppHeader, SettingsGear } from "@/components/app-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath } from "@/lib/nav";
import { useSession } from "@/lib/session";

/**
 * What an unknown URL shows, and what a 404 thrown from a loader shows: what is missing, the path so
 * a stale link can be recognised, and the one way back. Never the crash screen.
 */
export function NotFound() {
  const session = useSession();
  const { pathname } = useLocation();
  return (
    <EmptyState icon={Unlink} title="Page not found"
      action={<Link to={homePath(session)} className={buttonVariants({ size: "lg" })}>Go to Home</Link>}>
      This link doesn&rsquo;t match anything in Nenu.
      <code className="mt-2 block font-mono text-footnote break-all text-subtle-foreground">{pathname}</code>
    </EmptyState>
  );
}

/** The catch-all route: inside the app, so the header, sidebar and tab bar stay and nothing reads as broken. */
export function NotFoundRoute() {
  const navigate = useNavigate();
  // SAFETY: this route is a child of the root route, whose loader returns HomeData (router.tsx).
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const session = useSession();
  return (
    <div className="workbench-home flex min-h-0 min-w-0 flex-1 flex-col">
      <AppHeader bridge={data?.bridge} error={Boolean(data?.error)} onHome={() => navigate(homePath(session))}
        rightTrail={<SettingsGear session={session} />} />
      <main className="page-body flex flex-col justify-center">
        <NotFound />
      </main>
    </div>
  );
}
