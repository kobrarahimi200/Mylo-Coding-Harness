import type { AgentEventItem } from "../../../../shared/agent-events";
import type { QuestionRequest } from "../../../../shared/contracts";
import type { AgentMode } from "../../../../shared/harness";
import { harnessState } from "./harness-state";

const CRITERIA_MARKER = "\n\nAcceptance criteria:\n";

export type TaskSummary = {
  request: string;
  criteria?: string | undefined;
  mode?: AgentMode | undefined;
  status: string;
  runId: string;
  changedFiles: string[];
};

/** Read-only view of the submitted task, derived from persisted harness events only. */
export function taskSummary(
  items: AgentEventItem[],
  questions: QuestionRequest[],
  sessionId: string | undefined,
): TaskSummary | undefined {
  const state = harnessState(items, questions, sessionId);
  const task = state.current.findLast(({ event }) => event.type === "harness.task")?.event;
  if (task?.type !== "harness.task") return undefined;
  const [request = "", ...criteria] = task.request.split(CRITERIA_MARKER);
  const changedFiles = [
    ...new Set(
      state.current.flatMap(({ event }) => (event.type === "harness.change" ? [event.path] : [])),
    ),
  ];
  return {
    request,
    criteria: criteria.join(CRITERIA_MARKER) || undefined,
    mode: task.mode,
    status: state.label,
    runId: task.runId,
    changedFiles,
  };
}

export const MODE_LABEL: Record<AgentMode, string> = {
  ask: "Ask",
  plan: "Plan",
  agent: "Agent",
};
