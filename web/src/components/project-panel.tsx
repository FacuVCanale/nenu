import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, BookText, Check, ChatCircle, ChevronRight, Clock, ExternalLink, FileText, FolderGit2, GitPullRequest } from "@/components/ui/icon";

import { DiffBody, useDiffRead } from "@/components/diff-viewer";
import { errorMessage } from "@/components/node-start";
import { ProjectGlyph } from "@/components/project-glyph";
import { canMerge, ProjectTasks, threadDetail } from "@/components/project-tasks";
import { ICON_BUTTON, type ProjectSection } from "@/components/session-inspector";
import { PaneActivity, PrList, prLists } from "@/components/threads-panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { fetchOrgContext, fetchOrgTasks, fetchPaneDiff, sendMessage } from "@/lib/api";
import { nodeState } from "@/lib/org-tree";
import { isOpenThread, liveCoordinator } from "@/lib/projects";
import type { AgentView, OrgProjectDetail, OrgRoutine, OrgTask, ProjectThreadView, ProjectView } from "@/lib/types";
import { cn } from "@/lib/utils";

export type { ProjectSection } from "@/components/session-inspector";

interface ProjectPanelProps {
  project: ProjectView;
  /** The threads in scope: the whole project, or the work under the coordinator beside it. */
  threads: readonly ProjectThreadView[];
  /** The coordinator under the project that runs them; the project's own when omitted. */
  coordinator?: ProjectThreadView;
  panes: readonly AgentView[];
  session?: string;
  currentPaneId?: string;
  readOnly: boolean;
  /** The Claude pane whose background work Agents can show: the running coordinator's. */
  activityPaneId?: string;
  section: ProjectSection;
  onSection: (section: ProjectSection) => void;
  onOpenPane: (paneId: string) => void;
  onOpenNode: (id: string) => void;
  onChanged: () => void;
  now?: number;
}

/**
 * The Project tab of a desk's session panel: the project's name, then Notes (the coordinator's task
 * list by state), Agents (the coordinator and its threads), PRs (ready, in flight, history) and
 * Context (what every thread receives). Each view reads only while it is on screen.
 */
export function ProjectPanel(props: ProjectPanelProps) {
  const { project, threads, section, onSection } = props;
  const [moved, setMoved] = useState(false);
  const counts: Record<ProjectSection, number | null> = { notes: null, agents: threads.filter(isOpenThread).length, prs: prLists(threads).open.length, context: null };
  const tabs: Array<[ProjectSection, string]> = [["notes", "Notes"], ["agents", "Agents"], ["prs", "PRs"], ["context", "Context"]];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="project-panel-head">
        <ProjectGlyph slug={project.slug} size={18} />
        <h2 className="project-panel-name">{project.name}</h2>
        <div role="tablist" aria-label="Project sections" className="flex min-w-0 items-center gap-0.5">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={section === key} className="panel-tab"
              onClick={() => { setMoved(true); onSection(key); }}>
              {label}{counts[key] ? <span className="tabular-nums text-muted-foreground">{counts[key]}</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div key={section} role="tabpanel" aria-label={tabs.find(([key]) => key === section)![1]} data-moved={moved || undefined} className="project-panel-body">
        {section === "notes" && <Notes {...props} />}
        {section === "agents" && <Agents {...props} />}
        {section === "prs" && <Prs {...props} />}
        {section === "context" && <Context project={project} threads={threads} />}
      </div>
    </div>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────────────────────

type NoteState = "needs" | "merge" | "review" | "progress" | "todo" | "done";
const NOTE_GROUPS: ReadonlyArray<readonly [Exclude<NoteState, "done">, string]> = [
  ["needs", "Needs you"], ["merge", "Ready to merge"], ["review", "Ready for review"], ["progress", "In progress"], ["todo", "Not started"],
];
const NOTE_TONE: Record<NoteState, string> = {
  needs: "text-status-blocked", merge: "text-status-done", review: "text-primary", progress: "text-status-working", todo: "text-muted-foreground", done: "text-muted-foreground",
};

interface Note {
  key: string;
  title: string;
  state: NoteState;
  thread?: ProjectThreadView;
  /** The coordinator's task, absent when Notes lists threads because there is no task list. */
  task?: OrgTask;
  detail: string;
  owner: string;
}

function noteState(project: ProjectView, thread: ProjectThreadView): NoteState {
  const state = nodeState(thread);
  if (state === "resolved") return "done";
  if (state === "needs") return "needs";
  if (canMerge(project, thread)) return "merge";
  return state === "review" ? "review" : "progress";
}

function ownerLabel({ kind, profile, machine, name }: OrgTask["owner"]): string {
  if (kind === "me") return "you";
  if (kind === "person") return name;
  if (kind === "agent") return `${profile || "agent"}${machine ? `@${machine}` : ""}`;
  return "";
}

/** A task in the coordinator's words, its state from the thread running it. */
function taskNote(project: ProjectView, task: OrgTask, panes: readonly AgentView[], index: number): Note {
  const thread = task.thread ? project.threads.find((candidate) => candidate.id === task.thread) : undefined;
  const state = thread ? noteState(project, thread) : task.thread ? "progress" : "todo";
  const detail = thread ? threadDetail(thread, panes) : task.description.split("\n").find((line) => line.trim())?.trim() ?? "";
  return { key: `task-${index}`, title: task.title, state, thread, task, detail, owner: ownerLabel(task.owner) };
}

function threadNote(project: ProjectView, thread: ProjectThreadView, panes: readonly AgentView[]): Note {
  return { key: thread.id, title: thread.title, state: noteState(project, thread), thread, detail: threadDetail(thread, panes), owner: thread.agent ?? "" };
}

/** Changes whenever a thread moves between states, so the list is read again then and only then. */
const stateKey = (threads: readonly ProjectThreadView[]) => threads.map((thread) => `${thread.id}:${thread.status}:${thread.group ?? ""}:${thread.pr?.state ?? ""}`).join(",");

function Notes({ project, panes, session, readOnly, onOpenPane, onOpenNode }: ProjectPanelProps) {
  const [tasks, setTasks] = useState<OrgTask[] | null | undefined>(undefined);
  const [doneShown, setDoneShown] = useState(false);
  const [asking, setAsking] = useState<Note | null>(null);
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const states = stateKey(project.threads);
  useEffect(() => {
    const controller = new AbortController();
    fetchOrgTasks(project.slug, controller.signal)
      .then((reply) => setTasks(reply.tasks))
      .catch(() => { if (!controller.signal.aborted) setTasks((current) => current ?? null); });
    return () => controller.abort();
  }, [project.slug, states]);
  if (tasks === undefined) return <p role="status" className="px-1 text-sm text-muted-foreground">Reading the task list…</p>;

  const notes = tasks ? tasks.map((task, index) => taskNote(project, task, panes, index)) : project.threads.map((thread) => threadNote(project, thread, panes));
  const done = notes.filter((note) => note.state === "done");
  const coordinatorPane = liveCoordinator(project, panes);
  const why = readOnly ? "This device can only read" : coordinatorPane ? undefined : "Start the coordinator to change tasks";
  const row = (note: Note) => {
    const pr = note.thread?.pr;
    const Icon = pr ? GitPullRequest : note.thread ? ChatCircle : null;
    const open = note.thread && (() => note.thread!.paneId ? onOpenPane(note.thread!.paneId) : onOpenNode(note.thread!.id));
    const body = <>
      {Icon && <Icon aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", NOTE_TONE[note.state])} />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm"><span data-task-title className="font-medium">{note.title}</span>
          {pr?.number !== undefined && <span className="ml-1 tabular-nums text-primary">#{pr.number}</span>}</span>
        <span className="note-meta">
          {note.detail && <span className="min-w-0 truncate">{note.detail}</span>}
          {asked.has(note.key) ? <span>Asked the coordinator</span> : note.owner && <span>{note.owner}</span>}
        </span>
      </span>
    </>;
    return (
      <li key={note.key} className="task-row">
        {note.task && note.state !== "done" && <button type="button" className="note-check" aria-label={`Mark done: ${note.title}`} title={why ?? "Ask the coordinator to mark it done"}
          disabled={Boolean(why) || asked.has(note.key)} onClick={() => setAsking(note)}>
          {asked.has(note.key) && <Check aria-hidden className="size-3" />}
        </button>}
        {open ? <button type="button" className="task-main" onClick={open}>{body}</button> : <div className="task-main">{body}</div>}
      </li>
    );
  };
  return <>
    {NOTE_GROUPS.map(([state, label]) => {
      const list = notes.filter((note) => note.state === state);
      return list.length > 0 && <section key={state} aria-label={label} className="mb-4">
        <h3 className="panel-group-heading">{label}</h3>
        <ul className="task-list">{list.map(row)}</ul>
      </section>;
    })}
    {notes.length === 0 && <p className="px-1 text-sm text-muted-foreground">{tasks ? "The coordinator's task list is empty." : "No threads yet."}</p>}
    {done.length > 0 && <>
      <button type="button" className="task-history-toggle" aria-expanded={doneShown} onClick={() => setDoneShown(!doneShown)}>
        <ChevronRight aria-hidden className="size-3.5" />Done · {done.length}
      </button>
      {doneShown && <ul className="task-list task-history" aria-label="Done">{done.map(row)}</ul>}
    </>}
    {!tasks && <p className="mt-4 px-1 text-xs text-muted-foreground">Showing the threads by state; the coordinator's task list appears here with a newer Herdr Organizations.</p>}
    {coordinatorPane && <MarkDone note={asking} paneId={coordinatorPane} session={session} onCancel={() => setAsking(null)}
      onAsked={(note) => { setAsked((current) => new Set(current).add(note.key)); setAsking(null); }} />}
  </>;
}

/**
 * Only the coordinator writes TASKS.md: marking a task sends it one sentence through the guarded
 * send (typed, verified, submitted), and the coordinator edits the file on its turn.
 */
function MarkDone({ note, paneId, session, onCancel, onAsked }: { note: Note | null; paneId: string; session?: string; onCancel: () => void; onAsked: (note: Note) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    if (!note) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await sendMessage(paneId, { text: `Please mark as done the task "${note.title}" in TASKS.md. (Sent from Nenu.)`, requestId: crypto.randomUUID() }, session);
      if (outcome.ok) onAsked(note);
      else setError(outcome.error);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={note !== null} onClose={() => { setError(null); onCancel(); }} title="Mark this task done?"
      description={note && <>Nenu asks the coordinator to mark “{note.title}” done. It edits the task list on its turn.</>}>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="lg" onClick={() => { setError(null); onCancel(); }} disabled={busy}>Cancel</Button>
        <Button type="button" size="lg" onClick={() => void ask()} disabled={busy} aria-busy={busy || undefined}>{busy ? "Sending…" : "Ask the coordinator"}</Button>
      </div>
    </Dialog>
  );
}

// ── Agents ────────────────────────────────────────────────────────────────────────────────────

/** The coordinator and its threads as the organization draws them, and its background work on request. */
function Agents({ project, threads, coordinator, panes, session, currentPaneId, readOnly, activityPaneId, onOpenPane, onOpenNode, onChanged }: ProjectPanelProps) {
  const [work, setWork] = useState(false);
  return <>
    <ProjectTasks bare project={project} threads={threads} coordinator={coordinator} panes={panes} session={session} currentPaneId={currentPaneId}
      readOnly={readOnly} onOpenPane={onOpenPane} onOpenNode={onOpenNode} onChanged={onChanged} />
    {activityPaneId && <div className="mt-4">
      <button type="button" className="task-history-toggle" aria-expanded={work} onClick={() => setWork(!work)}>
        <ChevronRight aria-hidden className="size-3.5" />Background work
      </button>
      {work && <PaneActivity paneId={activityPaneId} session={session} className="mt-2" />}
    </div>}
  </>;
}

// ── PRs ───────────────────────────────────────────────────────────────────────────────────────

function Prs({ project, threads, session, readOnly, onOpenPane, onOpenNode, onChanged, now }: ProjectPanelProps) {
  const [opened, setOpened] = useState<ProjectThreadView | null>(null);
  const openThread = (thread: ProjectThreadView) => thread.paneId ? onOpenPane(thread.paneId) : onOpenNode(thread.id);
  if (opened) return <PrDiff thread={opened} session={session} onBack={() => setOpened(null)} onOpenThread={() => openThread(opened)} />;
  return <PrList project={project} threads={threads} session={session} readOnly={readOnly} onOpenPane={onOpenPane} onOpenNode={onOpenNode}
    onChanged={onChanged} onOpenPr={setOpened} grouped now={now} />;
}

/** A pull request's diff in the panel, read from its thread's folder; the thread and GitHub one tap away. */
function PrDiff({ thread, session, onBack, onOpenThread }: { thread: ProjectThreadView; session?: string; onBack: () => void; onOpenThread: () => void }) {
  const pr = thread.pr!;
  const paneId = thread.paneId;
  const number = pr.number;
  const readable = paneId !== undefined && number !== undefined;
  const read = useDiffRead(`${paneId ?? ""}\0${number ?? ""}`, readable, (signal) => fetchPaneDiff(paneId!, number!, session, signal));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" aria-label="Back to pull requests" title="Back to pull requests" onClick={onBack} className={ICON_BUTTON}><ArrowLeft aria-hidden className="size-4" /></button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{thread.title}{number !== undefined && <span className="ml-1.5 tabular-nums text-muted-foreground">#{number}</span>}</h3>
        <button type="button" onClick={onOpenThread} className="quiet-action"><ChatCircle aria-hidden className="size-3.5" />Open thread</button>
        {pr.url && <a href={pr.url} target="_blank" rel="noreferrer" className="quiet-action"><ExternalLink aria-hidden className="size-3.5" />GitHub</a>}
      </div>
      {readable ? <div className="-mx-4"><DiffBody read={read} comments={{ paneId, session }} /></div>
        : <p className="px-1 text-sm text-muted-foreground">Its diff is read from its thread's folder, and the thread has no pane open.</p>}
    </div>
  );
}

// ── Context ───────────────────────────────────────────────────────────────────────────────────

const size = (text: string) => text.length < 1000 ? String(text.length) : `${(text.length / 1000).toFixed(1)}k`;

/** One file every thread receives: its name and size, its text in place when opened. */
function SharedFile({ icon, name, text }: { icon: ReactNode; name: ReactNode; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="context-row">
        {icon}<span className="min-w-0 flex-1 truncate text-left">{name}</span><span className="tabular-nums text-muted-foreground">{size(text)}</span>
      </button>
      {open && <pre className="context-text">{text.trim()}</pre>}
    </li>
  );
}

function routineWhen(routine: OrgRoutine): string {
  return `${routine.trigger === "pr" ? "pull requests" : routine.schedule} · ${routine.enabled ? "on" : "off"}`;
}

/** The goal, what every thread receives, where they work, the routines and the agents. */
function Context({ project, threads }: { project: ProjectView; threads: readonly ProjectThreadView[] }) {
  const [read, setRead] = useState<{ detail: OrgProjectDetail | null; routines: OrgRoutine[] | null } | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetchOrgContext(project.slug, controller.signal)
      .then(({ detail, routines }) => setRead({ detail, routines }))
      .catch(() => { if (!controller.signal.aborted) setRead({ detail: null, routines: null }); });
    return () => controller.abort();
  }, [project.slug]);
  const detail = read?.detail;
  const branches = threads.filter((thread) => thread.branch && thread.status !== "resolved");
  const card = (label: string, children: ReactNode) => <section aria-label={label} className="mb-5">
    <h3 className="panel-group-heading">{label}</h3>{children}
  </section>;
  const fileIcon = <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  return <>
    {card("Goal", <p className="px-1 text-sm leading-relaxed">{project.goal || "This project has no goal written down yet."}</p>)}
    {read === undefined && <p role="status" className="px-1 text-sm text-muted-foreground">Reading the project…</p>}
    {detail && card("Every thread receives", <ul className="context-list">
      <SharedFile icon={fileIcon} name={<>PROJECT.md <span className="text-muted-foreground">· standing instructions</span></>} text={detail.instructions} />
      {detail.memory.trim() && <SharedFile icon={<BookText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />} name="MEMORY.md" text={detail.memory} />}
      {detail.memoryFiles.map((file) => <SharedFile key={file.name} icon={fileIcon} name={`memory/${file.name}`} text={file.text} />)}
    </ul>)}
    {detail && detail.repos.length > 0 && card("Repositories", <ul className="context-list">
      {detail.repos.map((repo) => <li key={`${repo.machine}\0${repo.path}`} className="context-row">
        <FolderGit2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{repo.path}</span>
        <span className="text-muted-foreground">{repo.machine || "this machine"}</span>
      </li>)}
    </ul>)}
    {read?.routines && read.routines.length > 0 && card("Routines", <ul className="context-list">
      {read.routines.map((routine) => <li key={routine.name} className="context-row">
        {routine.trigger === "pr" ? <GitPullRequest aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : <Clock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{routine.name}</span>
        <span className="text-muted-foreground">{routineWhen(routine)}</span>
      </li>)}
    </ul>)}
    {detail && card("Agents", <div className="flex flex-wrap gap-1.5">
      {[detail.coordinatorProfile && `Coordinator · ${detail.coordinatorProfile}`, detail.threadProfile && `Threads · ${detail.threadProfile}`,
        detail.maxParallelThreads > 0 && `Max ${detail.maxParallelThreads} in parallel`].filter(Boolean).map((chip) => <span key={String(chip)} className="context-chip">{chip}</span>)}
    </div>)}
    {branches.length > 0 && card("Branches", <ul className="flex flex-col gap-1 px-1 text-sm">
      {branches.map((thread) => <li key={thread.id} className="flex items-baseline gap-2">
        <span className="shrink-0">{thread.title}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{thread.branch}</span>
      </li>)}
    </ul>)}
    {read && !detail && <p className="px-1 text-xs text-muted-foreground">Memory and instructions appear here with a newer Herdr Organizations, which can show them (<code>project show</code>).</p>}
  </>;
}
