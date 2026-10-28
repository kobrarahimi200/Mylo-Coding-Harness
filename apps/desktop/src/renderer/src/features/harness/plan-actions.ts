import { useState } from "react";
import type { QuestionRequest } from "../../../../shared/contracts";
import type { TaskPlan } from "../../../../shared/harness";
import type { PlanApproval } from "./ExecutionPlanCard";

export function pendingPlanQuestion(
  questions: QuestionRequest[],
  sessionId: string | undefined,
): QuestionRequest | undefined {
  return questions.find((q) => q.sessionId === sessionId && q.questions[0]?.plan);
}

export function planAnswerPayload(plan: TaskPlan): string {
  return JSON.stringify({
    goal: plan.goal.trim(),
    steps: plan.steps.map((step) => step.trim()).filter(Boolean),
  });
}

/** Answers the real harness approval question; no UI-only approval state. */
export async function approvePlan(request: QuestionRequest, plan: TaskPlan): Promise<void> {
  const question = request.questions[0];
  if (!question) return;
  await window.modus.questions.respond({
    requestId: request.id,
    answers: [{ questionId: question.id, selected: [], custom: planAnswerPayload(plan) }],
    skipped: false,
  });
}

export async function rejectPlan(request: QuestionRequest): Promise<void> {
  await window.modus.questions.respond({ requestId: request.id, answers: [], skipped: true });
}

/** Approval controls bound to the pending harness question; undefined when none is pending. */
export function usePlanApproval(
  request: QuestionRequest | undefined,
  onError: (message: string) => void,
  onReplan?: () => void,
): PlanApproval | undefined {
  const [busy, setBusy] = useState(false);
  if (!request) return undefined;
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action()
      .catch((error: unknown) => onError(String(error)))
      .finally(() => setBusy(false));
  };
  return {
    busy,
    onApprove: (plan) => run(() => approvePlan(request, plan)),
    onReject: () => run(() => rejectPlan(request)),
    ...(onReplan ? { onReplan: () => run(() => rejectPlan(request).then(onReplan)) } : {}),
  };
}
