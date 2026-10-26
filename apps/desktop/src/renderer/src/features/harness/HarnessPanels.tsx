import type { AgentEventItem } from "../../../../shared/agent-events";
import type { QuestionRequest } from "../../../../shared/contracts";
import { CodeDiff } from "../../components/code/CodeDiff";
import { fileDiff } from "../agent/diff/fileDiff";
import { InlineDiffView } from "../agent/diff/InlineDiff";

export function HarnessPlan({ items }: { items: AgentEventItem[] }) {
  const event = items.findLast((item) => item.event.type === "harness.plan")?.event;
  if (event?.type !== "harness.plan")
    return (
      <p className="p-6 text-sm text-fg-muted">
        Submit a coding request in Chat. Pi will explore the project and propose a plan for your
        approval.
      </p>
    );
  return (
    <section className="h-full overflow-auto p-6">
      <div className="mb-4 text-xs uppercase tracking-widest text-accent">
        {event.approved ? "Approved execution plan" : "Plan awaiting review"}
      </div>
      <h2 className="mb-6 text-xl">{event.plan.goal}</h2>
      <ol className="grid list-decimal gap-4 pl-6 text-sm">
        {event.plan.steps.map((step) => (
          <li key={step} className="rounded-md border border-hairline bg-panel p-3">
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs text-fg-faint">
        Edit and approve the plan in the approval dialog. No code changes execute before approval.
      </p>
    </section>
  );
}
export function HarnessTimeline({ items }: { items: AgentEventItem[] }) {
  const visible = items.filter(
    ({ event }) =>
      event.type.startsWith("harness.") ||
      [
        "tool.started",
        "tool.ended",
        "run.failed",
        "run.cancelled",
        "runtime.error",
        "extension.notice",
      ].includes(event.type),
  );
  return (
    <div className="h-full overflow-auto p-4">
      {!visible.length ? (
        <p className="text-sm text-fg-muted">No task activity yet.</p>
      ) : (
        visible.map((item) => (
          <div key={item.id} className="mb-2 border-l-2 border-accent/50 bg-panel p-3 text-xs">
            <time className="mr-3 text-fg-faint">
              {item.createdAt ? new Date(item.createdAt).toLocaleTimeString() : ""}
            </time>
            <strong>{item.event.type}</strong>
            <pre className="mt-2 whitespace-pre-wrap break-words text-fg-muted">
              {JSON.stringify(item.event, null, 2)}
            </pre>
          </div>
        ))
      )}
    </div>
  );
}
export function HarnessTests({
  items,
  problemsOnly = false,
}: {
  items: AgentEventItem[];
  problemsOnly?: boolean;
}) {
  const start = items.findLastIndex(({ event }) => event.type === "run.started");
  const latest = new Map<string, AgentEventItem>();
  for (const item of items.slice(Math.max(0, start))) {
    if (item.event.type === "harness.validation")
      latest.set(`${item.event.attempt}:${item.event.label}`, item);
  }
  const results = [...latest.values()].filter(
    ({ event }) =>
      event.type === "harness.validation" && (!problemsOnly || event.status === "failed"),
  );

  return (
    <div className="h-full overflow-auto p-4">
      {!results.length ? (
        <p className="text-xs text-fg-muted">
          {problemsOnly
            ? "No recorded validation failures."
            : "No validation results yet. Checks run after execution with your approval."}
        </p>
      ) : (
        results.map(({ id, event }) =>
          event.type === "harness.validation" ? (
            <details
              open={event.status === "failed"}
              key={id}
              className="mb-2 rounded border border-hairline bg-panel p-3 text-xs"
            >
              <summary className={event.status === "failed" ? "text-danger" : "text-fg"}>
                {event.label} · {event.status} · attempt {event.attempt + 1} · exit{" "}
                {event.exitCode ?? "—"}
              </summary>
              <pre className="mt-3 whitespace-pre-wrap break-words">
                {event.output || (event.status === "running" ? "Command running…" : "No output.")}
              </pre>
            </details>
          ) : null,
        )
      )}
    </div>
  );
}
export function HarnessStatus({
  items,
  questions,
  sessionId,
  onError,
}: {
  items: AgentEventItem[];
  questions: QuestionRequest[];
  sessionId: string | undefined;
  onError(message: string): void;
}) {
  const phase = items.findLast(({ event }) => event.type === "harness.phase")?.event;
  const tool = items.findLast(({ event }) => event.type === "tool.started")?.event;
  const validation = items.findLast(({ event }) => event.type === "harness.validation")?.event;
  const pending = questions.filter((question) => question.sessionId === sessionId);
  const running =
    phase?.type === "harness.phase" && !["completed", "failed", "cancelled"].includes(phase.phase);
  return (
    <aside aria-label="Agent status" className="mylo-agent-status">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest">Pi agent</h2>
        <span className={`size-2 rounded-full ${running ? "bg-accent" : "bg-fg-faint"}`} />
      </div>
      <p className="text-sm capitalize">
        {phase?.type === "harness.phase" ? phase.phase : "Ready"}
      </p>
      <p className="mt-2 text-xs text-fg-muted">
        {phase?.type === "harness.phase" ? phase.detail : "Create a task to begin."}
      </p>
      <h3 className="mt-6 text-xs text-fg-faint">Validation progress</h3>
      <p className="mt-2 text-xs">
        {validation?.type === "harness.validation"
          ? `${validation.label}: ${validation.status} (attempt ${validation.attempt + 1})`
          : "No checks run"}
      </p>
      <h3 className="mt-6 text-xs text-fg-faint">Latest tool</h3>
      <p className="mt-2 text-xs">
        {tool?.type === "tool.started" ? tool.toolName : "No tool calls"}
      </p>
      <h3 className="mt-6 text-xs text-fg-faint">Approval queue · {pending.length}</h3>
      {pending.map((request) => (
        <p className="mt-2 rounded bg-surface p-2 text-xs" key={request.id}>
          {request.questions[0]?.header}
        </p>
      ))}
      <button
        className="mt-6 w-full rounded border border-danger/40 p-2 text-xs text-danger disabled:opacity-40"
        type="button"
        disabled={!sessionId || !running}
        onClick={() => {
          if (sessionId)
            void window.modus.agent
              .abort(sessionId)
              .catch((cause: unknown) => onError(String(cause)));
        }}
      >
        Stop agent
      </button>
    </aside>
  );
}

export function HarnessDiff({ items }: { items: AgentEventItem[] }) {
  const proposals = items.filter(({ event }) => event.type === "harness.change");
  const changes = items.filter(
    ({ event }) => event.type === "tool.ended" && event.details && fileDiff(event.details),
  );
  return (
    <div className="h-full overflow-auto p-4">
      {proposals.map(({ id, event }) =>
        event.type === "harness.change" ? (
          <div key={id} className="mb-5">
            <h3 className="mb-2 text-xs">
              {event.path} · reviewed proposal (see tool result in Timeline)
            </h3>
            <CodeDiff before={event.before} after={event.after} />
          </div>
        ) : null,
      )}
      {!changes.length && !proposals.length ? (
        <p className="text-sm text-fg-muted">
          No recorded edit diffs yet. Proposed writes and edits appear in the approval dialog before
          they are applied.
        </p>
      ) : (
        changes.map(({ id, event }) =>
          event.type === "tool.ended" && fileDiff(event.details) ? (
            <div className="mb-4" key={id}>
              <InlineDiffView
                diff={fileDiff(event.details) as NonNullable<ReturnType<typeof fileDiff>>}
              />
            </div>
          ) : null,
        )
      )}
    </div>
  );
}
