import { useEffect, useRef } from "react";
import { loadMonaco, MONACO_THEME } from "../../lib/monaco";

export function CodeDiff({
  before,
  after,
  onChange,
}: {
  before: string;
  after: string;
  onChange?(text: string): void;
}) {
  const host = useRef<HTMLElement>(null);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !host.current) return;
      const original = monaco.editor.createModel(before, "plaintext");
      const modified = monaco.editor.createModel(after, "plaintext");
      const editor = monaco.editor.createDiffEditor(host.current, {
        theme: MONACO_THEME,
        automaticLayout: true,
        readOnly: !change.current,
        renderSideBySide: false,
        minimap: { enabled: false },
        fontSize: 12,
      });
      editor.setModel({ original, modified });
      const subscription = modified.onDidChangeContent(() => change.current?.(modified.getValue()));
      cleanup = () => {
        subscription.dispose();
        editor.dispose();
        original.dispose();
        modified.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [before, after]);
  return (
    <section
      ref={host}
      className="h-72 min-w-0 border border-hairline"
      aria-label="Proposed code diff"
    />
  );
}
