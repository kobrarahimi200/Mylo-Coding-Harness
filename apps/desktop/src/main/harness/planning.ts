import type { AgentEvent } from "../../shared/contracts";
import { type AgentMode, REPLAN_OPTION, type TaskPlan } from "../../shared/harness";
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

export type PlanDecision =
  | { kind: "approved"; plan: TaskPlan }
  /** The user asked for a new plan; `draft` carries their latest edits. */
  | { kind: "replan"; draft: TaskPlan };

export async function reviewTaskPlan(
  proposed: TaskPlan,
  sessionId: string,
  emit: (event: AgentEvent) => void,
  mode: AgentMode = "agent",
  allowReplan = false,
): Promise<PlanDecision> {
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
        header: "Approve implementation plan",
        detail:
          mode === "plan"
            ? "Edit the goal and steps, then approve to keep this plan. Nothing is executed in Plan mode. Reject to discard it."
            : "Edit the goal and steps, then approve the plan to start execution. Reject to discard it.",
        prefill: JSON.stringify(proposed, null, 2),
        plan: proposed,
        ...(allowReplan ? { allowReplan: true } : {}),
        options: [],
      },
    ],
  });
  if (edited.skipped) {
    await auditHarnessEvent({ type: "plan", sessionId, outcome: "rejected" });
    throw new TaskRejectedError("plan", "Task plan rejected.");
  }
  const answer = edited.answers[0];
  const plan = parseTaskPlan(answer?.custom ?? "");
  if (allowReplan && answer?.selected[0] === REPLAN_OPTION) {
    await auditHarnessEvent({
      type: "plan",
      sessionId,
      outcome: "replan",
      detail: JSON.stringify(plan),
    });
    return { kind: "replan", draft: plan };
  }
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
  return { kind: "approved", plan };
}

export async function approveTaskPlan(
  proposed: TaskPlan,
  sessionId: string,
  emit: (event: AgentEvent) => void,
  mode: AgentMode = "agent",
): Promise<TaskPlan> {
  const decision = await reviewTaskPlan(proposed, sessionId, emit, mode, false);
  if (decision.kind !== "approved")
    throw new Error("Plan approval returned an unexpected re-plan.");
  return decision.plan;
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
