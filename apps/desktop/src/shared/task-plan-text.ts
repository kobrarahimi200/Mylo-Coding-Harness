import type { TaskPlan } from "./harness";

export function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
}

/** True when the whole text is a harness planning payload rather than conversation. */
export function isPlanJsonText(text: string): boolean {
  const body = stripJsonFence(text);
  if (!body.startsWith("{")) return false;
  try {
    const value: unknown = JSON.parse(body);
    return (
      typeof value === "object" &&
      value !== null &&
      "goal" in value &&
      typeof value.goal === "string" &&
      "steps" in value &&
      Array.isArray(value.steps)
    );
  } catch {
    return false;
  }
}

export function planToMarkdown(plan: TaskPlan): string {
  return [`## ${plan.goal}`, "", ...plan.steps.map((step, index) => `${index + 1}. ${step}`)].join(
    "\n",
  );
}

const FILE_PATTERN =
  /(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,7})(?=$|[\s`'")\],;:])/g;

/** Best-effort list of files mentioned in plan text; never invented. */
export function planTargetFiles(plan: TaskPlan): string[] {
  const found = new Set<string>();
  for (const text of [plan.goal, ...plan.steps])
    for (const match of text.matchAll(FILE_PATTERN)) {
      const path = match[1];
      if (path && /[A-Za-z]/.test(path) && !/^\d+\.\d+$/.test(path)) found.add(path);
    }
  return [...found];
}
