import { describe, expect, it } from "vitest";
import {
  failedTaskRecovery,
  reviewOutcome,
} from "../renderer/src/features/agent/failedTaskRecovery";
import { harnessState } from "../renderer/src/features/harness/harness-state";
import type { AgentEventItem } from "./agent-events";
import type { AgentEvent } from "./contracts";
import { latestRunId, scopeToLatestRun } from "./run-scope";

let n = 0;
const item = (event: AgentEvent): AgentEventItem => ({
  id: `e${n++}`,
  event,
  createdAt: "2026-01-01T00:00:00Z",
});
const started = (runId: string): AgentEventItem[] => [
  item({ type: "message.started", sessionId: "s", messageId: `m${runId}`, role: "user" }),
  item({ type: "message.delta", sessionId: "s", messageId: `m${runId}`, delta: "do it" }),
  item({ type: "run.started", sessionId: "s", runId, delivery: "normal" }),
  item({
    type: "harness.task",
    sessionId: "s",
    runId,
    request: "do it",
    startedAt: "t",
    mode: "agent",
  }),
];
const failed = (runId: string) =>
  item({ type: "run.failed", sessionId: "s", runId, message: "boom" });

describe("run scoping", () => {
  it("finds the newest run", () => {
    expect(latestRunId([...started("a"), ...started("b")])).toBe("b");
  });

  it("ignores a late failure from an older run", () => {
    const items = [...started("a"), ...started("b"), failed("a")];
    expect(scopeToLatestRun(items).some(({ event }) => event.type === "run.failed")).toBe(false);
    expect(failedTaskRecovery(items)).toBeUndefined();
    expect(harnessState(items, [], "s").label).not.toBe("Failed");
  });

  it("still reports a failure of the newest run", () => {
    const items = [...started("a"), ...started("b"), failed("b")];
    expect(failedTaskRecovery(items)?.error).toBe("boom");
    expect(harnessState(items, [], "s").label).toBe("Failed");
  });

  it("does not show another run's review state", () => {
    const items = [
      ...started("a"),
      item({ type: "run.awaiting_review", sessionId: "s", runId: "a" }),
      ...started("b"),
    ];
    expect(reviewOutcome(items)).toBeUndefined();
  });

  it("keeps awaiting review for the current run", () => {
    const items = [
      ...started("a"),
      item({ type: "run.awaiting_review", sessionId: "s", runId: "a" }),
    ];
    expect(reviewOutcome(items)).toEqual({ kind: "awaiting_review" });
    expect(failedTaskRecovery(items)).toBeUndefined();
  });

  it("never mixes sessions when switching rapidly", () => {
    const other = item({
      type: "run.failed",
      sessionId: "other",
      runId: "x",
      message: "other failed",
    });
    expect(harnessState([...started("a"), other], [], "s").label).not.toBe("Failed");
  });
});
