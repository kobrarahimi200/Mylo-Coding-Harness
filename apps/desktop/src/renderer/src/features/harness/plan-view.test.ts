import { describe, expect, it } from "vitest";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type { AgentEvent, QuestionRequest } from "../../../../shared/contracts";
import { planView, splitStep } from "./plan-view";

const sessionId = "s1";
const plan = {
  goal: "Create mylo-test.js",
  steps: ["Create the file: mylo-test.js", "Run validation"],
};
let seq = 0;
const item = (event: AgentEvent): AgentEventItem => ({ id: `e${seq++}`, event }) as AgentEventItem;
const base = [
  item({ type: "harness.task", sessionId, runId: "r", request: "Create it", startedAt: "now" }),
];
const phase = (p: "approval" | "executing" | "completed" | "rejected") =>
  item({ type: "harness.phase", sessionId, phase: p, detail: p });

describe("planView", () => {
  it("returns nothing when no plan exists", () => {
    expect(planView(base, [], sessionId)).toBeUndefined();
  });

  it("builds a readable model with title, description and target files", () => {
    const view = planView(
      [
        ...base,
        item({ type: "harness.plan", sessionId, plan, approved: false }),
        phase("approval"),
      ],
      [],
      sessionId,
    );
    expect(view?.goal).toBe("Create mylo-test.js");
    expect(view?.steps[0]).toMatchObject({
      title: "Create the file",
      description: "mylo-test.js",
      status: "pending",
    });
    expect(view?.targetFiles).toEqual(["mylo-test.js"]);
    expect(view?.overallLabel).toBe("Awaiting approval");
    expect(view?.approved).toBe(false);
  });

  it("does not mark steps completed without authoritative step events", () => {
    const events = [
      ...base,
      item({ type: "harness.plan", sessionId, plan, approved: true }),
      phase("executing"),
    ];
    expect(planView(events, [], sessionId)?.steps.map((s) => s.status)).toEqual([
      "pending",
      "pending",
    ]);
    const done = planView([...events, phase("completed")], [], sessionId);
    expect(done?.overallLabel).toBe("Completed");
    expect(done?.steps.map((s) => s.status)).toEqual([undefined, undefined]);
  });

  it("uses harness.step events for per-step status", () => {
    const view = planView(
      [
        ...base,
        item({ type: "harness.plan", sessionId, plan, approved: true }),
        phase("executing"),
        item({ type: "harness.step", sessionId, index: 0, status: "completed", detail: "ok" }),
        item({ type: "harness.step", sessionId, index: 1, status: "running", detail: "go" }),
      ],
      [],
      sessionId,
    );
    expect(view?.steps.map((s) => s.status)).toEqual(["completed", "running"]);
  });

  it("marks steps skipped when the plan was rejected", () => {
    const view = planView(
      [
        ...base,
        item({ type: "harness.plan", sessionId, plan, approved: false }),
        phase("rejected"),
      ],
      [],
      sessionId,
    );
    expect(view?.steps.every((s) => s.status === "skipped")).toBe(true);
  });

  it("shows the pending (editable) plan from the real approval question", () => {
    const question = {
      id: "q",
      sessionId,
      questions: [{ id: "task-plan", header: "", options: [], plan }],
    } as unknown as QuestionRequest;
    expect(planView(base, [question], sessionId)?.plan).toEqual(plan);
  });

  it("surfaces a parse error with technical details when no plan exists", () => {
    const view = planView(
      [...base, item({ type: "harness.plan_error", sessionId, message: "bad", raw: "{oops" })],
      [],
      sessionId,
    );
    expect(view?.error).toEqual({ message: "bad", raw: "{oops" });
  });

  it("keeps a steps' plain text when it has no description", () => {
    expect(splitStep("Run validation")).toEqual({ title: "Run validation" });
  });
});
