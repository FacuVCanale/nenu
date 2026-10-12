import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";

import { Button, buttonVariants } from "./button";

// jsdom compiles no Tailwind, so these pin the classes and rules the bench then measures:
// 44px on a coarse pointer, ink for the primary action, disabled from tokens, one focus ring.
const indexCss = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;

describe("Button", () => {
  it("fills the primary action with ink and keeps the accent for focus and links", () => {
    render(<Button>Start coordinator</Button>);
    const button = screen.getByRole("button", { name: "Start coordinator" });
    expect(button).toHaveClass("bg-foreground", "text-background");
    expect(button).not.toHaveClass("bg-primary");
  });

  it("grows default, sm and icon buttons to 44px on a coarse pointer, unless the caller sizes them", () => {
    for (const size of ["default", "sm", "icon"] as const) expect(buttonVariants({ size })).toContain(`ui-button-${size}`);
    expect(indexCss).toMatch(/@media \(pointer: coarse\) \{\s*\.ui-button-default, \.ui-button-sm \{ height: 2\.75rem; \}\s*\.ui-button-icon \{ width: 2\.75rem; height: 2\.75rem; \}/);
    // The sizes sit in the components layer, so a caller's h-6 or size-9 still wins.
    expect(indexCss).toMatch(/@layer components \{[^@]*\.ui-button-default \{ height: 2\.25rem; \}/);
  });

  it("draws unavailable from its own tokens, never as opacity over a fill", () => {
    for (const variant of variants) {
      const classes = buttonVariants({ variant }).split(" ");
      expect(classes.join(" "), variant).not.toMatch(/disabled:opacity/);
      expect(classes, variant).toContain("disabled:not-aria-busy:text-disabled-foreground");
    }
    for (const variant of ["default", "destructive", "secondary"] as const) expect(buttonVariants({ variant }).split(" ")).toContain("disabled:not-aria-busy:bg-disabled");
  });

  it("leaves a busy button its own look: disabled while it works, but not greyed out", () => {
    // A tapped quick reply or a "Creating…" submit is disabled so it cannot fire twice. Marked
    // aria-busy, it keeps its fill instead of reading as the faintest control on the screen.
    for (const variant of variants) expect(buttonVariants({ variant }).split(" "), variant).not.toContain("disabled:text-disabled-foreground");
    for (const variant of ["default", "destructive", "secondary"] as const) expect(buttonVariants({ variant }).split(" ")).not.toContain("disabled:bg-disabled");
  });

  it("leaves focus to the one app-wide ring", () => {
    for (const variant of variants) expect(buttonVariants({ variant })).not.toMatch(/ring-\[3px\]|outline-none/);
  });
});
