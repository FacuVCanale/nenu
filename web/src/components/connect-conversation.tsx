import { useEffect, useId, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { ChevronDown } from "lucide-react";
import { connectConversation, fetchConversations } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Explicit recovery: never choose a conversation just because its directory matches. One way forward
 * at a time: find the conversations running here, or type the ID Codex's /status shows, kept behind
 * its own disclosure so a bare field does not compete with the composer.
 */
export function ConnectConversation({ paneId, session, disabled, onConnected }: {
  paneId: string; session?: string; disabled: boolean; onConnected(): void;
}) {
  const [choices, setChoices] = useState<Array<{ id: string; title: string }> | null>(null);
  const [manual, setManual] = useState(false);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const revalidator = useRevalidator();
  const fieldId = useId();
  useEffect(() => () => request.current?.abort(), []);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(null);
    try { setChoices((await fetchConversations(paneId, session, controller.signal)).conversations); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load conversations."); }
    finally { inFlight.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function connect() {
    if (disabled || inFlight.current || !id.trim()) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const result = await connectConversation(paneId, id.trim(), session);
      if (!result.ok) throw new Error(result.error);
      await revalidator.revalidate();
      onConnected();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect conversation."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const listed = choices !== null && choices.length > 0;
  const field = "mt-1.5 min-h-11 w-full rounded-lg border bg-background px-3 text-body text-foreground";
  // One primary at a time: Find, or Connect once a list or the typed ID is open.
  const connectButton = <Button className="w-full" disabled={disabled || busy || !id.trim()} aria-busy={busy || undefined} onClick={() => void connect()}>Connect history</Button>;
  return <div className="w-full space-y-3 text-left">
    {listed
      ? <label className="block text-footnote text-muted-foreground">Running in this folder
        <select aria-label="Conversation to connect" className={field} value={id} onChange={(event) => setId(event.target.value)}>
          <option value="">Choose a conversation</option>
          {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title} ({choice.id.slice(0, 8)})</option>)}
        </select>
      </label>
      : <Button variant={manual ? "outline" : "default"} className="w-full" disabled={busy} aria-busy={busy || undefined} onClick={() => void load()}>Find Codex conversations</Button>}
    {choices?.length === 0 && <p role="status" className="text-center text-footnote text-muted-foreground">No Codex conversation is running in this folder.</p>}
    {listed && connectButton}
    <button type="button" aria-expanded={manual} aria-controls={fieldId} onClick={() => setManual(!manual)}
      className="flex min-h-11 w-full items-center justify-center gap-1 rounded-md text-footnote text-muted-foreground hover:text-foreground lg:min-h-9">
      Enter a session ID
      <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", manual && "rotate-180")} />
    </button>
    {manual && <div id={fieldId} className="space-y-3">
      <label className="block text-footnote text-muted-foreground">Session ID, from Codex /status
        <input aria-label="Session ID" className={field} value={id} onChange={(event) => setId(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
      </label>
      {!listed && connectButton}
    </div>}
    {error && <p role="alert" className="text-footnote text-destructive">{error}</p>}
  </div>;
}
