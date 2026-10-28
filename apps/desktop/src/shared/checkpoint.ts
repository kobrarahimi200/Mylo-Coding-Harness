export type CheckpointFile = {
  path: string;
  before: string;
  after: string;
  status: "ready" | "conflict" | "unchanged";
  reason?: string;
  created: boolean;
};
export type CheckpointPreview = {
  token: string;
  runId: string | null;
  files: CheckpointFile[];
};
export type RollbackResult = { restored: string[]; conflicts: string[] };
