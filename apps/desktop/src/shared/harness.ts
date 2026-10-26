export type TaskPlan = { goal: string; steps: string[] };
export type HarnessPhase =
  | "planning"
  | "approval"
  | "executing"
  | "validating"
  | "correcting"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";
export type HarnessEvent =
  | { type: "harness.change"; sessionId: string; path: string; before: string; after: string }
  | { type: "harness.phase"; sessionId: string; phase: HarnessPhase; detail: string }
  | { type: "harness.plan"; sessionId: string; plan: TaskPlan; approved: boolean }
  | {
      type: "harness.validation";
      sessionId: string;
      attempt: number;
      label: string;
      status: "running" | "passed" | "failed" | "skipped";
      output: string;
      exitCode: number | null;
    };
