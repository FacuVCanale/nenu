import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AgentChat } from "@/components/agent-chat";
import { fixtureAgents } from "@/test/handlers";
import { cssRules, declarations } from "@/test/css-rules";

// The chat's chrome on a phone: the header, the strips and their notes are one translucent bar the
// thread scrolls under (T13), so no line is cut hard under the strip. jsdom lays nothing out and
// compiles no stylesheet, so these read the rules and check they reach the elements the chat draws;
// the bench measures the result.

const css = readFileSync(resolve(import.meta.dirname, "chat.css"), "utf8");
const PHONE = "@media (max-width: 1023px)";

beforeAll(() => { if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}; });

function renderChat() {
  const agent = { ...fixtureAgents[0]!, status: "idle" as const, hasSession: true };
  const tabs = [{ tabId: agent.tabId, workspaceId: agent.workspaceId, number: 1, label: "review", focused: false, paneCount: 1 }];
  render(<RouterProvider router={createMemoryRouter([{ path: "/pane/:paneId", element:
    <AgentChat paneId={agent.paneId} agent={agent} agents={[agent]} shellPanes={[]} tabs={tabs} text="" onBack={() => {}} onSelect={() => {}} /> }],
  { initialEntries: ["/pane/w1:p1"] })} />);
}

it("draws the header and the strips as one bar of the chrome material, blurred, over the thread on a phone", () => {
  expect(declarations(css, ".chat-chrome", [PHONE])).toMatchObject({ position: "absolute", top: "0" });
  expect(declarations(css, ".chat-chrome::before", [PHONE])).toMatchObject({ background: "var(--chrome)", "backdrop-filter": "blur(20px)" });
  renderChat();
  const chrome = screen.getByRole("banner").closest("[data-chat-chrome]");
  expect(chrome).toHaveClass("chat-chrome");
  expect(chrome?.querySelector('[data-workbench-navigation-band="tabs"]')).not.toBeNull();
});

it("starts the live conversation below the chrome, on the conversation's own scroller", async () => {
  renderChat();
  const section = await screen.findByRole("region", { name: "Live conversation" });
  const scroller = section.querySelector(".overflow-y-auto");
  const rule = cssRules(css).find((r) => r.atRules.join() === PHONE && /var\(--chat-chrome-height/.test(r.decls["padding-top"] ?? "") && r.selectors.some((s) => s.includes("Live conversation")));
  expect(rule).toBeDefined();
  const matched = rule!.selectors.flatMap((s) => [...document.querySelectorAll(s)]);
  expect(matched).toEqual([scroller]);
});

it("lines a desk's terminal composer up with the mirror, both on the page gutter", () => {
  expect(declarations(css, '.workbench-chat[data-view="terminal"] .workbench-composer', ["@media (min-width: 1024px)"])).toMatchObject({ "max-width": "none" });
});

it("lands a question's first line below the chrome when following stops on it, without moving the card", () => {
  // Following stops the [data-follow-stop] box a little under the list's top edge, which on a phone
  // is under the chrome. The box reaches up by the chrome's height and the card keeps its place.
  expect(declarations(css, ".chat-follow-stop", [PHONE])).toMatchObject({
    "padding-top": "var(--chat-chrome-height, 0px)",
    "margin-top": "calc(1.25rem - var(--chat-chrome-height, 0px))",
  });
});
