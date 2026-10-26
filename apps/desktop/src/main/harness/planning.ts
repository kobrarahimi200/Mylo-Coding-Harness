import type { AgentEvent } from "../../shared/contracts";
import type { TaskPlan } from "../../shared/harness";
import { requestQuestions } from "../interaction/question-broker";
import { auditHarnessEvent } from "./audit-log";

export type { TaskPlan } from "../../shared/harness";

export function normalizeTaskPlan(plan: TaskPlan): TaskPlan {
  const goal = plan.goal.trim();
  const steps = [...new Set(plan.steps.map((step) => step.trim()).filter(Boolean))];
  if (!goal) throw new Error("A task plan needs a non-empty goal.");
  if (steps.length === 0) throw new Error("A task plan needs at least one step.");
  return { goal, steps };
}

export async function approveTaskPlan(
  proposed: TaskPlan,
  sessionId: string,
  emit: (event: AgentEvent) => void,
): Promise<TaskPlan> {
  emit({ type: "harness.plan", sessionId, plan: proposed, approved: false });
  emit({
    type: "harness.phase",
    sessionId,
    phase: "approval",
    detail: "Review the repository plan before execution.",
  });
  const edited = await requestQuestions({
    sessionId,
    emit,
    questions: [
      {
        id: "task-plan",
        header: "Review and edit the task plan",
        detail:
          "Review the goal and steps before Pi executes this task. Close the dialog to reject.",
        prefill: JSON.stringify(proposed, null, 2),
        plan: proposed,
        options: [],
      },
    ],
  });
  if (edited.skipped) {
    await auditHarnessEvent({ type: "plan", sessionId, outcome: "rejected" });
    throw new Error("Task plan rejected.");
  }
  const plan = parseTaskPlan(edited.answers[0]?.custom ?? "");
  const decision = await requestQuestions({
    sessionId,
    emit,
    questions: [
      {
        id: "approve-plan",
        header: "Approve task execution?",
        detail: `${plan.goal}\n\n${plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
        options: [{ label: "Approve plan" }, { label: "Reject" }],
      },
    ],
  });
  const approved = !decision.skipped && decision.answers[0]?.selected[0] === "Approve plan";
  await auditHarnessEvent({
    type: "plan",
    sessionId,
    outcome: approved ? "approved" : "rejected",
    detail: JSON.stringify(plan),
  });
  if (!approved) throw new Error("Task plan rejected.");
  emit({ type: "harness.plan", sessionId, plan, approved: true });
  emit({
    type: "extension.notice",
    sessionId,
    message: `Approved plan: ${JSON.stringify(plan)}`,
    level: "info",
  });
  return plan;
}

export function parseTaskPlan(text: string): TaskPlan {
  const plan: unknown = JSON.parse(
    text
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, ""),
  );
  if (
    !plan ||
    typeof plan !== "object" ||
    !("goal" in plan) ||
    !("steps" in plan) ||
    typeof plan.goal !== "string" ||
    !Array.isArray(plan.steps) ||
    !plan.steps.every((step: unknown) => typeof step === "string")
  ) {
    throw new Error("Plan must contain a goal string and an array of step strings.");
  }
  return normalizeTaskPlan({ goal: plan.goal, steps: plan.steps });
}
