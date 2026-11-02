import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type { AgentEvent, QuestionRequest, WorkspaceInfo } from "../../../../shared/contracts";
import { AgentWorkspace } from "./AgentWorkspace";
import { harnessState } from "./harness-state";
import { approvePlan, rejectPlan, replanPlan, respondOnce } from "./plan-actions";
import { planSurface } from "./plan-surface";
import { planView } from "./plan-view";
import { taskSummary } from "./task-summary";

const plan = { goal: "Fix it", steps: ["Inspect a.ts", "Run tests"] };
let seq = 0;
const item = (event: AgentEvent): AgentEventItem => ({ id: `e${seq++}`, event }) as AgentEventItem;
const task = (sessionId: string, request = "Fix the bug") =>
  item({
    type: "harness.task",
    sessionId,
    runId: `r-${sessionId}`,
    request,
    startedAt: "now",
    mode: "agent",
  });
const planQuestion = (id: string, sessionId: string): QuestionRequest => ({
  id,
  sessionId,
  questions: [
    {
      id: "task-plan",
      header: "Approve implementation plan",
      prefill: JSON.stringify(plan),
      plan,
      allowReplan: true,
      options: [],
    },
  ],
});
const workspace = { id: "w1", displayName: "Demo" } as WorkspaceInfo;
const noop = () => {};
const workspaceHtml = (items: AgentEventItem[], questions: QuestionRequest[], sessionId: string) =>
  renderToStaticMarkup(
    <AgentWorkspace
      items={items}
      questions={questions}
      sessionId={sessionId}
      workspace={workspace}
      onEditTask={noop}
      onStop={noop}
      onView={noop}
      onError={noop}
      width={360}
      onWidthChange={noop}
      onClose={noop}
    />,
  );

describe("plan surface ownership", () => {
  it("selects exactly one interactive surface for every layout", () => {
    expect(planSurface({ agentOpen: true, panel: "chat" })).toBe("workspace");
    expect(planSurface({ agentOpen: true, panel: "plan" })).toBe("workspace");
    expect(planSurface({ agentOpen: false, panel: "plan" })).toBe("plan-tab");
    expect(planSurface({ agentOpen: false, panel: "chat" })).toBe("chat");
    // No plan view visible: the dialog keeps the approval reachable.
    expect(planSurface({ agentOpen: false, panel: "diff" })).toBe("dialog");
  });
});

describe("plan approval responses", () => {
  const respond = vi.fn(async (_input: unknown) => null);
  beforeEach(() => {
    respond.mockClear();
    vi.stubGlobal("window", { modus: { questions: { respond } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers a plan approval exactly once even on a double click", async () => {
    const request = planQuestion("req-double", "s1");
    const results = await Promise.all([approvePlan(request, plan), approvePlan(request, plan)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(await rejectPlan(request)).toBe(false);
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it("sends the edited plan on approval", async () => {
    await approvePlan(planQuestion("req-edit", "s1"), {
      goal: " Edited ",
      steps: [" One ", " "],
    });
    expect(respond).toHaveBeenCalledWith({
      requestId: "req-edit",
      answers: [
        { questionId: "task-plan", selected: [], custom: '{"goal":"Edited","steps":["One"]}' },
      ],
      skipped: false,
    });
  });

  it("rejects by skipping the question so execution never starts", async () => {
    await rejectPlan(planQuestion("req-reject", "s1"));
    expect(respond).toHaveBeenCalledWith({
      requestId: "req-reject",
      answers: [],
      skipped: true,
    });
  });

  it("re-plans without skipping and keeps the user's draft", async () => {
    await replanPlan(planQuestion("req-replan", "s1"), { goal: "Mine", steps: ["My step"] });
    const sent = respond.mock.calls[0]?.[0] as {
      skipped: boolean;
      answers: { selected: string[]; custom: string }[];
    };
    expect(sent.skipped).toBe(false);
    expect(sent.answers[0]?.selected).toEqual(["Re-plan"]);
    expect(JSON.parse(sent.answers[0]?.custom ?? "")).toEqual({
      goal: "Mine",
      steps: ["My step"],
    });
  });

  it("allows a retry when delivery failed", async () => {
    let calls = 0;
    const send = async () => {
      if (calls++ === 0) throw new Error("ipc down");
    };
    await expect(respondOnce("req-retry", send)).rejects.toThrow("ipc down");
    expect(await respondOnce("req-retry", send)).toBe(true);
  });
});

describe("single task workflow state", () => {
  it("does not leak another session's task or plan", () => {
    const items = [
      task("s1", "Task one"),
      item({ type: "harness.plan", sessionId: "s1", plan, approved: false }),
      task("s2", "Task two"),
    ];
    expect(taskSummary(items, [], "s1")?.request).toBe("Task one");
    expect(taskSummary(items, [], "s2")?.request).toBe("Task two");
    expect(planView(items, [], "s2")).toBeUndefined();
    expect(harnessState(items, [planQuestion("q1", "s1")], "s2").pending).toEqual([]);
  });

  it("shows the same plan and request id to Chat and the Plan tab", () => {
    const items = [
      task("s1"),
      item({ type: "harness.plan", sessionId: "s1", plan, approved: false }),
    ];
    const questions = [planQuestion("q-shared", "s1")];
    expect(planView(items, questions, "s1")).toEqual(planView(items, questions, "s1"));
    expect(planView(items, questions, "s1")?.requestId).toBe("q-shared");
  });

  it("splits acceptance criteria out of the submitted request", () => {
    const summary = taskSummary(
      [task("s1", "Fix bug\n\nAcceptance criteria:\nTests pass")],
      [],
      "s1",
    );
    expect(summary).toMatchObject({ request: "Fix bug", criteria: "Tests pass", mode: "agent" });
  });
});

describe("AgentWorkspace", () => {
  it("has no task entry, plan generation or Run Harness control", () => {
    const html = workspaceHtml([], [], "s1");
    expect(html).toContain("Describe a task in Chat");
    expect(html).not.toContain('id="mylo-task"');
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Generate Plan");
    expect(html).not.toContain("Run Harness");
  });

  it("shows a read-only Current Task summary with exactly one plan approval", () => {
    const items = [
      task("s1"),
      item({ type: "harness.plan", sessionId: "s1", plan, approved: false }),
      item({
        type: "harness.phase",
        sessionId: "s1",
        phase: "approval",
        detail: "Review the plan",
      }),
    ];
    const html = workspaceHtml(items, [planQuestion("q1", "s1")], "s1");
    expect(html).toContain("Current task");
    expect(html).toContain("Fix the bug");
    expect(html).toContain("Agent mode");
    expect(html).toContain("Edit task in Chat");
    expect(html.match(/Approve plan/g)).toHaveLength(1);
    expect(html).not.toContain("Run Harness");
  });

  it("lists file and command approvals separately from plan approval", () => {
    const command: QuestionRequest = {
      id: "q-cmd",
      sessionId: "s1",
      questions: [{ id: "tool-approval", header: "Allow command execution", options: [] }],
    };
    const html = workspaceHtml([task("s1")], [planQuestion("q1", "s1"), command], "s1");
    expect(html).toContain("Pending approvals");
    expect(html).toContain("Allow command execution");
  });
});
