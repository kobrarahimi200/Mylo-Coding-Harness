import { IconChevronDown, IconPlayerStop, IconRestore } from "@tabler/icons-react";
import { useState } from "react";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type { QuestionRequest, WorkspaceInfo } from "../../../../shared/contracts";
import { validationStatusLabel } from "../../../../shared/harness";
import { HarnessTests } from "./HarnessPanels";
import { harnessState } from "./harness-state";
import { PlanReview } from "./PlanReview";
import { pendingPlanQuestion } from "./plan-actions";
import { planView } from "./plan-view";
import { RollbackDialog } from "./RollbackDialog";
import { MODE_LABEL, taskSummary } from "./task-summary";

export function AgentWorkspace({
  items,
  questions,
  sessionId,
  workspace,
  onEditTask,
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
  /** Returns the user to the Chat composer with the submitted request as a draft. */
  onEditTask(request: string): void;
  onStop(): void;
  onView(panel: string): void;
  onError(message: string): void;
  width: number;
  onWidthChange(width: number): void;
  onClose(): void;
}) {
  const state = harnessState(items, questions, sessionId);
  const summary = taskSummary(items, questions, sessionId);
  const [rollback, setRollback] = useState(false);
  const planQuestion = pendingPlanQuestion(state.pending, sessionId);
  const planCard = planView(items, questions, sessionId);
  const otherApprovals = state.pending.filter((request) => !request.questions[0]?.plan);
  const taskSkills = state.current.findLast(({ event }) => event.type === "harness.skills")?.event;
  const validation = state.current
    .map((i) => i.event)
    .filter((e) => e.type === "harness.validation");
  const latestValidation = validation.at(-1);
  const correction = state.current.filter(
    ({ event }) => event.type === "harness.phase" && event.phase === "correcting",
  ).length;
  const hasChanges = !!summary?.changedFiles.length;
  const activity = state.phase?.type === "harness.phase" ? state.phase.detail : undefined;
  return (
    <aside className="mylo-agent-workspace" aria-label="Agent Activity" style={{ width }}>
      <button
        type="button"
        className="mylo-panel-resize"
        aria-label="Resize Agent Activity"
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
          <h2>Agent Activity</h2>
        </div>
        <button
          type="button"
          className="mylo-icon-button"
          aria-label="Collapse Agent Activity"
          onClick={onClose}
        >
          <IconChevronDown size={17} />
        </button>
      </div>
      <div className="mylo-agent-scroll">
        <div className={`mylo-task-status ${state.busy ? "is-active" : ""}`}>
          <i />
          <strong>{state.label}</strong>
          <span>
            {correction
              ? `Correction ${correction}/3`
              : summary?.mode
                ? `${MODE_LABEL[summary.mode]} mode`
                : "Pi coding agent"}
          </span>
        </div>
        <section className="mylo-control-section" aria-label="Current task">
          <div className="mylo-section-heading">
            <h3>Current task</h3>
          </div>
          {summary ? (
            <>
              <p className="whitespace-pre-wrap text-sm">{summary.request}</p>
              {summary.criteria ? (
                <p className="mylo-context-line whitespace-pre-wrap">
                  Acceptance criteria: {summary.criteria}
                </p>
              ) : null}
              <p className="mylo-context-line">
                {summary.mode ? `${MODE_LABEL[summary.mode]} mode · ` : ""}
                {workspace?.displayName ?? "No workspace"} · {state.label}
              </p>
              <button
                type="button"
                className="mylo-text-button"
                disabled={state.busy}
                title={state.busy ? "Stop the task before editing it" : "Edit in the Chat composer"}
                onClick={() => onEditTask(summary.request)}
              >
                Edit task in Chat →
              </button>
            </>
          ) : (
            <>
              <p className="mylo-empty-copy">Describe a task in Chat.</p>
              <button type="button" className="mylo-text-button" onClick={() => onView("chat")}>
                Go to Chat →
              </button>
            </>
          )}
        </section>
        {planCard ? (
          <section className="mylo-control-section" aria-label="Execution plan">
            <div className="mylo-section-heading">
              <h3>Execution plan</h3>
              <span className="mylo-count">{planCard.steps.length}</span>
            </div>
            <PlanReview embedded view={planCard} request={planQuestion} onError={onError} />
          </section>
        ) : null}
        {summary && (state.busy || activity) ? (
          <section className="mylo-control-section" aria-label="Live agent activity">
            <div className="mylo-section-heading">
              <h3>Live agent activity</h3>
            </div>
            {activity ? <p className="mylo-empty-copy">{activity}</p> : null}
            {state.tool ? (
              <div className="mylo-tool-summary">
                <strong>{state.toolRunning ? "Running tool" : "Last tool"}</strong>
                <code>{state.tool.label ?? state.tool.toolName}</code>
              </div>
            ) : null}
            {state.activeStep ? (
              <div className="mylo-tool-summary">
                <strong>Current step</strong>
                <span>Step {state.activeStep.index + 1}</span>
              </div>
            ) : null}
            <button type="button" className="mylo-text-button" onClick={() => onView("timeline")}>
              View execution timeline →
            </button>
          </section>
        ) : null}
        {latestValidation ? (
          <section className="mylo-control-section" aria-label="Validation results">
            <div className="mylo-section-heading">
              <h3>Validation results</h3>
            </div>
            <div className="mylo-validation-summary">
              <span>Validation</span>
              <strong>{validationStatusLabel(latestValidation.status)}</strong>
            </div>
            <HarnessTests items={items} />
          </section>
        ) : null}
        {otherApprovals.length ? (
          <section className="mylo-control-section" aria-label="Pending approvals">
            <div className="mylo-section-heading">
              <h3>Pending approvals</h3>
              <span className="mylo-count">{otherApprovals.length}</span>
            </div>
            {otherApprovals.map((request) => (
              <div className="mylo-approval-item" key={request.id}>
                <strong>{request.questions[0]?.header}</strong>
                <p>
                  {request.questions[0]?.codeChange
                    ? request.questions[0].codeChange.path
                    : "Answer in the open approval dialog"}
                </p>
              </div>
            ))}
          </section>
        ) : null}
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
      </div>
      {state.busy || hasChanges ? (
        <footer className="mylo-agent-actions">
          {state.busy ? (
            <button type="button" className="mylo-button is-danger" onClick={onStop}>
              <IconPlayerStop size={14} />
              Stop
            </button>
          ) : null}
          {hasChanges ? (
            <button type="button" className="mylo-button" onClick={() => onView("diff")}>
              Review changes
            </button>
          ) : null}
          {hasChanges && !state.busy ? (
            <button
              type="button"
              className="mylo-button"
              title="Preview file checkpoints; manual changes are preserved"
              onClick={() => setRollback(true)}
            >
              <IconRestore size={14} />
              Safe rollback
            </button>
          ) : null}
        </footer>
      ) : null}
      {rollback && sessionId ? (
        <RollbackDialog sessionId={sessionId} onClose={() => setRollback(false)} />
      ) : null}
    </aside>
  );
}
