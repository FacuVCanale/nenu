/**
 * A tapped notification opens its page inside the Nenu already on screen, without reloading it. The
 * service worker asks that page to open the path and waits for its answer; a page that does not answer
 * (an older Nenu) is navigated the old way. Shared by sw.ts and the app, so the two cannot drift on
 * the message. Free of DOM and worker globals: it compiles under both.
 */

export const OPEN_MESSAGE = "nenu:open";

/** How long the worker waits for the page's answer before navigating it instead. */
export const OPEN_ANSWER_MS = 1500;

/** The part of a service worker's WindowClient this needs. */
export interface OpenableWindow {
  readonly url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

/** Worker side: bring the window forward and have it open `url`, by message first and by navigation if no answer comes. */
export async function openInWindow(client: OpenableWindow, url: string, answerMs = OPEN_ANSWER_MS): Promise<void> {
  await client.focus();
  if (client.url === url) return;
  const target = new URL(url);
  const channel = new MessageChannel();
  const answered = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), answerMs);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
  client.postMessage({ type: OPEN_MESSAGE, path: target.pathname + target.search }, [channel.port2]);
  const opened = await answered;
  channel.port1.close();
  if (!opened) await client.navigate(url).catch(() => null);
}

/** App side: open each path the worker asks for and answer it. Only a path of this app, never a URL. */
export function listenForOpen(container: EventTarget, open: (path: string) => void): void {
  container.addEventListener("message", (event) => {
    const { data, ports } = event as MessageEvent;
    if (data?.type !== OPEN_MESSAGE || typeof data.path !== "string") return;
    if (!data.path.startsWith("/") || data.path.startsWith("//")) return;
    open(data.path);
    ports[0]?.postMessage(true);
  });
}
