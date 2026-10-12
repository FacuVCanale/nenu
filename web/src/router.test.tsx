import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import { routes } from "./router";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";

const home: HomeData = {
  bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [],
  device: undefined, session: undefined, snoozedUntil: null, update: undefined,
  error: false, authError: false,
};

// The app's real route table, with the root's data and layout stubbed: what an unknown URL lands on.
function open(path: string, data: HomeData = home) {
  const [root] = routes;
  const router = createMemoryRouter([{ ...root!, loader: () => data, element: <Outlet />, HydrateFallback: undefined }], {
    initialEntries: [path],
    hydrationData: { loaderData: { [ROOT_ROUTE_ID]: data } },
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("routes", () => {
  it("answers an unknown URL with Page not found inside the app, not the crash screen", () => {
    const router = open("/this/does/not/exist?s=qa");
    expect(screen.getByRole("heading", { name: "Page not found", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("/this/does/not/exist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/?s=qa");
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveClass("ui-button-lg", "bg-foreground");
    expect(screen.queryByText(/Nenu hit a problem|Something went wrong/)).not.toBeInTheDocument();
    router.dispose();
  });

  it("titles the page in its header and keeps the read-only notice, like every other page", () => {
    const router = open("/nowhere", { ...home, device: { enforced: true, authorized: false, device: "fran-iphone" } });
    expect(within(screen.getByRole("banner")).getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Read-only on this device · fran-iphone");
    router.dispose();
  });
});
