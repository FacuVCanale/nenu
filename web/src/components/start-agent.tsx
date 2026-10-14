import { useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { PermissionPicker, Segmented } from "@/components/new-agent-sheet";
import { Button } from "@/components/ui/button";
import { startAgent } from "@/lib/api";
import { SPAWN_AGENTS, agentLabel, loadAgent, loadPermission, saveAgent, savePermission, type SpawnAgent } from "@/lib/spawn";

type PaneAgent = Exclude<SpawnAgent, "shell">;
// The pane is the shell already: what starts in it is an agent.
const AGENTS = SPAWN_AGENTS.filter((a): a is { id: PaneAgent; label: string } => a.id !== "shell");

/** New's agent and permission choice, started in this shell. The bridge turns the level into flags. */
export function StartAgent({ paneId, session, disabled, ready }: { paneId: string; session?: string; disabled: boolean; ready: boolean }) {
  const pending = useRef(false);
  const [agent, setAgent] = useState<PaneAgent>(() => {
    const last = loadAgent();
    return last === "shell" ? "claude" : last;
  });
  const [permissions, setPermissions] = useState(() => ({ claude: loadPermission("claude"), codex: loadPermission("codex") }));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revalidator = useRevalidator();
  async function start() {
    if (pending.current || disabled || !ready) return;
    pending.current = true;
    setStarting(true);
    setError(null);
    const permission = permissions[agent];
    saveAgent(agent);
    savePermission(agent, permission);
    try {
      const result = await startAgent(paneId, agent, session, permission);
      if (!result.ok) setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the agent.");
    } finally {
      pending.current = false;
      setStarting(false);
      void revalidator.revalidate();
    }
  }
  return <section className="border-t border-border/40 px-3 py-3" aria-label="Start a conversation">
    <div className="flex max-w-md flex-col gap-3">
      <Segmented label="Agent" options={AGENTS} value={agent} onChange={setAgent} />
      <PermissionPicker agent={agent} value={permissions[agent]} onChange={(id) => setPermissions((p) => ({ ...p, [agent]: id }))} />
      <Button className="h-11" disabled={disabled || starting || !ready} onClick={() => void start()}>Start {agentLabel(agent)}</Button>
    </div>
    {starting && <p role="status" className="mt-2 text-sm text-muted-foreground">Starting the agent…</p>}
    {!ready && <p role="status" className="mt-2 text-sm text-muted-foreground">Preparing the terminal…</p>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error} Check the terminal before retrying.</p>}
  </section>;
}
