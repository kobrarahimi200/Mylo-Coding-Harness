import { useState } from "react";
import type { QuestionRequest } from "../../../../shared/contracts";
import { REPLAN_OPTION, type TaskPlan } from "../../../../shared/harness";
import type { PlanApproval } from "./ExecutionPlanCard";

/** Request ids that were already answered (or are being answered) from this window. */
const answered = new Set<string>();

/**
 * Sends at most one response per approval request. A second click, a second surface or a
 * re-render cannot trigger a duplicate IPC response or a duplicate execution.
 */
export async function respondOnce(
  requestId: string,
  send: () => Promise<unknown>,
): Promise<boolean> {
  if (answered.has(requestId)) return false;
  answered.add(requestId);
  try {
    await send();
    return true;
  } catch (error) {
    answered.delete(requestId);
    throw error;
  }
}

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

function answerPlan(
  request: QuestionRequest,
  plan: TaskPlan,
  selected: string[],
): Promise<boolean> {
  const question = request.questions[0];
  if (!question) return Promise.resolve(false);
  return respondOnce(request.id, () =>
    window.modus.questions.respond({
      requestId: request.id,
      answers: [{ questionId: question.id, selected, custom: planAnswerPayload(plan) }],
      skipped: false,
    }),
  );
}

/** Answers the real harness approval question with the (possibly edited) plan. */
export const approvePlan = (request: QuestionRequest, plan: TaskPlan) =>
  answerPlan(request, plan, []);

/** Asks the harness to regenerate the plan; the user's draft is preserved as input. */
export const replanPlan = (request: QuestionRequest, draft: TaskPlan) =>
  answerPlan(request, draft, [REPLAN_OPTION]);

export const rejectPlan = (request: QuestionRequest) =>
  respondOnce(request.id, () =>
    window.modus.questions.respond({ requestId: request.id, answers: [], skipped: true }),
  );

/** Approval controls bound to the pending harness question; undefined when none is pending. */
export function usePlanApproval(
  request: QuestionRequest | undefined,
  onError: (message: string) => void,
): PlanApproval | undefined {
  const [submitted, setSubmitted] = useState<string>();
  if (!request) return undefined;
  const run = (action: () => Promise<boolean>) => {
    setSubmitted(request.id);
    void action().catch((error: unknown) => {
      setSubmitted(undefined);
      onError(error instanceof Error ? error.message : String(error));
    });
  };
  return {
    // Stays busy until the broker removes the question; never re-enables for the same request.
    busy: submitted === request.id || answered.has(request.id),
    onApprove: (plan) => run(() => approvePlan(request, plan)),
    onReject: () => run(() => rejectPlan(request)),
    ...(request.questions[0]?.allowReplan
      ? { onReplan: (draft: TaskPlan) => run(() => replanPlan(request, draft)) }
      : {}),
  };
}
