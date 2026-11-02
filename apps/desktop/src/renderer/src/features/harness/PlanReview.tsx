import type { QuestionRequest } from "../../../../shared/contracts";
import { ExecutionPlanCard } from "./ExecutionPlanCard";
import { usePlanApproval } from "./plan-actions";
import type { PlanView } from "./plan-view";

/**
 * The canonical plan surface. Approval is interactive only when `request` is the real pending
 * harness question and this surface owns it; otherwise the same plan is shown read-only.
 */
export function PlanReview({
  view,
  request,
  embedded,
  onError,
}: {
  view: PlanView;
  request?: QuestionRequest | undefined;
  embedded?: boolean;
  onError(message: string): void;
}) {
  const approval = usePlanApproval(request, onError);
  // Keyed by the approval request so a regenerated plan resets local edit state.
  return (
    <ExecutionPlanCard
      key={view.requestId ?? "static"}
      view={view}
      approval={approval}
      embedded={embedded ?? false}
    />
  );
}
