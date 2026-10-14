import { describe, expect, it } from "vitest";
import { composerSuggestions, detectComposerCompletion } from "./composer-suggestions";
import { commandsFor } from "./agent-commands";

const skills = [
  { name: "build-agents", invocation: "$build-agents", description: "Build and test agents" },
  { name: "deploy", invocation: "/deploy", description: "Deploy this project" },
  { name: "model", invocation: "/model", description: "A colliding custom skill" },
];

describe("provider-aware composer suggestions", () => {
  it("Codex slash commands are its command catalogue, while dollar references only its installed skills", () => {
    const commands = composerSuggestions("codex", "/", skills);
    expect(commands.map((row) => row.invocation)).toEqual(commandsFor("codex").map((row) => row.command));
    expect(commands.every((row) => row.kind === "command")).toBe(true);
    expect(commands.some((row) => row.invocation === "/config")).toBe(false);
    expect(composerSuggestions("codex", "$", skills)).toEqual([{ ...skills[0], kind: "skill" }]);
  });

  it("Claude slash merges its commands and skills with one row per exact invocation", () => {
    const rows = composerSuggestions("claude", "/", [...skills, skills[1]!]);
    expect(rows.filter((row) => row.invocation === "/model")).toEqual([expect.objectContaining({ kind: "command" })]);
    expect(rows.filter((row) => row.invocation === "/deploy")).toEqual([{ ...skills[1], kind: "skill" }]);
    expect(rows.some((row) => row.invocation === "/config")).toBe(true);
    expect(rows.some((row) => row.invocation === "/personality")).toBe(false);
    expect(rows.some((row) => row.invocation.startsWith("$"))).toBe(false);
    expect(composerSuggestions("claude", "$", skills)).toEqual([]);
  });

  it("uses the existing scoped operator replacement without leaking another provider's commands", () => {
    const mine = [
      { command: "/custom-codex", description: "My command", takesArg: true, argHint: "", agent: "codex" },
      { command: "/custom-claude", description: "Other command", takesArg: true, argHint: "", agent: "claude" },
    ];
    expect(composerSuggestions("codex", "/", skills, mine).map((row) => row.invocation)).toEqual(["/custom-codex"]);
    expect(composerSuggestions("claude", "/", skills, mine).map((row) => row.invocation)).toEqual(["/custom-claude", "/deploy", "/model"]);
  });

  it("does not offer invalid invocations, other triggers or unsupported providers", () => {
    const invalid = [{ name: "bad", description: "", invocation: "$review\n/model" }, { name: "path", description: "", invocation: "$../file" }];
    expect(composerSuggestions("codex", "$", invalid)).toEqual([]);
    expect(composerSuggestions("unknown", "/", skills)).toEqual([]);
    expect(composerSuggestions("constructor", "/", skills)).toEqual([]);
  });

  it("recognizes both Codex triggers, only Claude slash and the existing family aliases", () => {
    expect(detectComposerCompletion("/", 1, "codex")).toMatchObject({ trigger: "/", query: "" });
    expect(detectComposerCompletion("Use $build", 10, "codex-cli")).toMatchObject({ trigger: "$", query: "build" });
    expect(detectComposerCompletion("/con", 4, "Claude-Code")).toMatchObject({ trigger: "/", query: "con" });
    expect(detectComposerCompletion("$", 1, "claude")).toBeNull();
  });

  it("does not suggest a native slash command inside ordinary prose or a filesystem path", () => {
    expect(detectComposerCompletion("Explain /mod", 12, "codex")).toBeNull();
    expect(detectComposerCompletion("/Users/demo", 11, "claude")).toBeNull();
    expect(detectComposerCompletion("/", 1, "bash")).toBeNull();
  });
});
