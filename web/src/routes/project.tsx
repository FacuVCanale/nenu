import { useState } from "react";
import { Link, Navigate, useNavigate, useParams, useRevalidator, useRouteLoaderData } from "react-router";
import { FolderX, Loader2 } from "lucide-react";

import { ColumnPage } from "@/components/column-page";
import { ProjectTasks } from "@/components/project-tasks";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { homePath, nodePath, panePath } from "@/lib/nav";
import { isReadOnly } from "@/lib/types";

// A project opens on its coordinator's conversation; the pane route frames it with the task list.
// Without a live coordinator there is no conversation to show, so the project is its organization:
// a way to start the coordinator, the open tree, History, and New.
export function ProjectRoute() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData;
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const project = data.projects?.find((candidate) => candidate.slug === projectSlug);
  const coordinator = project?.coordinator?.paneId;
  if (coordinator && data.agents.some((pane) => pane.paneId === coordinator)) {
    return <Navigate to={panePath(coordinator, data.session)} replace />;
  }

  return <ColumnPage data={data} title={project?.name ?? "Project"}>
    {!project ? <ProjectMissing session={data.session} />
      : <ProjectTasks project={project} panes={data.agents} session={data.session} readOnly={isReadOnly(data.device)}
        onOpenPane={(id) => navigate(panePath(id, data.session))} onOpenNode={(id) => navigate(nodePath(project.slug, id, data.session))}
        onChanged={() => revalidator.revalidate()} />}
  </ColumnPage>;
}

/** How long Check again shows its work at least: a read that answers within a frame looked like a dead button. */
const CHECK_SHOWN_MS = 400;

/** A link to a project this Herdr session does not have (an old link, or another session's): Home, or read again. */
export function ProjectMissing({ session }: { session?: string }) {
  const revalidator = useRevalidator();
  // Its own flag, not the revalidator's state: the background poll would light the button too.
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    try {
      await Promise.all([revalidator.revalidate(), new Promise((resolve) => setTimeout(resolve, CHECK_SHOWN_MS))]);
    } finally {
      setChecking(false);
    }
  }
  return (
    <EmptyState icon={FolderX} title="Project not found" action={<div className="flex flex-wrap justify-center gap-3">
      <Link to={homePath(session)} className={buttonVariants()}>Go to Home</Link>
      <Button type="button" variant="outline" disabled={checking} aria-busy={checking || undefined} onClick={() => void check()}>
        {checking && <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}{checking ? "Checking…" : "Check again"}
      </Button>
    </div>}>
      This Herdr session has no project at this link.
    </EmptyState>
  );
}
