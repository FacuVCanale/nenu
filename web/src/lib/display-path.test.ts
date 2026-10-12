import { describe, expect, it } from "vitest";

import { displayPath } from "./display-path";

const join = (p: { dir: string; base: string }) => p.dir + p.base;

describe("displayPath", () => {
  it("shows a path under the pane's cwd relative to it", () => {
    expect(displayPath("/home/fran/repo/web/src/index.css", "/home/fran/repo")).toEqual({ dir: "web/src/", base: "index.css" });
    expect(displayPath("/home/fran/repo/web/src/index.css", "/home/fran/repo/")).toEqual({ dir: "web/src/", base: "index.css" });
    expect(displayPath("/home/fran/repo/README.md", "/home/fran/repo")).toEqual({ dir: "", base: "README.md" });
  });

  it("does not treat a sibling directory that shares the cwd's prefix as inside it", () => {
    expect(join(displayPath("/home/fran/repo2/a.ts", "/home/fran/repo"))).toBe("~/repo2/a.ts");
  });

  it("keeps the basename whole and gives up leading folders first when the path is long", () => {
    const tmp = "/var/folders/zd/7_1tqb1n5s7fbmsk0dqnzsk40000gn/T/nenu-e2e-kSVt1n/web/src/hooks/use-app-viewport.ts";
    const shown = displayPath(tmp, "/Users/fran/collie", 32);
    expect(shown.base).toBe("use-app-viewport.ts");
    expect(shown.dir).toBe("…/src/hooks/");
    expect(join(shown).length).toBeLessThanOrEqual(32);
  });

  it("never cuts the basename, even when it alone is longer than the room", () => {
    const name = "a-very-long-generated-report-name-that-does-not-fit.html";
    expect(displayPath(`/srv/out/${name}`, "/home/fran", 20).base).toBe(name);
  });

  it("leaves a path that is already relative as it is", () => {
    expect(displayPath("web/src/index.css", "/home/fran/repo")).toEqual({ dir: "web/src/", base: "index.css" });
    expect(displayPath("notes.md")).toEqual({ dir: "", base: "notes.md" });
  });
});
