import { useEffect, useRef, useState } from "react";
import { loadMonaco, MONACO_THEME } from "../../lib/monaco";

export function CodeDiff({
  before,
  after,
  onChange,
  onReady,
}: {
  before: string;
  after: string;
  onChange?(text: string): void;
  onReady?(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const change = useRef(onChange);
  const ready = useRef(onReady);
  change.current = onChange;
  ready.current = onReady;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    setLoading(true);
    setError(undefined);
    void loadMonaco()
      .then(async (monaco) => {
        if (disposed || !host.current) return;
        const original = monaco.editor.createModel(before, "plaintext");
        const modified = monaco.editor.createModel(after, "plaintext");
        const editor = monaco.editor.createDiffEditor(host.current, {
          theme: MONACO_THEME,
          automaticLayout: true,
          readOnly: !change.current,
          renderSideBySide: false,
          minimap: { enabled: false },
          // These short-lived review editors do not need occurrence searches.
          // Monaco's highlighter leaves an unobserved Delayer rejection when
          // a focused diff is closed during its pending search.
          occurrencesHighlight: "off",
          selectionHighlight: false,
          fontSize: 12,
          maxComputationTime: 1000,
        });
        const viewModel = editor.createViewModel({ original, modified });
        editor.setModel(viewModel);
        const subscription = modified.onDidChangeContent(() =>
          change.current?.(modified.getValue()),
        );
        cleanup = () => {
          subscription.dispose();
          const release = () => {
            editor.dispose();
            viewModel.dispose();
            original.dispose();
            modified.dispose();
          };
          // Monaco's async diff computation can reject with Canceled if its
          // models are disposed mid-computation. Let it settle before disposal.
          void viewModel.waitForDiff().then(release, (caught: unknown) => {
            console.error("Unable to finish code diff before disposal.", caught);
            release();
          });
        };
        await viewModel.waitForDiff();
        if (!disposed) {
          setLoading(false);
          ready.current?.();
        }
      })
      .catch((caught: unknown) => {
        console.error("Unable to initialize code diff.", caught);
        if (!disposed) {
          setLoading(false);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [before, after]);
  return (
    <section
      className="relative h-72 min-w-0 border border-hairline"
      aria-label="Proposed code diff"
      aria-busy={loading}
    >
      <div ref={host} className="h-full min-w-0" />
      {loading ? (
        <p className="absolute inset-x-0 top-2 px-3 text-xs text-fg-muted">Loading code diff…</p>
      ) : null}
      {error ? (
        <p role="alert" className="absolute inset-x-0 top-2 bg-panel px-3 text-xs text-danger">
          Unable to show code diff: {error}
        </p>
      ) : null}
    </section>
  );
}
