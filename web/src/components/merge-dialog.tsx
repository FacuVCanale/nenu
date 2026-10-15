import { useState } from "react";

import { errorMessage } from "@/components/node-start";
import { ConfirmDialog } from "@/components/ui/dialog";
import { mergeOrgThread } from "@/lib/api";
import { setStatus } from "@/lib/status";
import type { ProjectThreadView, ProjectView } from "@/lib/types";

/** Asks before Herdr Organizations merges a thread's pull request; a refusal stays in the dialog. */
export function MergeDialog({ project, thread, session, onMerged, onCancel }: {
  project: ProjectView;
  thread: ProjectThreadView | null;
  session?: string;
  onMerged: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (!thread) return;
    setBusy(true);
    setError(null);
    try {
      await mergeOrgThread({ project: project.slug, id: thread.id }, session);
      setStatus(`Merged ${thread.title}`, "success");
      onMerged();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog open={thread !== null} title="Merge this pull request?" confirmLabel="Merge" busy={busy} error={error}
      description={<><span className="font-medium text-foreground">{thread?.title}</span>{thread?.pr?.number !== undefined ? ` · PR #${thread.pr.number}` : ""} is merged by Herdr Organizations, which checks again that it is approved and green.</>}
      onConfirm={() => void merge()} onCancel={() => { if (!busy) { setError(null); onCancel(); } }} />
  );
}
