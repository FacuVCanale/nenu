import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { declarations } from "@/test/css-rules";

// The navigation's rows, where a contract fails silently: jsdom compiles no stylesheet, so these read
// the declared values and the bench looks at the result (redesign-shots/sheet-system).

const css = readFileSync(resolve(import.meta.dirname, "nav.css"), "utf8");
const LAYER = "@layer components";

describe("a chat's row that can't be opened", () => {
  // An unreachable session in the Sessions sheet: its name went grey while "Unreachable" under it
  // kept the muted ink, so the state outshone the name.
  it("draws its name and the line under it in the disabled ink, the line never louder than the name", () => {
    expect(declarations(css, "button.nav-pane:disabled", [LAYER]).color).toBe("var(--disabled-foreground)");
    expect(declarations(css, "button.nav-pane:disabled .nav-pane-detail", [LAYER]).color).toBe("inherit");
  });

  it("takes no hover fill, since there is nothing to open", () => {
    expect(declarations(css, "button.nav-pane:disabled:hover", [LAYER, "@media (hover: hover)"]).background).toBe("none");
  });
});
