import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";
import { useRevalidator, useRouteLoaderData } from "react-router";

import { Button, buttonVariants } from "@/components/ui/button";
import { ListSection, listRowClass } from "@/components/ui/list-group";
import { checkForUpdates, fetchConfig } from "@/lib/api";
import { BUILD, isStaleBuild } from "@/lib/build";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { checkForUpdate } from "@/lib/pwa";
import { getServerBuild, observeServerBuild, useServerBuild } from "@/lib/server-build";
import { cn } from "@/lib/utils";
import { updateStatus, type UpdateCheck, type UpdateStatus } from "./update-status";

// The Updates card: the one place an update speaks (ADR 0027 keeps it out of every other screen).
// It reads the running version and pending upgrades from the snapshot's `update` (root loader), and
// whether this bundle is stale from the build the bridge serves (lib/server-build.ts, fed live by
// every poll's header). A manual check forces a fresh upstream look, which can take ~10s.

export function UpdateCheckControl() {
  const data = useRouteLoaderData(ROOT_ROUTE_ID) as HomeData | undefined;
  const update = data?.update;
  const revalidator = useRevalidator();
  const staleInterface = useStaleInterface();
  const [check, setCheck] = useState<UpdateCheck>("idle");
  const [reload, setReload] = useState<"idle" | "busy" | "failed">("idle");
  const status = updateStatus(update, { staleInterface, check });

  async function runCheck() {
    setCheck("checking");
    const priorCheckedAt = update?.checkedAt ?? null;
    try {
      const result = await checkForUpdates();
      // The bridge is fail-soft: a GitHub fetch error keeps prior state and STILL returns 200. If
      // `checkedAt` didn't advance (or never ran), the check silently failed — surface that rather
      // than let the stale state read as an authoritative "Up to date".
      if (result.checkedAt === null || result.checkedAt === priorCheckedAt) {
        setCheck("failed");
        return;
      }
      setCheck("idle");
      revalidator.revalidate();
    } catch {
      setCheck("failed");
    }
  }

  // Waits for the new worker before navigating; a failed download leaves this page as it was.
  async function reloadInterface() {
    setReload("busy");
    if (!(await checkForUpdate())) setReload("failed");
  }

  const failedReload = reload === "failed" && (
    <span role="status">Update could not finish. Your session is unchanged. Try again when the connection improves.</span>
  );

  // The row reads like an app in an update list: the version and its state, the one action at the
  // end. What the state needs explained goes under the card.
  return (
    <ListSection title="Updates" footer={failedReload || status.detail}>
      <div className={listRowClass}>
        <div className="min-w-0 flex-1">
          <div className="text-body">{update ? `Nenu ${update.current}` : "Nenu"}</div>
          {(status.badge || status.meta) && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {status.badge && <Badge status={status} />}
              {status.meta && <span className="text-footnote text-muted-foreground">{status.meta}</span>}
            </div>
          )}
        </div>
        {status.action?.kind === "check" && (
          <Button variant="outline" disabled={check === "checking"} aria-busy={check === "checking" || undefined} onClick={runCheck}>
            {check === "checking" && <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            Check now
          </Button>
        )}
        {status.action?.kind === "reload" && (
          <Button disabled={reload === "busy"} aria-busy={reload === "busy" || undefined} onClick={reloadInterface}>
            {reload === "busy" && <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
            Reload interface
          </Button>
        )}
        {status.action?.kind === "notes" && (
          // The release page carries the update commands. External: a new tab.
          <a href={status.action.href} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
            Release notes
            <ArrowUpRight aria-hidden="true" />
          </a>
        )}
      </div>
      {status.command && <CommandRow command={status.command} />}
    </ListSection>
  );
}

/** True while this page runs another build than the one the bridge serves. */
function useStaleInterface(): boolean {
  const serverBuild = useServerBuild();
  useEffect(() => {
    let alive = true;
    // Polls seed the store from a response header; an older bridge reports `build` only in its
    // config, so read that once when nothing has been observed yet.
    fetchConfig()
      .then((c) => {
        if (alive && getServerBuild() === undefined) observeServerBuild(c.build);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return isStaleBuild(BUILD.id, serverBuild);
}

function Badge({ status }: { status: UpdateStatus }) {
  const working = status.badge === "Checking…";
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-muted px-2 py-0.5 text-caption font-medium",
        status.tone === "neutral" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {/* The colour rides a dot, so the words keep full contrast on the tint in both themes. */}
      {working && <Loader2 aria-hidden="true" className="size-3 animate-spin motion-reduce:animate-none" />}
      {status.tone !== "neutral" && (
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", status.tone === "error" ? "bg-destructive" : "bg-primary")} />
      )}
      {status.badge}
    </span>
  );
}

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / denied): the command stays readable and selectable.
    }
  }

  return (
    <div className={cn(listRowClass, "items-start gap-2 pr-2")}>
      <code className="min-w-0 flex-1 py-2 font-mono text-code break-words">{command}</code>
      <Button variant="ghost" size="icon" aria-label={copied ? "Copied" : "Copy command"} onClick={copy} className="shrink-0">
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
    </div>
  );
}
