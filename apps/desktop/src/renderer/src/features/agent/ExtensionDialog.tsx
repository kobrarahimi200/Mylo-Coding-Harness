import { Dialog } from "@base-ui/react/dialog";
import { useRef, useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../../../../shared/contracts";
import { CodeDiff } from "../../components/code/CodeDiff";
import { Button } from "../../components/ui/Button";
import { DialogBody, DialogSurface } from "../../components/ui/DialogSurface";
import { PlanReview } from "../harness/PlanReview";
import { rejectPlan } from "../harness/plan-actions";
import { planView } from "../harness/plan-view";

export function ExtensionDialog({
  request,
  contextLabel,
}: {
  request: QuestionRequest;
  contextLabel?: string | undefined;
}) {
  const question = request.questions[0];
  const [value, setValue] = useState(question?.prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(true);
  const submitting = useRef(false);
  const [readyDiffs, setReadyDiffs] = useState<string[]>([]);
  const markReady = (id: string) =>
    setReadyDiffs((current) => (current.includes(id) ? current : [...current, id]));
  const diffsReady =
    (!question?.codeChange || readyDiffs.includes("proposal")) &&
    (question?.codeChanges ?? []).every((_, index) => readyDiffs.includes(`final:${index}`));
  const planDialogView = question?.plan ? planView([], [request], request.sessionId) : undefined;
  if (!question) return null;

  async function respond(selected?: string, skipped = false): Promise<void> {
    if (submitting.current || !question) return;
    submitting.current = true;
    setBusy(true);
    setOpen(false);
    // Approval is a user action, not an animation-completion side effect.
    // Background/occluded windows can suspend closing animations indefinitely.
    try {
      const answer: QuestionAnswer = {
        questionId: question.id,
        selected: selected === undefined ? [] : [selected],
        ...(selected === undefined ? { custom: value } : {}),
      };
      if (question.plan) await rejectPlan(request);
      else
        await window.modus.questions.respond({
          requestId: request.id,
          answers: skipped ? [] : [answer],
          skipped,
        });
    } catch (caught) {
      submitting.current = false;
      setBusy(false);
      setOpen(true);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(open) => {
        if (!open) void respond(undefined, true);
      }}
    >
      <DialogSurface size="compact">
        <header className="shrink-0 px-6 pt-6 pb-3">
          <p className="mylo-popup-pill">
            {question.plan
              ? "Review plan"
              : question.codeChange
                ? "Apply change"
                : question.codeChanges
                  ? "Final result"
                  : question.id === "tool-approval"
                    ? "Run command"
                    : "Your input"}
          </p>
          <Dialog.Title className="mt-3 break-words font-semibold text-fg text-lg leading-snug">
            {question.header}
          </Dialog.Title>
        </header>
        <DialogBody className="px-6 pb-4">
          <span className="sr-only">
            {question.plan
              ? "APPROVE IMPLEMENTATION PLAN"
              : question.codeChange
                ? "APPLY FILE CHANGE"
                : question.codeChanges
                  ? "ACCEPT FINAL RESULT"
                  : question.id === "tool-approval"
                    ? "ALLOW COMMAND EXECUTION"
                    : "HUMAN REVIEW"}
          </span>
          {contextLabel ? (
            <p className="mt-2 break-all text-xs text-fg-faint">{contextLabel}</p>
          ) : null}
          {question.codeChange ? (
            <p className="mt-2 text-xs text-fg-muted">
              Approving applies your reviewed content to this file. A rollback checkpoint is
              preserved first.
            </p>
          ) : question.id === "tool-approval" ? (
            <p className="mt-2 text-xs text-fg-muted">
              This command can change project files. It runs inside the workspace sandbox; shell
              changes are not included in file rollback.
            </p>
          ) : null}
          {question.detail ? (
            <Dialog.Description className="mt-2 whitespace-pre-wrap break-words text-fg-muted text-sm">
              {question.detail}
            </Dialog.Description>
          ) : null}
          {question.codeChanges?.map((change, index) => (
            <section key={change.path} className="mt-4">
              <h3 className="mb-2 text-xs">{change.path}</h3>
              <CodeDiff
                before={change.before}
                after={change.after}
                onReady={() => markReady(`final:${index}`)}
              />
            </section>
          ))}
          {question.plan && planDialogView ? (
            <div className="mt-4">
              <PlanReview view={planDialogView} request={request} onError={setError} />
            </div>
          ) : question.options.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {question.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  disabled={busy || !diffsReady}
                  className="break-words rounded-lg border border-hairline bg-surface px-4 py-2.5 text-left text-sm text-fg shadow-sm transition-all hover:-translate-y-px hover:border-accent/40 hover:bg-accent-soft focus-visible:outline-focus-ring disabled:opacity-40 motion-reduce:transition-none"
                  onClick={() => void respond(option.label)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void respond();
              }}
            >
              {question.codeChange ? (
                <CodeDiff
                  before={question.codeChange.before}
                  after={question.codeChange.after}
                  onChange={setValue}
                  onReady={() => markReady("proposal")}
                />
              ) : (
                <textarea
                  aria-label={question.header}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  disabled={busy}
                  className="min-h-24 rounded-md border border-hairline bg-surface p-3 text-sm text-fg outline-focus-ring"
                />
              )}
              <Button type="submit" disabled={busy || !diffsReady} variant="primary">
                {question.codeChange ? "Apply change" : "Continue"}
              </Button>
            </form>
          )}
          {error ? <p className="mt-3 text-danger text-sm">{error}</p> : null}
        </DialogBody>
        <footer className="flex shrink-0 justify-end bg-panel px-6 py-3">
          <Dialog.Close
            disabled={busy}
            className="rounded-lg px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg"
          >
            Cancel
          </Dialog.Close>
        </footer>
      </DialogSurface>
    </Dialog.Root>
  );
}
