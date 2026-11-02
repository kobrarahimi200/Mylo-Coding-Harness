import { describe, expect, it } from "vitest";
import { describeRunEvent } from "./run-diagnostics";

describe("run diagnostics", () => {
  it("includes session, run, event and timestamp", () => {
    const line = describeRunEvent(
      { type: "run.cancelled", sessionId: "s1", runId: "r1" },
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(line).toContain("session=s1");
    expect(line).toContain("run=r1");
    expect(line).toContain("event=run.cancelled");
    expect(line).toContain("ts=2026-01-01T00:00:00.000Z");
  });

  it("redacts credentials and skips noisy events", () => {
    const line = describeRunEvent({
      type: "run.failed",
      sessionId: "s",
      runId: "r",
      message: "401 with key sk-abcdefghijklmnopqrstuvwxyz123456",
    });
    expect(line).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(describeRunEvent({ type: "agent.started", sessionId: "s" })).toBeUndefined();
  });
});
