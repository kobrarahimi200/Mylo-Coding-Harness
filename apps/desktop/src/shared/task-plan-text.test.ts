import { describe, expect, it } from "vitest";
import { isPlanJsonText, planTargetFiles, planToMarkdown } from "./task-plan-text";

const plan = {
  goal: "Create mylo-test.js",
  steps: ["Wait for approval", "Create the file src/mylo-test.js", "Run validation"],
};

describe("task plan text", () => {
  it("recognises planning JSON, fenced or bare", () => {
    expect(isPlanJsonText(JSON.stringify(plan))).toBe(true);
    expect(isPlanJsonText(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``)).toBe(true);
  });

  it("does not treat ordinary conversation or unrelated JSON as a plan", () => {
    expect(isPlanJsonText("Here is my plan: do things")).toBe(false);
    expect(isPlanJsonText('{"name":"package"}')).toBe(false);
    expect(isPlanJsonText('{"goal":"x","steps":')).toBe(false);
  });

  it("renders Markdown with numbered steps", () => {
    expect(planToMarkdown(plan)).toBe(
      "## Create mylo-test.js\n\n1. Wait for approval\n2. Create the file src/mylo-test.js\n3. Run validation",
    );
  });

  it("lists only files that the plan text mentions", () => {
    expect(planTargetFiles(plan)).toEqual(["mylo-test.js", "src/mylo-test.js"]);
    expect(planTargetFiles({ goal: "Tidy up", steps: ["Version 1.2 notes"] })).toEqual([]);
  });
});
