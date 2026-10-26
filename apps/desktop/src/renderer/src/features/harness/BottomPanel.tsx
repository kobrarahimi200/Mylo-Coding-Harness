import { lazy, Suspense, useState } from "react";
import type { AgentEventItem } from "../../../../shared/agent-events";
import type { WorkspaceInfo } from "../../../../shared/contracts";
import { HarnessTests, HarnessTimeline } from "./HarnessPanels";

const TerminalPanel = lazy(() =>
  import("../terminal/TerminalPanel").then((module) => ({ default: module.TerminalPanel })),
);
export function BottomPanel({
  items,
  workspace,
  tab,
  onTabChange,
  onRunChecks,
  canRunChecks,
}: {
  items: AgentEventItem[];
  workspace: WorkspaceInfo | null;
  tab: string;
  onTabChange(tab: string): void;
  onRunChecks(): void;
  canRunChecks: boolean;
}) {
  const [height, setHeight] = useState(200);
  return (
    <section className="mylo-bottom-panel" style={{ height }} aria-label="Output panel">
      <button
        aria-label="Resize output panel"
        className="h-1 w-full cursor-row-resize bg-hairline"
        type="button"
        onPointerDown={(event) => {
          const start = event.clientY,
            initial = height;
          const button = event.currentTarget;
          button.setPointerCapture(event.pointerId);
          button.onpointermove = (move) =>
            setHeight(
              Math.max(100, Math.min(window.innerHeight * 0.6, initial + start - move.clientY)),
            );
          button.onpointerup = () => {
            button.onpointermove = null;
            button.onpointerup = null;
          };
        }}
      />
      <div className="flex h-8 shrink-0 items-center gap-4 border-b border-hairline px-4">
        {["terminal", "tests", "logs", "problems"].map((name) => (
          <button
            type="button"
            key={name}
            onClick={() => onTabChange(name)}
            className={`text-xs capitalize ${tab === name ? "text-accent" : "text-fg-faint"}`}
          >
            {name}
          </button>
        ))}
        {tab === "tests" ? (
          <button
            type="button"
            className="ml-auto text-xs text-accent disabled:opacity-40"
            disabled={!canRunChecks}
            onClick={onRunChecks}
          >
            Run checks
          </button>
        ) : null}
        <button type="button" className="ml-auto text-xs" onClick={() => onTabChange("")}>
          Hide
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "terminal" ? (
          <Suspense fallback={<p className="p-3 text-xs">Loading terminal…</p>}>
            <TerminalPanel cwd={workspace?.rootPath} workspaceId={workspace?.id} />
          </Suspense>
        ) : tab === "logs" ? (
          <HarnessTimeline items={items} />
        ) : (
          <HarnessTests items={items} problemsOnly={tab === "problems"} />
        )}
      </div>
    </section>
  );
}
