import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListRow, ListSection } from "./list-group";

describe("ListSection", () => {
  it("is a region named by its header, holding its rows and its footer", () => {
    render(
      <ListSection title="Notify when" footer="Applies to every device with push on.">
        <ListRow title="Needs input" hint="When an agent is waiting on you." />
        <ListRow title="Finished" />
      </ListSection>,
    );

    const section = screen.getByRole("region", { name: "Notify when" });
    expect(within(section).getByText("Needs input")).toBeInTheDocument();
    expect(within(section).getByText("When an agent is waiting on you.")).toBeInTheDocument();
    expect(within(section).getByText("Finished")).toBeInTheDocument();
    expect(within(section).getByText("Applies to every device with push on.")).toBeInTheDocument();
  });

  it("puts a row's control after its title", () => {
    render(
      <ListSection title="Appearance">
        <ListRow title="Haptics">
          <button type="button">toggle</button>
        </ListRow>
      </ListSection>,
    );
    const title = screen.getByText("Haptics");
    const control = screen.getByRole("button", { name: "toggle" });
    expect(title.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
