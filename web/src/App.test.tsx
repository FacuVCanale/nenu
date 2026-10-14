import { render, waitFor } from "@testing-library/react";

import { App } from "./App";

// One default in the facade: every stroked icon draws at 1.5, and only an icon that means to
// differ (Send's arrow) names its own weight.
it("draws the navigation's icons at stroke 1.5", async () => {
  const { container } = render(<App />);
  await waitFor(() => expect(container.querySelector(".workbench-navigation svg.icon")).not.toBeNull());
  const icons = [...container.querySelectorAll(".workbench-navigation svg.icon, .bottom-tab-bar svg.icon")];
  expect(new Set(icons.map((icon) => icon.getAttribute("stroke-width")))).toEqual(new Set(["1.5"]));
});
