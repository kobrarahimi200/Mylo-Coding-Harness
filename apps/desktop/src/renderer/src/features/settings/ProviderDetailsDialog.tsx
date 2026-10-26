import { Dialog } from "@base-ui/react/dialog";
import { IconFolder, IconRefresh, IconX } from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { ModelProviderDetail, ModelProviderInfo } from "../../../../shared/contracts";
import { ProviderLogo } from "../../components/providers/ProviderLogo";
import { Button } from "../../components/ui/Button";
import { DialogBody, DialogSurface } from "../../components/ui/DialogSurface";
import { SearchField } from "../../components/ui/SearchField";
import { ToolbarButton } from "../../components/ui/ToolbarButton";
import { ProviderConnection } from "./ProviderConnection";

export function ProviderDetailsDialog({
  provider,
  onClose,
  finalFocus,
  sessionId,
}: {
  provider: ModelProviderInfo;
  sessionId?: string | undefined;
  onClose(): void;
  finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [detail, setDetail] = useState<ModelProviderDetail>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const [testing, setTesting] = useState<string>();
  const [connectionResult, setConnectionResult] = useState<{ ok: boolean; message: string }>();
  async function selectModel(model: string) {
    try {
      if (sessionId) await window.modus.agent.setModel({ sessionId, model });
      await window.modus.model.setDefault(model);
      setConnectionResult({
        ok: true,
        message: `Selected ${model}. Return to Chat and retry your task.`,
      });
    } catch (cause) {
      setError(String(cause));
    }
  }
  async function testModel(model: string) {
    setTesting(model);
    setConnectionResult(undefined);
    try {
      setConnectionResult(await window.modus.model.testConnection(model));
    } catch (cause) {
      setConnectionResult({ ok: false, message: String(cause) });
    } finally {
      setTesting(undefined);
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: Explicit retry invalidates the request.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    void window.modus.model
      .providerDetail(provider.id)
      .then((result) => {
        if (!result) throw new Error("Provider is no longer available.");
        if (active) setDetail(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [provider.id, revision]);
  const models = (detail?.models ?? []).filter((model) =>
    `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 68,
    getItemKey: (index) => models[index]?.id ?? index,
    overscan: 4,
  });
  return (
    <Dialog.Root
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogSurface finalFocus={finalFocus}>
        <header className="flex shrink-0 items-center gap-3 px-5 pt-5 pb-3">
          <ProviderLogo provider={provider.id} name={provider.name} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
            <Dialog.Title className="break-words text-lg font-semibold">
              {provider.name}
            </Dialog.Title>
            <Dialog.Description className="rounded-full bg-chip px-2 py-1 text-xs text-fg-muted">
              {detail?.configured ? "Credentials found" : "Not configured"}
            </Dialog.Description>
          </div>
          <Dialog.Close render={<ToolbarButton label="Close provider details" />}>
            <IconX size={16} />
          </Dialog.Close>
        </header>
        <div className="mx-5 mb-3 flex shrink-0 items-center gap-3 rounded-md border border-hairline-soft px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-2xs text-fg-faint">Configuration source</p>
            <p className="truncate text-xs text-fg-muted" title={detail?.source ?? provider.source}>
              {detail?.source ?? provider.source ?? provider.authSource ?? "Not configured"}
            </p>
          </div>
          <ToolbarButton
            label="Open configuration folder"
            onClick={() =>
              void window.modus.model
                .openConfig(provider.id)
                .catch((cause: unknown) => setError(String(cause)))
            }
          >
            <IconFolder size={16} />
          </ToolbarButton>
        </div>
        {detail?.authMethods?.length ? (
          <ProviderConnection
            provider={provider.id}
            methods={detail.authMethods}
            onConnected={() => setRevision((value) => value + 1)}
          />
        ) : null}
        {connectionResult ? (
          <p
            role="status"
            className={`mx-5 mb-3 break-words text-xs ${connectionResult.ok ? "text-fg" : "text-danger"}`}
          >
            {connectionResult.message}
          </p>
        ) : null}
        <div className="shrink-0 space-y-2 border-t border-hairline-soft px-5 py-3">
          <SearchField
            ariaLabel="Search models"
            placeholder="Search models"
            value={query}
            onChange={setQuery}
          />
          {detail ? (
            <p className="text-xs text-fg-faint tabular-nums">
              {models.length} models / {detail.availableModelCount} available
            </p>
          ) : null}
        </div>
        <DialogBody ref={listRef} className="min-w-0 px-5 pb-5">
          {loading ? (
            <p role="status" className="py-6 text-sm text-fg-muted">
              Loading models...
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="space-y-3 py-4">
              <p className="break-words text-sm text-danger">{error}</p>
              <Button onClick={() => setRevision((value) => value + 1)}>
                <IconRefresh size={15} /> Retry
              </Button>
            </div>
          ) : null}
          {!loading && !error ? (
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((row) => {
                const model = models[row.index];
                if (!model) return null;
                return (
                  <div
                    key={model.id}
                    ref={virtualizer.measureElement}
                    data-index={row.index}
                    className="absolute top-0 left-0 flex w-full items-center gap-3 border-b border-hairline-soft py-3"
                    style={{ transform: `translateY(${row.start}px)` }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={model.name}>
                        {model.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-fg-faint" title={model.id}>
                        {model.id}
                      </p>
                    </div>
                    <div className="text-xs text-fg-muted tabular-nums">
                      <p>{model.contextWindow?.toLocaleString() ?? "Unknown"} context</p>
                      <p>{model.maxTokens?.toLocaleString() ?? "Unknown"} output</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button
                        disabled={!model.available || Boolean(testing)}
                        onClick={() => void testModel(model.id)}
                      >
                        {testing === model.id ? "Testing…" : "Test connection"}
                      </Button>
                      <Button
                        disabled={!model.available || Boolean(testing)}
                        onClick={() => void selectModel(model.id)}
                      >
                        Use model
                      </Button>
                    </div>
                    <span className="hidden w-20 text-right text-xs text-fg-faint sm:block">
                      {model.available ? "Available" : "Unavailable"}
                    </span>
                  </div>
                );
              })}
              {!models.length ? (
                <p className="py-6 text-sm text-fg-muted">
                  {detail?.models.length ? "No matching models." : "No models available."}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogBody>
      </DialogSurface>
    </Dialog.Root>
  );
}
