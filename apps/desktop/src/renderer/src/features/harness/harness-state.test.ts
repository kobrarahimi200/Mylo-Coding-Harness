import { expect, it } from "vitest";
import type { AgentEvent } from "../../../../shared/contracts";
import { currentTaskItems, harnessState } from "./harness-state";

const item = (event: AgentEvent) => ({ id: crypto.randomUUID(), event });
it("keeps a task busy while waiting for human approval after the native agent settles", () => {
  const items = [
    item({ type: "harness.phase", sessionId: "s", phase: "approval", detail: "Review plan" }),
  ];
  expect(harnessState(items, [], "s")).toMatchObject({ label: "Awaiting approval", busy: true });
});
it("terminal cancellation overrides a previously running phase", () => {
  const items = [
    item({ type: "harness.phase", sessionId: "s", phase: "executing", detail: "Running" }),
    item({ type: "run.cancelled", sessionId: "s", runId: "r" }),
  ];
  expect(harnessState(items, [], "s")).toMatchObject({ label: "Cancelled", busy: false });
});
it("preserves validation history across native correction subturns", () => {
  const items = [
    item({ type: "harness.task", sessionId: "s", runId: "r", request: "Fix", startedAt: "now" }),
    item({
      type: "harness.validation",
      sessionId: "s",
      attempt: 0,
      label: "test",
      status: "failed",
      exitCode: 1,
      output: "failed",
    }),
    item({
      type: "run.started",
      sessionId: "s",
      runId: "native-correction",
      userMessageId: "u",
      delivery: "normal",
    }),
  ];
  expect(currentTaskItems(items)).toHaveLength(3);
});
it("does not turn a persisted harness failure into success because a native assistant subturn completed", () => {
  const items = [
    item({ type: "harness.phase", sessionId: "s", phase: "failed", detail: "Validation failed" }),
    item({ type: "run.completed", sessionId: "s", runId: "run:native-entry" }),
  ];
  expect(harnessState(items, [], "s")).toMatchObject({ label: "Failed", busy: false });
});
it("shows real session preparation as busy before planning begins", () => {
  expect(
    harnessState(
      [item({ type: "session.status", sessionId: "s", status: { type: "busy" } })],
      [],
      "s",
    ),
  ).toMatchObject({ label: "Preparing", busy: true });
});
it("clears the current step when its completion report arrives", () => {
  const items = [
    item({ type: "harness.phase", sessionId: "s", phase: "executing", detail: "Running" }),
    item({ type: "harness.step", sessionId: "s", index: 0, status: "running", detail: "Reading" }),
  ];
  expect(harnessState(items, [], "s").activeStep?.index).toBe(0);
  items.push(
    item({ type: "harness.step", sessionId: "s", index: 0, status: "completed", detail: "Read" }),
  );
  expect(harnessState(items, [], "s").activeStep).toBeUndefined();
});
