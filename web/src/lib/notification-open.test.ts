import { listenForOpen, OPEN_MESSAGE, openInWindow, type OpenableWindow } from "@/lib/notification-open";

const URL_BASE = "https://nenu.test";

/** A window client: `answers` decides whether the page inside it acknowledges the message. */
function windowClient(url: string, answers: boolean) {
  const sent: unknown[] = [];
  const client: OpenableWindow & { navigated: string[]; focused: number } = {
    url,
    navigated: [],
    focused: 0,
    async focus() { client.focused++; return client; },
    async navigate(to: string) { client.navigated.push(to); return client; },
    postMessage(message: unknown, transfer: Transferable[]) {
      sent.push(message);
      if (answers) (transfer[0] as MessagePort).postMessage(true);
    },
  };
  return { client, sent };
}

describe("opening a tapped notification", () => {
  it("asks an open Nenu to open the page itself, without reloading it", async () => {
    const { client, sent } = windowClient(`${URL_BASE}/`, true);
    await openInWindow(client, `${URL_BASE}/pane/w1%3Aidle?s=demo`);
    expect(sent).toEqual([{ type: OPEN_MESSAGE, path: "/pane/w1%3Aidle?s=demo" }]);
    expect(client.navigated).toEqual([]);
    expect(client.focused).toBe(1);
  });

  it("navigates a page that does not answer, as an older Nenu needs", async () => {
    const { client } = windowClient(`${URL_BASE}/`, false);
    await openInWindow(client, `${URL_BASE}/settings`, 20);
    expect(client.navigated).toEqual([`${URL_BASE}/settings`]);
  });

  it("only focuses a window already showing that page", async () => {
    const { client, sent } = windowClient(`${URL_BASE}/settings`, true);
    await openInWindow(client, `${URL_BASE}/settings`);
    expect(sent).toEqual([]);
    expect(client.navigated).toEqual([]);
    expect(client.focused).toBe(1);
  });
});

describe("the app's side of that message", () => {
  function deliver(target: EventTarget, data: unknown) {
    const channel = new MessageChannel();
    const answered = new Promise<unknown>((resolve) => { channel.port2.onmessage = (event) => resolve(event.data); });
    target.dispatchEvent(new MessageEvent("message", { data, ports: [channel.port1] }));
    return answered;
  }

  it("opens the page in place and answers, so the worker does not reload it", async () => {
    const container = new EventTarget();
    const opened: string[] = [];
    listenForOpen(container, (path) => opened.push(path));
    await expect(deliver(container, { type: OPEN_MESSAGE, path: "/pane/w1%3Aidle?s=demo" })).resolves.toBe(true);
    expect(opened).toEqual(["/pane/w1%3Aidle?s=demo"]);
  });

  it("opens nothing that is not a path of this app", () => {
    const container = new EventTarget();
    const opened: string[] = [];
    listenForOpen(container, (path) => opened.push(path));
    for (const path of ["//evil.test/pane", "https://evil.test/", "javascript:alert(1)", "pane/x", 42]) {
      container.dispatchEvent(new MessageEvent("message", { data: { type: OPEN_MESSAGE, path } }));
    }
    container.dispatchEvent(new MessageEvent("message", { data: { type: "SKIP_WAITING" } }));
    expect(opened).toEqual([]);
  });
});
