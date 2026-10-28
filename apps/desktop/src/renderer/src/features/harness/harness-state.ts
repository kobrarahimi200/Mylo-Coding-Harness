import type { AgentEventItem } from "../../../../shared/agent-events";
import type { QuestionRequest } from "../../../../shared/contracts";
export function currentTaskItems(items: AgentEventItem[]): AgentEventItem[] {
  let start = items.findLastIndex(({ event }) => event.type === "harness.task");
  if (start < 0) start = items.findLastIndex(({ event }) => event.type === "run.started");
  return items.slice(Math.max(0, start));
}
export function harnessState(
  items: AgentEventItem[],
  questions: QuestionRequest[],
  sessionId: string | undefined,
) {
  const current = currentTaskItems(items),
    pending = questions.filter((q) => q.sessionId === sessionId);
  const phase = current.findLast(({ event }) => event.type === "harness.phase")?.event;
  const terminal = current.findLastIndex(({ event }) =>
    [
      "run.failed",
      "run.cancelled",
      "run.completed",
      "run.awaiting_review",
      "run.rejected",
    ].includes(event.type),
  );
  const phaseIndex = current.findLastIndex(({ event }) => event.type === "harness.phase");
  let label: string =
    phase?.type === "harness.phase"
      ? ({
          planning: "Planning",
          approval: "Awaiting approval",
          executing: "Executing",
          validating: "Validating",
          correcting: "Correcting",
          review: "Awaiting final review",
          awaiting_review: "Awaiting final review",
          rejected: "Rejected",
          completed: "Completed",
          failed: "Failed",
          cancelled: "Cancelled",
        }[phase.phase] ?? "Idle")
      : "Idle";
  if (
    terminal > phaseIndex &&
    (!phase || !(current[terminal]?.event as { runId?: string }).runId?.startsWith("run:"))
  ) {
    const e = current[terminal]?.event;
    label =
      e?.type === "run.cancelled"
        ? "Cancelled"
        : e?.type === "run.failed"
          ? "Failed"
          : e?.type === "run.awaiting_review"
            ? "Awaiting final review"
            : e?.type === "run.rejected"
              ? "Rejected"
              : "Completed";
  }
  if (pending.length) label = "Awaiting approval";
  const statusIndex = current.findLastIndex(({ event }) => event.type === "session.status");
  const status = current[statusIndex]?.event;
  if (
    !pending.length &&
    statusIndex > phaseIndex &&
    statusIndex > terminal &&
    status?.type === "session.status" &&
    status.status.type !== "idle"
  )
    label = "Preparing";
  const busy =
    pending.length > 0 ||
    [
      "Planning",
      "Preparing",
      "Executing",
      "Validating",
      "Correcting",
      "Awaiting approval",
    ].includes(label) ||
    (label === "Awaiting final review" &&
      phase?.type === "harness.phase" &&
      phase.phase === "review");
  const plan = current.findLast(({ event }) => event.type === "harness.plan")?.event;
  const steps = current
    .filter(({ event }) => event.type === "harness.step")
    .map((i) => i.event)
    .filter((e) => e.type === "harness.step");
  const activeStep = steps.findLast(
    (step, index) =>
      step.status === "running" &&
      !steps.slice(index + 1).some((next) => next.index === step.index),
  );
  const tool = current.findLast(({ event }) => event.type === "tool.started")?.event;
  const toolRunning =
    tool?.type === "tool.started" &&
    !current.some(
      ({ event }) => event.type === "tool.ended" && event.toolCallId === tool.toolCallId,
    );
  return {
    current,
    pending,
    phase,
    label,
    busy,
    plan: plan?.type === "harness.plan" ? plan : undefined,
    steps,
    activeStep: busy ? activeStep : undefined,
    tool: tool?.type === "tool.started" ? tool : undefined,
    toolRunning,
  };
}
