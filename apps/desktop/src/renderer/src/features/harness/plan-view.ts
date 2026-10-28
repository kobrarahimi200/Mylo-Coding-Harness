import type { AgentEventItem } from "../../../../shared/agent-events";
import type { QuestionRequest } from "../../../../shared/contracts";
import type { TaskPlan } from "../../../../shared/harness";
import { planTargetFiles } from "../../../../shared/task-plan-text";
import { harnessState } from "./harness-state";

export type PlanStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type PlanTone = PlanStepStatus;

export type PlanStepView = {
  title: string;
  description?: string | undefined;
  /** Only set from authoritative harness.step events (or a rejected plan). */
  status?: PlanStepStatus | undefined;
  detail?: string | undefined;
};

export type PlanView = {
  goal: string;
  approved: boolean;
  steps: PlanStepView[];
  targetFiles: string[];
  overallLabel: string;
  overallTone: PlanTone;
  request?: string | undefined;
  error?: { message: string; raw: string } | undefined;
  plan: TaskPlan;
};

const TERMINAL = new Set(["Completed", "Failed", "Cancelled", "Rejected", "Awaiting final review"]);

export function splitStep(step: string): { title: string; description?: string } {
  const match = /^(.{3,80}?)(?::\s+|\s+[—–-]\s+|\.\s+)(.+)$/s.exec(step);
  return match?.[1] && match[2] ? { title: match[1], description: match[2] } : { title: step };
}

function tone(label: string): PlanTone {
  if (label === "Completed") return "completed";
  if (label === "Failed") return "failed";
  if (label === "Cancelled" || label === "Rejected") return "skipped";
  if (["Planning", "Preparing", "Executing", "Validating", "Correcting"].includes(label))
    return "running";
  return "pending";
}

/** Builds the card model purely from persisted harness events and pending questions. */
export function planView(
  items: AgentEventItem[],
  questions: QuestionRequest[],
  sessionId: string | undefined,
): PlanView | undefined {
  const state = harnessState(items, questions, sessionId);
  const errorEvent = state.current.findLast(
    ({ event }) => event.type === "harness.plan_error",
  )?.event;
  const error =
    errorEvent?.type === "harness.plan_error"
      ? { message: errorEvent.message, raw: errorEvent.raw }
      : undefined;
  const pendingPlan = state.pending.find((q) => q.questions[0]?.plan)?.questions[0]?.plan;
  const plan = pendingPlan ?? state.plan?.plan;
  if (!plan && !error) return undefined;
  const taskEvent = state.current.findLast(({ event }) => event.type === "harness.task")?.event;
  const resolved: TaskPlan = plan ?? { goal: "Plan could not be read", steps: [] };
  const terminal = TERMINAL.has(state.label);
  return {
    goal: resolved.goal,
    plan: resolved,
    approved: pendingPlan ? false : (state.plan?.approved ?? false),
    steps: resolved.steps.map((text, index) => {
      const reported = state.steps.findLast((step) => step.index === index);
      const status: PlanStepStatus | undefined = reported
        ? reported.status
        : state.label === "Rejected"
          ? "skipped"
          : terminal
            ? undefined
            : "pending";
      return { ...splitStep(text), status, detail: reported?.detail };
    }),
    targetFiles: planTargetFiles(resolved),
    overallLabel: state.label,
    overallTone: tone(state.label),
    request: taskEvent?.type === "harness.task" ? taskEvent.request : undefined,
    error: plan ? undefined : error,
  };
}
