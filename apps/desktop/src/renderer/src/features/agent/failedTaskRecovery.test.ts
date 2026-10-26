import { expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { failedTaskRecovery } from "./failedTaskRecovery";

const events = (values: AgentEvent[]) =>
  values.map((event, index) => ({ id: String(index), event }));
const request: AgentEvent[] = [
  {
    type: "message.started",
    sessionId: "s",
    messageId: "u",
    role: "user",
    contextItems: [{ type: "file", path: "/project/app.ts" }],
    skills: [{ name: "review", path: "/project/.pi/skills/review/SKILL.md" }],
  },
  { type: "message.delta", sessionId: "s", messageId: "u", delta: "Create a working app" },
  { type: "run.started", delivery: "normal", sessionId: "s", runId: "r" },
  { type: "run.failed", sessionId: "s", runId: "r", message: "No credits remaining" },
];
it("keeps the original failed request and context ready for retry", () => {
  expect(failedTaskRecovery(events(request))).toMatchObject({
    message: "Create a working app",
    context: [{ type: "file", path: "/project/app.ts" }],
    skills: [{ name: "review" }],
    error: "No credits remaining",
  });
});
it("does not offer the previous failed request during a newer run or after success", () => {
  expect(
    failedTaskRecovery(
      events([
        ...request,
        { type: "run.started", delivery: "normal", sessionId: "s", runId: "new" },
      ]),
    ),
  ).toBeUndefined();
  expect(
    failedTaskRecovery(
      events([...request, { type: "run.completed", sessionId: "s", runId: "new" }]),
    ),
  ).toBeUndefined();
});
