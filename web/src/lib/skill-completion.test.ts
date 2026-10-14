import { applySkillCompletion, detectSkillCompletion, filterSkills, skillCompletionKeyAction } from "./skill-completion";

const skills = [
  { name: "Review code", description: "Audit implementation", invocation: "$review" },
  { name: "Build UI", description: "Apply review feedback", invocation: "$build-ui" },
];

describe("skill completion", () => {
  it("recognizes Codex and Claude prefixes at a caret, including a new line", () => {
    expect(detectSkillCompletion("Please $rev", 11, "$" )).toEqual({ start: 7, end: 11, query: "rev" });
    expect(detectSkillCompletion("Hello\n/", 7, "/")).toEqual({ start: 6, end: 7, query: "" });
    expect(detectSkillCompletion("$review later", 4, "$" )).toEqual({ start: 0, end: 7, query: "rev" });
  });

  it("does not open for embedded symbols, paths or the other provider prefix", () => {
    expect(detectSkillCompletion("cost$review", 11, "$" )).toBeNull();
    expect(detectSkillCompletion("/Users/demo", 11, "/")).toBeNull();
    expect(detectSkillCompletion("/review", 7, "$" )).toBeNull();
    expect(detectSkillCompletion("$(ls", 4, "$" )).toBeNull();
    expect(detectSkillCompletion("$review ", 8, "$" )).toBeNull();
  });

  it("replaces only the current token and retains all surrounding draft text", () => {
    const draft = "Please $review after this\nKeep this line";
    const completion = detectSkillCompletion(draft, 11, "$" )!;
    expect(applySkillCompletion(draft, completion, skills[1]!)).toEqual({ value: "Please $build-ui after this\nKeep this line", cursor: 17 });
    expect(applySkillCompletion("$", { start: 0, end: 1, query: "" }, skills[0]!)).toEqual({ value: "$review ", cursor: 8 });
    const punctuated = "Use $review, then continue";
    expect(applySkillCompletion(punctuated, detectSkillCompletion(punctuated, 8, "$" )!, skills[1]!).value).toBe("Use $build-ui, then continue");
  });

  it("ranks names before descriptions and filters case insensitively", () => {
    expect(filterSkills(skills, "REVIEW")).toEqual(skills);
    expect(filterSkills(skills, "UI")).toEqual([skills[1]]);
    expect(filterSkills(skills, "missing")).toEqual([]);
  });

  it("wraps keyboard selection and leaves unrelated keys untouched", () => {
    expect(skillCompletionKeyAction("ArrowUp", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(skillCompletionKeyAction("ArrowDown", 1, 2)).toEqual({ type: "move", index: 0 });
    expect(skillCompletionKeyAction("Tab", 1, 2)).toEqual({ type: "select", index: 1 });
    expect(skillCompletionKeyAction("Enter", 9, 2)).toEqual({ type: "select", index: 1 });
    expect(skillCompletionKeyAction("Escape", 0, 0)).toEqual({ type: "dismiss" });
    expect(skillCompletionKeyAction("Enter", 0, 0)).toEqual({ type: "none" });
    expect(skillCompletionKeyAction("a", 0, 2)).toEqual({ type: "none" });
  });
});
