import type { AgentEvent } from "../../shared/contracts";
import type { AgentMode, TaskPlan } from "../../shared/harness";
import { stripJsonFence } from "../../shared/task-plan-text";
import { requestQuestions } from "../interaction/question-broker";
import { auditHarnessEvent } from "./audit-log";
import { TaskRejectedError } from "./task-lifecycle";

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
  mode: AgentMode = "agent",
): Promise<TaskPlan> {
  emit({ type: "harness.plan", sessionId, plan: proposed, approved: false });
  emit({
    type: "harness.phase",
    sessionId,
    phase: "approval",
    detail:
      mode === "plan"
        ? "Review the plan. No files will be changed in Plan mode."
        : "Review the repository plan before execution.",
  });
  const edited = await requestQuestions({
    sessionId,
    emit,
    questions: [
      {
        id: "task-plan",
        header: "Review and edit the task plan",
        detail:
          mode === "plan"
            ? "Edit the goal and steps, then approve to keep this plan. Nothing is executed in Plan mode. Close the dialog to reject."
            : "Edit the goal and steps, then approve the plan to start execution. Close the dialog to reject.",
        prefill: JSON.stringify(proposed, null, 2),
        plan: proposed,
        options: [],
      },
    ],
  });
  if (edited.skipped) {
    await auditHarnessEvent({ type: "plan", sessionId, outcome: "rejected" });
    throw new TaskRejectedError("plan", "Task plan rejected.");
  }
  const plan = parseTaskPlan(edited.answers[0]?.custom ?? "");
  await auditHarnessEvent({
    type: "plan",
    sessionId,
    outcome: "approved",
    detail: JSON.stringify(plan),
  });
  emit({ type: "harness.plan", sessionId, plan, approved: true });
  emit({
    type: "extension.notice",
    sessionId,
    message: `Plan approved · ${plan.goal} · ${plan.steps.length} steps`,
    level: "info",
  });
  return plan;
}

export function parseTaskPlan(text: string): TaskPlan {
  const plan: unknown = JSON.parse(stripJsonFence(text));
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
