import { useEffect, useRef } from "react";
import { Navigate, useNavigate, useParams, useRouteLoaderData } from "react-router";
import { MessageSquare, Plus } from "lucide-react";

import { AppHeader, SettingsGear } from "@/components/app-header";
import { ReadOnlyBanner } from "@/components/read-only-banner";
import { Button } from "@/components/ui/button";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath, panePath } from "@/lib/nav";
import { workspaceEntry, workspaceName } from "@/lib/spaces";
import { openNewAgent } from "@/lib/spawn";
import { setStatus } from "@/lib/status";
import { canCreate } from "@/lib/types";

// A workspace has no page of its own. /space/:id opens the pane every other way in opens
// (workspaceEntry), so a link from an older Nenu lands where a tap in the sidebar does; the tabs and
// panes are the strips above that chat. Only a workspace without a pane draws here: the empty chat it
// would open on, with a way to start something in it.
export function SpaceRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { spaceId = "" } = useParams();
  const navigate = useNavigate();

  const workspace = data.workspaces.find((w) => w.workspaceId === spaceId);

  // Recover from a deleted space: once a healthy snapshot no longer has it, bounce to the dashboard
  // instead of leaving you on an empty shell. Guarded on a connected, non-stale snapshot so a
  // transient poll failure or a reconnect (or an idle-lock remount where the space died while locked)
  // doesn't evict a still-valid one. Mirrors DetailRoute's closed-pane recovery.
  // Tell "closed under you" apart from "deep-link that never resolved": track whether we ever saw
  // this space (a ref write during render is idempotent). "Space closed" would misdescribe
  // /space/<bad-id>, which was never open.
  const gone = !workspace;
  const everExisted = useRef(false);
  if (workspace) everExisted.current = true;
  useEffect(() => {
    if (gone && data.bridge === "connected" && !data.error) {
      setStatus(everExisted.current ? "Space closed" : "Space not found", "info");
      navigate(homePath(data.session), { replace: true });
    }
  }, [gone, data.bridge, data.error, data.session, navigate]);

  const entry = workspace && workspaceEntry(workspace.workspaceId, data);
  if (entry) return <Navigate to={panePath(entry.paneId, data.session)} replace />;

  return (
    <div className="workbench-chat flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <AppHeader bridge={data.bridge} error={data.error} onHome={() => navigate(homePath(data.session))}
        rightTrail={<SettingsGear session={data.session} />}>
        <span className="truncate text-[15px] font-semibold leading-tight lg:text-sm">{workspace ? workspaceName(workspace) : "Workspace"}</span>
      </AppHeader>
      <ReadOnlyBanner device={data.device} />
      {workspace && (
        <div className="flex flex-1 flex-col items-center gap-3 border-t border-border/40 px-4 py-16 text-center text-sm text-muted-foreground">
          <MessageSquare aria-hidden className="size-5" />
          <p>Nothing runs in this workspace yet.</p>
          {canCreate(data) && (
            <Button type="button" variant="outline" onClick={() => openNewAgent({ kind: "tab", workspaceId: workspace.workspaceId })}>
              <Plus aria-hidden className="size-4" />Start an agent or a shell
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
