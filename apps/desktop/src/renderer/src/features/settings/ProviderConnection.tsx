import { useEffect, useRef, useState } from "react";
import type { ProviderAuthEvent, ProviderAuthMethod } from "../../../../shared/provider-auth";
import { Button } from "../../components/ui/Button";

export function ProviderConnection({
  provider,
  methods,
  onConnected,
}: {
  provider: string;
  methods: ProviderAuthMethod[];
  onConnected(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<Extract<ProviderAuthEvent, { type: "prompt" }>>();
  const [notice, setNotice] = useState<Extract<ProviderAuthEvent, { type: "notice" }>>();
  const [error, setError] = useState<string>();
  const [value, setValue] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.modus.model.onAuthEvent((event) => {
      if (event.provider !== provider) return;
      if (event.type === "prompt") {
        setPrompt(event);
        setValue(event.options?.[0]?.id ?? "");
      } else setNotice(event);
    });
    return () => {
      alive.current = false;
      unsubscribe();
      void window.modus.model.cancelLogin().catch(() => {});
    };
  }, [provider]);
  async function connect(type: "api_key" | "oauth") {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    setPrompt(undefined);
    try {
      await window.modus.model.login({ provider, type });
      if (alive.current) {
        onConnected();
        setNotice({
          provider,
          type: "notice",
          message: "Credentials saved by Pi. Test a model connection, then choose Use model.",
        });
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) {
        setBusy(false);
        setPrompt(undefined);
        setValue("");
      }
    }
  }
  async function answer() {
    if (!prompt || !value.trim()) return;
    const promptId = prompt.promptId,
      answer = value;
    setValue("");
    setPrompt(undefined);
    try {
      await window.modus.model.answerLogin({ promptId, value: answer });
    } catch (cause) {
      setError(String(cause));
    }
  }
  return (
    <section
      className="mx-5 mb-3 space-y-3 rounded border border-hairline p-3"
      aria-label="Provider connection"
    >
      <div className="flex flex-wrap gap-2">
        {methods.map((method) => (
          <Button key={method.type} disabled={busy} onClick={() => void connect(method.type)}>
            {method.label}
          </Button>
        ))}
        {busy ? (
          <Button onClick={() => void window.modus.model.cancelLogin()}>Cancel connection</Button>
        ) : null}
      </div>
      {notice ? (
        <div className="space-y-2 text-xs text-fg-muted">
          <p>{notice.message}</p>
          {notice.url ? (
            <Button
              onClick={() =>
                void window.modus.model
                  .openLoginUrl(notice.url as string)
                  .catch((cause: unknown) => setError(String(cause)))
              }
            >
              Open sign-in page
            </Button>
          ) : null}
        </div>
      ) : null}
      {prompt ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void answer();
          }}
        >
          <label htmlFor={prompt.promptId} className="grid gap-2 text-xs">
            {prompt.message}
            {prompt.kind === "select" ? (
              <select
                id={prompt.promptId}
                className="rounded border border-hairline bg-canvas p-2"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                {prompt.options?.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={prompt.promptId}
                type={prompt.kind === "secret" ? "password" : "text"}
                autoComplete="off"
                className="rounded border border-hairline bg-canvas p-2"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
          <Button type="submit" disabled={!value.trim()}>
            Continue connection
          </Button>
        </form>
      ) : null}
      {busy && !prompt ? (
        <p className="text-xs text-fg-muted">Waiting for the provider sign-in…</p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-xs text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
