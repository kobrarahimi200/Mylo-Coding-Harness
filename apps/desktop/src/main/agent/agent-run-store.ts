import { randomUUID } from "node:crypto";
import type { AgentRunInfo, AgentRunStatus } from "../../shared/contracts";
import type { AgentMode } from "../../shared/harness";
import type { TaskFailure } from "../../shared/task-failure";
import { readAgentHistory } from "./agent-history";

const runs = new Map<string, AgentRunInfo>();
export function createAgentRun(input: {
  sessionId: string;
  prompt: string;
  userMessageId?: string;
  model?: string;
  mode?: AgentMode;
}): AgentRunInfo {
  const run: AgentRunInfo = {
    ...input,
    id: randomUUID(),
    status: "running",
    startedAt: new Date().toISOString(),
  };
  runs.set(run.id, run);
  return run;
}
export function updateAgentRunStatus(
  id: string,
  status: AgentRunStatus,
  error?: string,
  failure?: TaskFailure,
): AgentRunInfo | undefined {
  const run = runs.get(id);
  if (!run) return undefined;
  run.status = status;
  run.completedAt = new Date().toISOString();
  if (error) run.error = error;
  if (failure) run.failure = failure;
  return run;
}
export function getAgentRun(id: string): AgentRunInfo | undefined {
  return runs.get(id);
}
export function getActiveAgentRun(sessionId: string): AgentRunInfo | undefined {
  return [...runs.values()].find((run) => run.sessionId === sessionId && run.status === "running");
}
export function listAgentRuns(sessionId: string): AgentRunInfo[] {
  const active = getActiveAgentRun(sessionId);
  return [
    ...readAgentHistory(sessionId).runs.filter(
      (run) => !active || run.userMessageId !== active.userMessageId,
    ),
    ...(active ? [active] : []),
  ];
}
export function releaseAgentRuns(sessionId: string): void {
  for (const [id, run] of runs) if (run.sessionId === sessionId) runs.delete(id);
}
