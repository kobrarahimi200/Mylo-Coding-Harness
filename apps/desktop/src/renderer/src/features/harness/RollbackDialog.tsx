import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import type { CheckpointPreview } from "../../../../shared/checkpoint";
import { CodeDiff } from "../../components/code/CodeDiff";
import { DialogBody, DialogSurface } from "../../components/ui/DialogSurface";
export function RollbackDialog({ sessionId, onClose }: { sessionId: string; onClose(): void }) {
  const [preview, setPreview] = useState<CheckpointPreview>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>();
  const [ready, setReady] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    if (!window.modus.harness) {
      setError("Restart the desktop app to load checkpoint services.");
      return;
    }
    void window.modus.harness
      .checkpoint(sessionId)
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [sessionId]);
  const files = preview?.files.filter((file) => file.status !== "unchanged") ?? [];
  const conflicts = files.some((file) => file.status === "conflict");
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogSurface size="compact">
        <Dialog.Title className="mylo-dialog-title">Restore reviewed file changes</Dialog.Title>
        <DialogBody className="mylo-rollback-body">
          <Dialog.Description>
            Review each file before confirming. Only the latest file-changing task’s write/edit
            checkpoints are covered. Terminal changes are left untouched. Later manual edits are
            conflicts and will be preserved.
          </Dialog.Description>
          {error ? (
            <p role="alert" className="mylo-inline-error">
              {error}
            </p>
          ) : null}
          {result ? <p role="status">{result}</p> : null}
          {!preview && !error ? <p>Loading checkpoint…</p> : null}
          {preview && !files.length ? <p>No file changes available to restore.</p> : null}
          {files.map((file) => (
            <section className="mylo-rollback-file" key={file.path}>
              <h3>
                {file.path} ·{" "}
                {file.created ? "Remove agent-created file" : "Restore pre-task content"}
              </h3>
              {file.reason ? (
                <p role="alert" className="mylo-inline-error">
                  {file.reason}
                </p>
              ) : (
                <CodeDiff
                  before={file.after}
                  after={file.before}
                  onReady={() =>
                    setReady((paths) => (paths.includes(file.path) ? paths : [...paths, file.path]))
                  }
                />
              )}
            </section>
          ))}
        </DialogBody>
        <footer className="mylo-dialog-actions">
          <button type="button" className="mylo-button" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="mylo-button is-danger"
            disabled={
              busy ||
              !preview ||
              !files.length ||
              conflicts ||
              Boolean(result) ||
              files.some((file) => !ready.includes(file.path))
            }
            onClick={() => {
              if (!preview) return;
              setBusy(true);
              setError(undefined);
              void window.modus.harness
                .rollback({ sessionId, token: preview.token, confirmed: true })
                .then((next) =>
                  setResult(
                    next.conflicts.length
                      ? `Stopped: conflicts in ${next.conflicts.join(", ")}. Restored ${next.restored.length} files.`
                      : `Restored ${next.restored.length} files.`,
                  ),
                )
                .catch((e: unknown) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Restoring…" : `Restore ${files.length} files`}
          </button>
        </footer>
      </DialogSurface>
    </Dialog.Root>
  );
}
