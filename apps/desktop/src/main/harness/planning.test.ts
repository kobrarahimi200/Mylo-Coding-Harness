import { expect, it } from "vitest";
import { normalizeTaskPlan, parseTaskPlan } from "./planning";

it("normalizes a repository-specific plan produced by Pi", () => {
  expect(
    parseTaskPlan(
      '```json\n{"goal":" Fix login ","steps":["Inspect src/auth.ts","Run npm test"]}\n```',
    ),
  ).toEqual({ goal: "Fix login", steps: ["Inspect src/auth.ts", "Run npm test"] });
});

it("rejects empty plans and normalizes edited steps", () => {
  expect(() => normalizeTaskPlan({ goal: "  ", steps: ["Test"] })).toThrow("non-empty goal");
  expect(normalizeTaskPlan({ goal: " Goal ", steps: [" Step ", " ", "Test"] })).toEqual({
    goal: "Goal",
    steps: ["Step", "Test"],
  });
  expect(() => normalizeTaskPlan({ goal: "Goal", steps: [" "] })).toThrow("at least one step");
});

it("validates human-edited plan structures", () => {
  expect(() => parseTaskPlan('{"goal":"Fix","steps":[3]}')).toThrow("array of step strings");
  expect(() => parseTaskPlan('{"goal":"Fix","steps":[]}')).toThrow("at least one step");
  expect(parseTaskPlan('{"goal":" Fix ","steps":[" Test "]}')).toEqual({
    goal: "Fix",
    steps: ["Test"],
  });
});
