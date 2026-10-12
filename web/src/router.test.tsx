import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import { routes } from "./router";
import { ROOT_ROUTE_ID, type HomeData } from "@/lib/loaders";

const home: HomeData = {
  bridge: "connected", agents: [], shellPanes: [], workspaces: [], tabs: [], sessions: [],
  device: undefined, session: undefined, snoozedUntil: null, update: undefined,
  error: false, authError: false,
};

// The app's real route table, with the root's data and layout stubbed: what an unknown URL lands on.
function open(path: string) {
  const [root] = routes;
  const router = createMemoryRouter([{ ...root!, loader: () => home, element: <Outlet />, HydrateFallback: undefined }], {
    initialEntries: [path],
    hydrationData: { loaderData: { [ROOT_ROUTE_ID]: home } },
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe("routes", () => {
  it("answers an unknown URL with Page not found inside the app, not the crash screen", () => {
    const router = open("/this/does/not/exist?s=qa");
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByText("/this/does/not/exist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/?s=qa");
    expect(screen.queryByText(/Nenu hit a problem|Something went wrong/)).not.toBeInTheDocument();
    router.dispose();
  });
});
