import type { TaskFailure } from "../../shared/task-failure";

/** A deliberate human decision (declined plan or result). It is not a failure and never retried. */
export class TaskRejectedError extends Error {
  constructor(
    readonly reason: "plan" | "review",
    message: string,
  ) {
    super(message);
    this.name = "TaskRejectedError";
  }
}

/** A failure whose category is already known, such as a failed provider preflight. */
export class TaskFailureError extends Error {
  constructor(readonly failure: TaskFailure) {
    super(failure.message);
    this.name = "TaskFailureError";
  }
}

export type FinalReviewDecision = "accepted" | "manual_review";

export function finalReviewDecision(review: {
  skipped: boolean;
  answers: Array<{ selected: string[] }>;
}): FinalReviewDecision {
  return !review.skipped && review.answers[0]?.selected[0] === "Accept result"
    ? "accepted"
    : "manual_review";
}
