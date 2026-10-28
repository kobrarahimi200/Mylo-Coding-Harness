import {
  IconChevronDown,
  IconPlayerPlay,
  IconPlayerStop,
  IconRestore,
  IconSparkles,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type { QuestionRequest, WorkspaceInfo } from "../../../../shared/contracts";
import { validationStatusLabel } from "../../../../shared/harness";
import { ExecutionPlanCard } from "./ExecutionPlanCard";
import { HarnessTests } from "./HarnessPanels";
import { harnessState } from "./harness-state";
import { approvePlan, pendingPlanQuestion, usePlanApproval } from "./plan-actions";
import { planView } from "./plan-view";
import { RollbackDialog } from "./RollbackDialog";

function savedTaskField(
  workspaceId: string | undefined,
  field: "description" | "criteria",
): string {
  try {
    const draft = JSON.parse(localStorage.getItem(`mylo.task.${workspaceId ?? "none"}`) ?? "{}");
    return typeof draft[field] === "string" ? draft[field] : "";
  } catch {
    return "";
  }
}

export function AgentWorkspace({
  items,
  questions,
  sessionId,
  workspace,
  canGenerate,
  onGenerate,
  onStop,
  onView,
  onError,
  width,
  onWidthChange,
  onClose,
}: {
  items: AgentEventItem[];
  questions: QuestionRequest[];
  sessionId: string | undefined;
  workspace: WorkspaceInfo | null;
  canGenerate: boolean;
  onGenerate(task: string): Promise<void>;
  onStop(): void;
  onView(panel: string): void;
  onError(message: string): void;
  width: number;
  onWidthChange(width: number): void;
  onClose(): void;
}) {
  const state = harnessState(items, questions, sessionId);
  const [description, setDescription] = useState(() =>
    savedTaskField(workspace?.id, "description"),
  );
  const [criteria, setCriteria] = useState(() => savedTaskField(workspace?.id, "criteria"));
  useEffect(() => {
    try {
      localStorage.setItem(
        `mylo.task.${workspace?.id ?? "none"}`,
        JSON.stringify({ description, criteria }),
      );
    } catch {
      /* Keep the in-memory draft when preferences are unavailable. */
    }
  }, [workspace?.id, description, criteria]);
  const [submitting, setSubmitting] = useState(false);
  const [rollback, setRollback] = useState(false);
  const planQuestion = pendingPlanQuestion(state.pending, sessionId);
  const planCard = planView(items, questions, sessionId);
  const planApproval = usePlanApproval(planQuestion, onError, () => {
    const [request, ...acceptance] = (planCard?.request ?? "").split("\n\nAcceptance criteria:\n");
    setDescription(request ?? "");
    setCriteria(acceptance.join("\n\nAcceptance criteria:\n"));
  });
  const task = state.current.findLast(({ event }) => event.type === "harness.task")?.event;
  useEffect(() => {
    if (task?.type === "harness.task") {
      const [request, ...acceptance] = task.request.split("\n\nAcceptance criteria:\n");
      setDescription(request ?? "");
      setCriteria(acceptance.join("\n\nAcceptance criteria:\n"));
    }
  }, [task]);
  const taskSkills = state.current.findLast(({ event }) => event.type === "harness.skills")?.event;
  const validation = state.current
    .filter(({ event }) => event.type === "harness.validation")
    .map((i) => i.event)
    .filter((e) => e.type === "harness.validation");
  const latestValidation = validation.at(-1);
  const correction = state.current.filter(
    ({ event }) => event.type === "harness.phase" && event.phase === "correcting",
  ).length;
  const approvePending = () => {
    if (planQuestion?.questions[0]?.plan)
      void approvePlan(planQuestion, planQuestion.questions[0].plan).catch((error: unknown) =>
        onError(String(error)),
      );
  };
  const generate = async () => {
    setSubmitting(true);
    try {
      await onGenerate(
        `${description.trim()}${criteria.trim() ? `\n\nAcceptance criteria:\n${criteria.trim()}` : ""}`,
      );
    } catch (error) {
      onError(String(error));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <aside className="mylo-agent-workspace" aria-label="Agent Workspace" style={{ width }}>
      <button
        type="button"
        className="mylo-panel-resize"
        aria-label="Resize Agent Workspace"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onWidthChange(width + 16);
          if (event.key === "ArrowRight") onWidthChange(width - 16);
        }}
        onPointerDown={(event) => {
          const start = event.clientX,
            initial = width,
            button = event.currentTarget;
          button.setPointerCapture(event.pointerId);
          button.onpointermove = (move) => onWidthChange(initial + start - move.clientX);
          button.onpointerup = () => {
            button.onpointermove = null;
            button.onpointerup = null;
          };
        }}
      />
      <div className="mylo-agent-heading">
        <div>
          <span className="mylo-eyebrow">YOUR TASK CONTROL CENTER</span>
          <h2>Agent Workspace</h2>
        </div>
        <button
          type="button"
          className="mylo-icon-button"
          aria-label="Collapse Agent Workspace"
          onClick={onClose}
        >
          <IconChevronDown size={17} />
        </button>
      </div>
      <div className="mylo-agent-scroll">
        <div className={`mylo-task-status ${state.busy ? "is-active" : ""}`}>
          <i />
          <strong>{state.label}</strong>
          <span>{correction ? `Correction ${correction}/3` : "Pi coding agent"}</span>
        </div>
        <section className="mylo-control-section">
          <div className="mylo-section-heading">
            <span>01</span>
            <h3>Task specification</h3>
          </div>
          <label className="mylo-field-label" htmlFor="mylo-task">
            What should we build?
          </label>
          <textarea
            id="mylo-task"
            placeholder="Describe a change, a bug, or a coding task…"
            value={description}
            disabled={state.busy || !workspace}
            onChange={(e) => setDescription(e.target.value)}
          />
          <details>
            <summary className="mylo-optional">
              Acceptance criteria <span>optional</span>
            </summary>
            <textarea
              aria-label="Acceptance criteria"
              value={criteria}
              disabled={state.busy || !workspace}
              onChange={(e) => setCriteria(e.target.value)}
              placeholder="How will you know it is done?"
            />
          </details>
          <p className="mylo-context-line">{workspace?.displayName ?? "Open a project to begin"}</p>
          <button
            className="mylo-button is-primary is-wide"
            type="button"
            disabled={!canGenerate || state.busy || submitting || !description.trim()}
            title={
              !canGenerate
                ? "Select a project and connect an available model first"
                : state.busy
                  ? "Finish or stop the current task first"
                  : "Pi explores the repository using read-only tools"
            }
            onClick={() => void generate()}
          >
            <IconSparkles size={15} />
            {submitting ? "Starting…" : "Generate Plan"}
          </button>
        </section>
        <section className="mylo-control-section">
          <div className="mylo-section-heading">
            <span>02</span>
            <h3>Execution plan</h3>
            <span className="mylo-count">{planCard?.steps.length ?? 0}</span>
          </div>
          {planCard ? (
            <ExecutionPlanCard view={planCard} approval={planApproval} />
          ) : (
            <p className="mylo-empty-copy">
              Pi will explore your project and propose a plan. Code changes stay blocked until you
              approve.
            </p>
          )}
        </section>
        <section className="mylo-control-section">
          <div className="mylo-section-heading">
            <span>03</span>
            <h3>Live execution</h3>
          </div>
          <p className="mylo-empty-copy">
            {state.phase?.type === "harness.phase"
              ? state.phase.detail
              : "No task started. Activity appears here as Pi runs."}
          </p>
          {state.tool ? (
            <div className="mylo-tool-summary">
              <strong>{state.toolRunning ? "Running tool" : "Last tool"}</strong>
              <code>{state.tool.label ?? state.tool.toolName}</code>
            </div>
          ) : null}
          <div className="mylo-tool-summary">
            <strong>Current step</strong>
            <span>
              {state.activeStep ? `Step ${state.activeStep.index + 1}` : "No active step reported"}
            </span>
          </div>
          <div className="mylo-validation-summary">
            <span>Validation</span>
            <strong>
              {latestValidation ? validationStatusLabel(latestValidation.status) : "Not started"}
            </strong>
          </div>
          {validation.length ? (
            <details>
              <summary className="mylo-optional">Command results & correction history</summary>
              <HarnessTests items={items} />
            </details>
          ) : null}
          <button
            className="mylo-text-button"
            type="button"
            disabled={!sessionId}
            onClick={() => onView("timeline")}
          >
            View execution timeline →
          </button>
        </section>
        <section className="mylo-control-section">
          <div className="mylo-section-heading">
            <h3>Approval queue</h3>
            <span className="mylo-count">{state.pending.length}</span>
          </div>
          {state.pending.length ? (
            state.pending.map((request) => (
              <div className="mylo-approval-item" key={request.id}>
                <strong>{request.questions[0]?.header}</strong>
                <p>
                  {request.questions[0]?.codeChange
                    ? request.questions[0].codeChange.path
                    : request.questions[0]?.plan
                      ? "Review the editable plan above"
                      : "Review the open approval dialog"}
                </p>
              </div>
            ))
          ) : (
            <p className="mylo-empty-copy">No approvals waiting.</p>
          )}
        </section>
        <details className="mylo-control-section">
          <summary className="mylo-optional">Skills available during this task</summary>
          {taskSkills?.type === "harness.skills" ? (
            taskSkills.skills.length ? (
              taskSkills.skills.map((skill) => (
                <div className="mylo-skill-snapshot" key={skill.path}>
                  <strong>{skill.name}</strong>
                  <small>{skill.source}</small>
                  <p>{skill.description}</p>
                </div>
              ))
            ) : (
              <p className="mylo-empty-copy">No skills were loaded for this task.</p>
            )
          ) : (
            <p className="mylo-empty-copy">No task skill manifest recorded yet.</p>
          )}
          <button type="button" className="mylo-text-button" onClick={() => onView("skills")}>
            Manage skills →
          </button>
        </details>
        {task?.type === "harness.task" ? (
          <details className="mylo-control-section">
            <summary className="mylo-optional">Current task request</summary>
            <p className="whitespace-pre-wrap text-xs">{task.request}</p>
          </details>
        ) : null}
      </div>
      <footer className="mylo-agent-actions">
        <button
          type="button"
          className="mylo-button is-primary"
          disabled={!planQuestion || submitting}
          title={
            planQuestion
              ? "Approve the reviewed plan and execute through Pi"
              : "Generate and review a plan first"
          }
          onClick={approvePending}
        >
          <IconPlayerPlay size={14} />
          Run Harness
        </button>
        <button
          type="button"
          className="mylo-button is-danger"
          disabled={!state.busy}
          onClick={onStop}
        >
          <IconPlayerStop size={14} />
          Stop Agent
        </button>
        <button
          type="button"
          className="mylo-button"
          disabled={!sessionId}
          onClick={() => onView("diff")}
        >
          Review Changes
        </button>
        <button
          type="button"
          className="mylo-button"
          disabled={!sessionId || state.busy}
          title={
            state.busy
              ? "Finish or stop the task before rollback"
              : "Preview file checkpoints; manual changes are preserved"
          }
          onClick={() => setRollback(true)}
        >
          <IconRestore size={14} />
          Rollback
        </button>
      </footer>
      {rollback && sessionId ? (
        <RollbackDialog sessionId={sessionId} onClose={() => setRollback(false)} />
      ) : null}
    </aside>
  );
}
