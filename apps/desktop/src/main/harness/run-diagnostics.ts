import type { AgentEvent } from "../../shared/contracts";
import { redactSecrets } from "../../shared/task-failure";

const LIFECYCLE = new Set([
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.awaiting_review",
  "run.rejected",
  "harness.task",
  "harness.phase",
  "harness.plan",
  "harness.plan_error",
  "harness.validation",
]);

/** One-line, credential-free description of a lifecycle event, or undefined for noisy events. */
export function describeRunEvent(event: AgentEvent, now = new Date()): string | undefined {
  if (!LIFECYCLE.has(event.type)) return undefined;
  const fields = event as unknown as Record<string, unknown>;
  const parts = [
    `ts=${now.toISOString()}`,
    `session=${String(fields.sessionId ?? "-")}`,
    `run=${String(fields.runId ?? "-")}`,
    `event=${event.type}`,
  ];
  if (typeof fields.phase === "string") parts.push(`phase=${fields.phase}`);
  if (typeof fields.reason === "string") parts.push(`reason=${fields.reason}`);
  if (typeof fields.message === "string") parts.push(`message=${redactSecrets(fields.message)}`);
  return `[run-event] ${parts.join(" ")}`;
}

export function logRunEvent(event: AgentEvent) {
  const line = describeRunEvent(event);
  if (line) console.info(line);
}
