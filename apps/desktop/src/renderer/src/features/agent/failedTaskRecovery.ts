import type { AgentEventItem } from "../../../../shared/agent-events";
import { classifyFailure, type TaskFailure } from "../../../../shared/task-failure";

/** Neutral end states that are neither failures nor completions. */
export function reviewOutcome(
  items: AgentEventItem[],
): { kind: "awaiting_review" | "rejected"; reason?: "plan" | "review" } | undefined {
  const last = items.findLast(({ event }) =>
    [
      "run.started",
      "run.completed",
      "run.failed",
      "run.cancelled",
      "run.awaiting_review",
      "run.rejected",
    ].includes(event.type),
  )?.event;
  if (last?.type === "run.awaiting_review") return { kind: "awaiting_review" };
  if (last?.type === "run.rejected") return { kind: "rejected", reason: last.reason };
  return undefined;
}

/** Retry the actual user input, preserving context and attachments, never the internal planning prompt. */
export function failedTaskRecovery(items: AgentEventItem[]) {
  const failureIndex = items.findLastIndex(
    ({ event }) => event.type === "run.failed" || event.type === "runtime.error",
  );
  const failure = items[failureIndex]?.event;
  if (!failure || (failure.type !== "run.failed" && failure.type !== "runtime.error"))
    return undefined;
  if (
    items
      .slice(failureIndex + 1)
      .some(
        ({ event }) =>
          event.type === "run.started" ||
          event.type === "run.completed" ||
          event.type === "run.cancelled" ||
          event.type === "run.awaiting_review" ||
          event.type === "run.rejected",
      )
  )
    return undefined;
  const start = items
    .slice(0, failureIndex)
    .findLast(({ event }) => event.type === "message.started" && event.role === "user")?.event;
  if (start?.type !== "message.started") return undefined;
  const message = items
    .filter(({ event }) => event.type === "message.delta" && event.messageId === start.messageId)
    .map(({ event }) => (event.type === "message.delta" ? event.delta : ""))
    .join("");
  if (!message.trim() && !start.attachments?.length) return undefined;
  return {
    message,
    context: start.contextItems ?? [],
    attachments: start.attachments,
    skills: start.skills,
    error: failure.message,
    failure:
      (failure.type === "run.failed" ? failure.failure : undefined) ??
      classifyFailure(failure.message),
  } satisfies { failure: TaskFailure } & Record<string, unknown>;
}
