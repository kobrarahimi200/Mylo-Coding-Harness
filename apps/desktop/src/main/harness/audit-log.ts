import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type HarnessAuditEvent = {
  type: string;
  sessionId: string;
  toolName?: string;
  outcome?: string;
  detail?: string;
  attempt?: number;
};

export async function auditHarnessEvent(event: HarnessAuditEvent): Promise<void> {
  const { app } = await import("electron");
  const directory = join(app.getPath("userData"), "harness");
  await mkdir(directory, { recursive: true });
  await appendFile(
    join(directory, "audit.jsonl"),
    `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`,
    "utf8",
  );
}
