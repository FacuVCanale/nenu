import { useRef, useState, type ComponentProps, type MutableRefObject } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";

import { server } from "@/test/setup";
import { clearStatus, useStatus } from "@/lib/status";
import { Composer } from "./composer";

// On a desk the session panel's Terminal tab holds Keys and the "Type into terminal" switch, and the
// + menu keeps the message-side rows only. The composer still owns both: the tab is a place it draws
// into while the tab is on screen (agent-chat.tsx hands it over as `sessionPanel`).

beforeAll(() => {
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});
beforeEach(() => clearStatus());

function Status() {
  return <div data-testid="status">{useStatus()?.text ?? ""}</div>;
}

const base: ComponentProps<typeof Composer> = {
  paneId: "w1:p1",
  agent: "claude",
  isShell: false,
  gone: false,
  readOnly: false,
  dialogPresent: false,
  text: "pane output",
  terminalDraft: null,
  rawTerminalDraft: null,
  prefs: { wrap: true, fontSize: 11, rawTerminal: false, tapToFocus: true },
  setWrap: vi.fn(),
  stepFontSize: vi.fn(),
  setRawTerminal: vi.fn(),
  setTapToFocus: vi.fn(),
  onSent: vi.fn(),
  usageControls: <span>usage</span>,
};

let leaving: MutableRefObject<(() => boolean) | null>;

/** A desk: the composer beside a stand-in for the panel's Terminal tab, which the buttons put away. */
function Desk(props: Partial<ComponentProps<typeof Composer>>) {
  const [shown, setShown] = useState(true);
  const [paneId, setPaneId] = useState("w1:p1");
  const [gone, setGone] = useState(false);
  const [mirror, setMirror] = useState<HTMLElement | null>(null);
  const [controls, setControls] = useState<HTMLElement | null>(null);
  leaving = useRef<(() => boolean) | null>(null);
  return <>
    <button type="button" onClick={() => setShown((on) => !on)}>toggle tab</button>
    <button type="button" onClick={() => setPaneId("w1:p2")}>other pane</button>
    <button type="button" onClick={() => setGone(true)}>lock it</button>
    {shown && <section aria-label="Terminal tab"><div ref={setMirror} /><div ref={setControls} /></section>}
    <Composer {...base} {...props} paneId={paneId} gone={gone}
      sessionPanel={{ terminal: shown && mirror && controls ? { mirror, controls } : null, showTerminal: () => setShown(true), leaving }} />
    <Status />
  </>;
}

function renderDesk(props: Partial<ComponentProps<typeof Composer>> = {}) {
  const router = createMemoryRouter([{ path: "/", element: <Desk {...props} /> }]);
  return render(<RouterProvider router={router} />);
}

function renderPhone() {
  const router = createMemoryRouter([{ path: "/", element: <Composer {...base} /> }]);
  render(<RouterProvider router={router} />);
}

const tab = () => within(screen.getByRole("region", { name: "Terminal tab" }));
const typeSwitch = () => tab().getByRole("switch", { name: /Type into terminal/ });
const armed = () => screen.queryByText(/typing into terminal/i) !== null;

function menuRows(): string[] {
  fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
  const rows = within(screen.getByRole("dialog", { name: "Message actions" })).getAllByRole("button").map((row) => row.textContent?.trim() ?? "")
    .filter(Boolean); // the popover's own close button has no text
  fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
  return rows;
}

describe("Composer on a desk — the session panel's Terminal tab", () => {
  it("keeps the + menu to Files and photos, Commands and Context; Keys and Type sit in the tab", () => {
    renderDesk();
    expect(menuRows()).toEqual(["Files and photos", "Commands", "Context and usage"]);
    expect(tab().getByRole("button", { name: "Esc" })).toBeInTheDocument();
    expect(typeSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("leaves the phone's + menu as it was", () => {
    renderPhone();
    expect(menuRows()).toEqual(["Files and photos", "Quick replies", "Commands", "Keys", "Type into terminal", "Context and usage"]);
  });

  it("presses a key from the tab straight into the pane", async () => {
    const sent: string[][] = [];
    server.use(http.post(/\/api\/pane\/[^/]+\/keys$/, async ({ request }) => {
      sent.push(((await request.json()) as { keys: string[] }).keys);
      return HttpResponse.json({ ok: true });
    }));
    renderDesk();
    fireEvent.click(tab().getByRole("button", { name: "Esc" }));
    await waitFor(() => expect(sent).toEqual([["Escape"]]));
  });

  it("arms Type into terminal from the switch, focused in the composer, and the switch disarms it", () => {
    renderDesk();
    fireEvent.click(typeSwitch());
    expect(typeSwitch()).toHaveAttribute("aria-checked", "true");
    expect(armed()).toBe(true);
    expect(screen.getByPlaceholderText(/type into the terminal/i)).toHaveFocus();
    fireEvent.click(typeSwitch());
    expect(typeSwitch()).toHaveAttribute("aria-checked", "false");
    expect(armed()).toBe(false);
  });

  it("disarms when the Terminal tab leaves the screen, and comes back off", async () => {
    renderDesk();
    fireEvent.click(typeSwitch());
    fireEvent.click(screen.getByRole("button", { name: "toggle tab" }));
    await waitFor(() => expect(armed()).toBe(false));
    expect(screen.getByTestId("status")).toHaveTextContent(/stopped typing into the terminal/i);
    fireEvent.click(screen.getByRole("button", { name: "toggle tab" }));
    expect(typeSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("disarms on a pane switch", async () => {
    renderDesk();
    fireEvent.click(typeSwitch());
    fireEvent.click(screen.getByRole("button", { name: "other pane" }));
    await waitFor(() => expect(armed()).toBe(false));
    expect(typeSwitch()).toHaveAttribute("aria-checked", "false");
  });

  it("disarms when the composer locks, and the switch cannot arm a locked composer", async () => {
    renderDesk();
    fireEvent.click(typeSwitch());
    fireEvent.click(screen.getByRole("button", { name: "lock it" }));
    await waitFor(() => expect(armed()).toBe(false));
    expect(typeSwitch()).toBeDisabled();
  });

  it("disarms when the page is hidden", async () => {
    renderDesk();
    fireEvent.click(typeSwitch());
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(armed()).toBe(false));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
  });

  it("disarms when a key batch fails", async () => {
    server.use(http.post(/\/api\/pane\/[^/]+\/keys$/, () => HttpResponse.json({ ok: false, error: "gone" }, { status: 502 })));
    renderDesk();
    fireEvent.click(typeSwitch());
    fireEvent.change(screen.getByPlaceholderText(/type into the terminal/i), { target: { value: "x" } });
    await waitFor(() => expect(armed()).toBe(false));
  });

  it("is never kept: a remount starts with the switch off and nothing stored", () => {
    const view = renderDesk();
    fireEvent.click(typeSwitch());
    view.unmount();
    renderDesk();
    expect(typeSwitch()).toHaveAttribute("aria-checked", "false");
    expect(armed()).toBe(false);
    expect(Object.keys(localStorage).join(" ")).not.toMatch(/type|direct|armed/i);
  });

  // ADR 0005: leaving the Keys discards a staged queue, so the way out takes a second tap. In the tab
  // the way out is the panel's (another tab, ⋯, folding it), which asks `leaving` first.
  it("asks a second time before the tab leaves with keys staged", () => {
    renderDesk();
    expect(leaving.current?.()).toBe(true);
    fireEvent.click(tab().getByRole("button", { name: "Ctrl" }));
    fireEvent.click(tab().getByRole("button", { name: "Tab", exact: true }));
    let first: boolean | undefined;
    act(() => { first = leaving.current?.(); });
    expect(first).toBe(false);
    expect(screen.getByTestId("status")).toHaveTextContent("Tap again to discard 1 queued key");
    let second: boolean | undefined;
    act(() => { second = leaving.current?.(); });
    expect(second).toBe(true);
  });
});
