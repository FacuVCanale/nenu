import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";
import { SettingsRoute } from "./settings";

const root: HomeData = {
  bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], projects: [], device: undefined,
  sessions: [], session: "work", snoozedUntil: null, update: undefined, error: false, authError: false,
};

it("goes back Home with the back link every page shares", async () => {
  const router = createMemoryRouter([{ id: ROOT_ROUTE_ID, path: "/", loader: () => root, element: <Outlet />, children: [
    { index: true, element: <p>HOME</p> },
    { path: "settings", element: <SettingsRoute /> },
  ] }], { initialEntries: ["/settings?s=work"] });
  render(<RouterProvider router={router} />);
  const header = within(await screen.findByRole("banner"));
  // A link to where it goes, named for it, like a project's or a node's; never a bare "Back" button.
  expect(header.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/?s=work");
  expect(header.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  router.dispose();
});
