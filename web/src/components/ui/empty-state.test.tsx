import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";

import { Button } from "./button";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("says what is missing and offers one way forward", () => {
    render(
      <EmptyState icon={Inbox} title="That project no longer exists" action={<Button>Back to Home</Button>}>
        It may have been closed in Herdr.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "That project no longer exists" })).toBeVisible();
    expect(screen.getByText("It may have been closed in Herdr.")).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Back to Home" })).toBeVisible();
  });

  it("keeps its icon out of the accessible text", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Nothing here" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sets its title and body on the type scale", () => {
    render(<EmptyState title="Nothing here">Body</EmptyState>);
    expect(screen.getByRole("heading")).toHaveClass("text-headline");
    expect(screen.getByText("Body")).toHaveClass("text-subhead", "text-muted-foreground");
  });
});
