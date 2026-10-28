import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconCopy,
  IconListCheck,
  IconLoader2,
  IconPencil,
  IconPlayerSkipForward,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";
import type { TaskPlan } from "../../../../shared/harness";
import { planToMarkdown } from "../../../../shared/task-plan-text";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import type { PlanStepStatus, PlanTone, PlanView } from "./plan-view";

export type PlanApproval = {
  busy: boolean;
  onApprove(plan: TaskPlan): void;
  onReject(): void;
  onReplan?(): void;
};

const TONE_CLASS: Record<PlanTone, string> = {
  pending: "border-hairline text-fg-muted",
  running: "border-accent/40 text-accent",
  completed: "border-success/40 text-success",
  failed: "border-danger/40 text-danger",
  skipped: "border-hairline text-fg-faint",
};

const STEP_LABEL: Record<PlanStepStatus, string> = {
  pending: "Pending",
  running: "In progress",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

function StatusIcon({ status }: { status: PlanStepStatus | undefined }) {
  const props = { size: 16, "aria-hidden": true } as const;
  switch (status) {
    case "completed":
      return <IconCircleCheck {...props} className="text-success" />;
    case "failed":
      return <IconCircleX {...props} className="text-danger" />;
    case "running":
      return <IconLoader2 {...props} className="animate-spin text-accent" />;
    case "skipped":
      return <IconPlayerSkipForward {...props} className="text-fg-faint" />;
    case "pending":
      return <IconCircleDashed {...props} className="text-fg-muted" />;
    default:
      return <span className="inline-block size-4" aria-hidden />;
  }
}

function Badge({ tone, children }: { tone: PlanTone; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-2xs",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Structured, readable rendering of a harness task plan. Approval acts on the real question. */
export function ExecutionPlanCard({
  view,
  approval,
}: {
  view: PlanView;
  approval?: PlanApproval | undefined;
}) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(view.plan.goal);
  const [steps, setSteps] = useState(view.plan.steps);
  const [copied, setCopied] = useState(false);
  const canApprove = goal.trim() !== "" && steps.some((step) => step.trim() !== "");

  if (view.error) return <PlanParseError error={view.error} />;

  const startEditing = () => {
    setGoal(view.plan.goal);
    setSteps(view.plan.steps);
    setEditing(true);
  };

  return (
    <section
      aria-label="Execution plan"
      className="mx-4 my-3 rounded-xl border border-hairline bg-panel text-sm"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-hairline-soft p-4">
        <IconListCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="mylo-eyebrow">EXECUTION PLAN</p>
          {editing ? (
            <input
              aria-label="Plan goal"
              className="mt-1 w-full rounded-md border border-hairline bg-canvas p-2 text-sm"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          ) : (
            <h3 className="mt-1 break-words text-base text-fg">{view.goal}</h3>
          )}
        </div>
        <Badge tone={view.overallTone}>{view.overallLabel}</Badge>
      </header>

      {view.targetFiles.length > 0 && !editing ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline-soft px-4 py-2.5">
          <span className="text-2xs text-fg-faint">Target files</span>
          {view.targetFiles.map((file) => (
            <code key={file} className="rounded bg-chip px-1.5 py-0.5 text-2xs text-fg-muted">
              {file}
            </code>
          ))}
        </div>
      ) : null}

      {editing ? (
        <div className="grid gap-2 p-4">
          {steps.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps are edited in place and have no stable id
            <div key={index} className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-right text-xs text-fg-faint">
                {index + 1}
              </span>
              <textarea
                aria-label={`Step ${index + 1}`}
                className="min-h-9 flex-1 rounded-md border border-hairline bg-canvas p-2 text-sm"
                rows={2}
                value={step}
                onChange={(event) =>
                  setSteps((current) =>
                    current.map((item, i) => (i === index ? event.target.value : item)),
                  )
                }
              />
              <Button
                aria-label={`Remove step ${index + 1}`}
                variant="ghost"
                onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button variant="ghost" onClick={() => setSteps((current) => [...current, ""])}>
              Add step
            </Button>
          </div>
        </div>
      ) : (
        <ol className="grid gap-1 p-2">
          {view.steps.map((step, index) => {
            const expandable = Boolean(step.description || step.detail);
            const expanded = open[index] ?? false;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: duplicate step text is allowed; position is the identity
              <li key={index} className="rounded-lg">
                <button
                  type="button"
                  aria-expanded={expandable ? expanded : undefined}
                  disabled={!expandable}
                  onClick={() => setOpen((current) => ({ ...current, [index]: !expanded }))}
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left enabled:hover:bg-hover"
                >
                  <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-fg-faint">
                    {index + 1}
                  </span>
                  <StatusIcon status={step.status} />
                  <span className="min-w-0 flex-1 break-words text-fg">{step.title}</span>
                  {step.status ? <Badge tone={step.status}>{STEP_LABEL[step.status]}</Badge> : null}
                  {expandable ? (
                    expanded ? (
                      <IconChevronDown size={14} aria-hidden className="mt-1 text-fg-faint" />
                    ) : (
                      <IconChevronRight size={14} aria-hidden className="mt-1 text-fg-faint" />
                    )
                  ) : null}
                </button>
                {expanded ? (
                  <div className="ml-16 mb-2 grid gap-1 pr-3 text-xs text-fg-muted">
                    {step.description ? <p className="break-words">{step.description}</p> : null}
                    {step.detail ? (
                      <p className="break-words text-fg-faint">{step.detail}</p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-hairline-soft p-3">
        {approval ? (
          editing ? (
            <>
              <Button
                variant="primary"
                disabled={approval.busy || !canApprove}
                onClick={() => approval.onApprove({ goal, steps })}
              >
                Approve plan
              </Button>
              <Button variant="ghost" disabled={approval.busy} onClick={() => setEditing(false)}>
                Cancel edit
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={approval.busy}
                onClick={() => approval.onApprove(view.plan)}
              >
                Approve plan
              </Button>
              <Button disabled={approval.busy} onClick={startEditing}>
                <IconPencil size={14} aria-hidden />
                Edit plan
              </Button>
              <Button disabled={approval.busy} onClick={approval.onReject}>
                Reject
              </Button>
              {approval.onReplan ? (
                <Button variant="ghost" disabled={approval.busy} onClick={approval.onReplan}>
                  <IconRefresh size={14} aria-hidden />
                  Re-plan
                </Button>
              ) : null}
            </>
          )
        ) : (
          <p className="text-xs text-fg-faint">
            {view.approved
              ? "Approved. Step progress appears only when the harness reports it."
              : "No code changes run before approval."}
          </p>
        )}
        <Button
          className="ml-auto"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(planToMarkdown(view.plan))
              .then(() => setCopied(true));
          }}
        >
          <IconCopy size={14} aria-hidden />
          {copied ? "Copied" : "Copy as Markdown"}
        </Button>
      </footer>
    </section>
  );
}

export function PlanParseError({ error }: { error: { message: string; raw: string } }) {
  return (
    <section
      role="alert"
      className="mx-4 my-3 rounded-xl border border-danger/30 bg-panel p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-fg">
        <IconAlertTriangle size={16} aria-hidden className="text-danger" />
        The execution plan could not be read
      </p>
      <p className="mt-2 break-words text-danger">{error.message}</p>
      <p className="mt-1 text-xs text-fg-muted">
        Nothing was executed. Send the request again to generate a new plan.
      </p>
      <details className="mt-2 text-xs text-fg-muted">
        <summary className="cursor-pointer">Technical details</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-canvas p-2">
          {error.raw}
        </pre>
      </details>
    </section>
  );
}
