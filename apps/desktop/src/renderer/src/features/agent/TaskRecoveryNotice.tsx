import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
export function TaskRecoveryNotice({
  sessionId,
  model,
  error,
  busy,
  onSettings,
  onRetry,
}: {
  sessionId: string;
  model: string;
  error: string;
  busy: boolean;
  onSettings(): void;
  onRetry(): void;
}) {
  const [detail, setDetail] = useState(error);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string>();
  useEffect(() => {
    let active = true;
    setDetail(error);
    void window.modus.agent
      .listRuns(sessionId)
      .then((runs) => {
        const last = runs.at(-1);
        if (active && last?.status === "failed" && last.error) setDetail(last.error);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [error, sessionId]);
  return (
    <section
      role="alert"
      className="mx-4 mt-3 rounded-md border border-danger/30 bg-panel p-3 text-xs"
    >
      <p className="mb-2 font-medium">Task stopped · {model || "No model selected"}</p>
      <p className="whitespace-pre-wrap break-words text-danger">{detail}</p>
      <p className="mt-2 text-fg-muted">
        Connect a working provider or choose another model, then retry. Your request is preserved.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
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
              .then((result) => setTested(result.message))
              .catch((cause: unknown) => setTested(String(cause)))
              .finally(() => setTesting(false));
          }}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button disabled={busy || testing || !model} onClick={onRetry}>
          Retry task
        </Button>
      </div>
      {tested ? <p className="mt-2 whitespace-pre-wrap break-words">{tested}</p> : null}
    </section>
  );
}
