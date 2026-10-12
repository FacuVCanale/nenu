import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dialogOnScreen, toInteraction } from "./interactions.ts";

// The web card tells a preview question from any other question by its family: a preview is served
// with the agent as family, every prompt question with "select" (isPreviewQuestion in
// web/src/components/question-card.tsx). Home answers a question in one tap but sends a preview to its
// thread, so this convention is load-bearing until the bridge marks a preview outright. Pinned over
// the whole fixture corpus, in both directions.

const ROOT = join(import.meta.dir, "..");
const CORPUS: Array<[string, (file: string) => string]> = [
  [join(ROOT, "web/src/fixtures/panes"), (file) => (file.startsWith("claude-lab--") ? "claude" : file.split("--")[0]!)],
  [join(ROOT, "web/src/lib/harness/claude/fixtures"), () => "claude"],
  [join(ROOT, "web/src/lib/harness/codex/fixtures"), () => "codex"],
];

describe("a question's family says whether it is a preview", () => {
  const seen = { preview: 0, select: 0 };
  for (const [dir, agentOf] of CORPUS) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
      const agent = agentOf(file);
      const dialog = dialogOnScreen(agent, readFileSync(join(dir, file), "utf8"));
      if (!dialog) continue;
      const { interaction } = toInteraction({ paneId: "p", agent }, dialog, 0, [], 0);
      if (interaction.kind !== "question") continue;
      const preview = dialog.kind === "preview-select";
      seen[preview ? "preview" : "select"]++;
      test(file, () => {
        if (preview) expect(interaction.family).not.toBe("select");
        else expect(interaction.family).toBe("select");
      });
    }
  }
  test("the corpus holds both kinds", () => {
    expect(seen.preview).toBeGreaterThan(0);
    expect(seen.select).toBeGreaterThan(0);
  });
});
