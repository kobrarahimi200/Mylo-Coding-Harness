import type { AgentEventItem } from "../../../../shared/agent-events";

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
          event.type === "run.cancelled",
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
  };
}
