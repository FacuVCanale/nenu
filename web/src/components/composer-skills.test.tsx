import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { Composer } from "./composer";
import { server } from "@/test/setup";

function mount(agent = "codex", disconnected = false) {
  const writes = vi.fn();
  const catalogs: string[] = [];
  server.use(
    http.get(/\/api\/pane\/[^/]+\/skills$/, ({ request }) => {
      catalogs.push(request.url);
      return HttpResponse.json({ paneId: "w1:p1", available: true, trigger: agent === "codex" ? "$" : "/", total: 2, truncated: false, skills: [
        { name: "build-agents", description: "Build and test agents", invocation: agent === "codex" ? "$build-agents" : "/build-agents", source: "user" },
        { name: "designboard", description: "Create a visual design", invocation: agent === "codex" ? "$designboard" : "/designboard", source: "user" },
      ] });
    }),
    http.post(/\/api\/pane\/[^/]+\/reply$/, () => { writes(); return HttpResponse.json({ ok: true }); }),
  );
  const router = createMemoryRouter([{ path: "/", element: <Composer paneId="w1:p1" session="work" agent={agent} isShell={false} gone={false} readOnly={false} disconnected={disconnected}
    dialogPresent={false} text="" terminalDraft={null} rawTerminalDraft={null}
    prefs={{ wrap: true, fontSize: 11, rawTerminal: false, tapToFocus: true }} setWrap={vi.fn()} stepFontSize={vi.fn()} setRawTerminal={vi.fn()} setTapToFocus={vi.fn()} onSent={vi.fn()} /> }]);
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup(), writes, catalogs, input: screen.getByRole("textbox") };
}

it("opens and filters the real Codex catalog at $, then Enter inserts without sending", async () => {
  const { user, input, writes, catalogs } = mount();
  await user.type(input, "Please use $");
  expect(await screen.findByRole("listbox", { name: "Skills" })).toBeVisible();
  expect(screen.getByText("Skills · 2")).toBeVisible();
  await user.type(input, "des");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await user.keyboard("{Enter}");
  expect(input).toHaveValue("Please use $designboard ");
  expect(input).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(writes).not.toHaveBeenCalled();
  expect(catalogs).toHaveLength(1);
  expect(new URL(catalogs[0]!).searchParams.get("session")).toBe("work");
});

it("inserts a Claude slash skill by click without losing keyboard focus", async () => {
  const { user, input, writes } = mount("claude");
  await user.type(input, "/build");
  await user.click(await screen.findByRole("option", { name: /build-agents/ }));
  expect(input).toHaveValue("/build-agents ");
  expect(input).toHaveFocus();
  expect(writes).not.toHaveBeenCalled();
});

it("Codex slash lists its commands without requesting skills and Enter only inserts the command", async () => {
  const { user, input, writes, catalogs } = mount();
  await user.type(input, "/");
  expect(await screen.findByRole("listbox", { name: "Commands" })).toBeVisible();
  expect(screen.getByRole("option", { name: /^\/permissions / })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /^\/config / })).not.toBeInTheDocument();
  expect(catalogs).toHaveLength(0);
  const total = screen.getAllByRole("option").length;
  await user.type(input, "model");
  expect(screen.getByText(`Commands · ${screen.getAllByRole("option").length} / ${total}`)).toBeVisible();
  await user.keyboard("{Enter}");
  expect(input).toHaveValue("/model ");
  expect(input).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(writes).not.toHaveBeenCalled();
});

it("Claude slash combines installed skills with its configuration commands", async () => {
  const { user, input, writes } = mount("claude");
  await user.type(input, "/");
  expect(await screen.findByRole("listbox", { name: "Commands and skills" })).toBeVisible();
  expect(await screen.findByRole("option", { name: /^\/build-agents / })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /^\/config / })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /^\/personality / })).not.toBeInTheDocument();
  await user.type(input, "config");
  await user.keyboard("{Tab}");
  expect(input).toHaveValue("/config ");
  expect(writes).not.toHaveBeenCalled();
});

it("Claude dollar text remains ordinary text and never offers Codex skills", async () => {
  const { user, input, catalogs } = mount("claude");
  await user.type(input, "$build");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(catalogs).toHaveLength(0);
  expect(input).toHaveValue("$build");
});

it("Escape dismisses skills while preserving the literal draft", async () => {
  const { user, input } = mount();
  await user.type(input, "$");
  await screen.findByRole("listbox");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(input).toHaveValue("$");
  await user.type(input, "build");
  expect(await screen.findByRole("listbox")).toBeVisible();
});

it("keeps local typing available during connection loss and prevents terminal writes", async () => {
  const { user, input, writes } = mount("codex", true);
  await user.type(input, "Keep this draft while offline");
  expect(input).toHaveValue("Keep this draft while offline");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await user.keyboard("{Control>}{Enter}{/Control}");
  await waitFor(() => expect(writes).not.toHaveBeenCalled());
});
