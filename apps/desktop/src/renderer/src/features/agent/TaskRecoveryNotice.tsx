import { useState } from "react";
import { FAILURE_LABELS, type TaskFailure } from "../../../../shared/task-failure";
import { Button } from "../../components/ui/Button";

/** Contextual failure feedback. Provider actions appear only for provider-related failures. */
export function TaskRecoveryNotice({
  model,
  failure,
  busy,
  onSettings,
  onRetry,
}: {
  model: string;
  failure: TaskFailure;
  busy: boolean;
  onSettings(): void;
  onRetry(): void;
}) {
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<{ ok: boolean; message: string }>();
  const canRetry = failure.retryable || tested?.ok === true;
  return (
    <section
      role="alert"
      className="mx-4 mt-3 rounded-md border border-danger/30 bg-panel p-3 text-xs"
    >
      <p className="mb-1 font-medium">
        {FAILURE_LABELS[failure.category]}
        {failure.provider ? ` · ${model || "No model selected"}` : ""}
      </p>
      <p className="whitespace-pre-wrap break-words text-danger">{failure.message}</p>
      <p className="mt-2 text-fg-muted">{failure.recovery} Your request is preserved.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {failure.provider ? (
          <>
            <Button onClick={onSettings} disabled={busy}>
              Connect / change provider
            </Button>
            <Button
              disabled={busy || testing || !model}
              onClick={() => {
                setTesting(true);
                setTested(undefined);
                void window.modus.model
                  .testConnection(model)
                  .then((result) => setTested({ ok: result.ok, message: result.message }))
                  .catch((cause: unknown) => setTested({ ok: false, message: String(cause) }))
                  .finally(() => setTesting(false));
              }}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
          </>
        ) : null}
        {canRetry ? (
          <Button disabled={busy || testing} onClick={onRetry}>
            Retry task
          </Button>
        ) : null}
      </div>
      {tested ? (
        <p className={`mt-2 whitespace-pre-wrap break-words ${tested.ok ? "" : "text-danger"}`}>
          {tested.message}
        </p>
      ) : null}
    </section>
  );
}

/** Informational, non-error notice for manual review and declined plans. */
export function TaskReviewNotice({
  kind,
  reason,
}: {
  kind: "awaiting_review" | "rejected";
  reason?: "plan" | "review" | undefined;
}) {
  return (
    <section
      role="status"
      className="mx-4 mt-3 rounded-md border border-hairline bg-panel p-3 text-xs"
    >
      <p className="font-medium">
        {kind === "awaiting_review"
          ? "Awaiting final review"
          : reason === "plan"
            ? "Plan rejected"
            : "Result rejected"}
      </p>
      <p className="mt-1 text-fg-muted">
        {kind === "awaiting_review"
          ? "File changes were preserved and the task was not marked accepted. Review the Diff and Tests panels."
          : "Nothing was executed. Send a new request when you are ready."}
      </p>
    </section>
  );
}
