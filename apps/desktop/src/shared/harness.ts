export type TaskPlan = { goal: string; steps: string[] };
export type ValidationStatus = "running" | "passed" | "failed" | "skipped" | "not_configured";
export function validationStatusLabel(status: ValidationStatus): string {
  return status === "not_configured" ? "NOT CONFIGURED" : status.toUpperCase();
}
export type AgentMode = "ask" | "plan" | "agent";
export const AGENT_MODES: readonly AgentMode[] = ["ask", "plan", "agent"];
export type HarnessPhase =
  | "planning"
  | "approval"
  | "executing"
  | "validating"
  | "correcting"
  | "review"
  | "awaiting_review"
  | "rejected"
  | "completed"
  | "failed"
  | "cancelled";
export type HarnessEvent =
  | { type: "harness.rollback"; sessionId: string; restored: string[]; conflicts: string[] }
  | {
      type: "harness.task";
      sessionId: string;
      runId: string;
      request: string;
      startedAt: string;
      mode?: AgentMode;
    }
  | {
      type: "harness.step";
      sessionId: string;
      index: number;
      status: "running" | "completed" | "failed";
      detail: string;
    }
  | {
      type: "harness.skills";
      sessionId: string;
      skills: Array<{ name: string; description: string; path: string; source: string }>;
    }
  | { type: "harness.change"; sessionId: string; path: string; before: string; after: string }
  | { type: "harness.phase"; sessionId: string; phase: HarnessPhase; detail: string }
  | { type: "harness.plan"; sessionId: string; plan: TaskPlan; approved: boolean }
  | { type: "harness.plan_error"; sessionId: string; message: string; raw: string }
  | {
      type: "harness.validation";
      sessionId: string;
      attempt: number;
      label: string;
      status: ValidationStatus;
      output: string;
      exitCode: number | null;
    };
