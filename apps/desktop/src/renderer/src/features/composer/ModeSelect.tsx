import type { AgentMode } from "../../../../shared/harness";
import { cn } from "../../lib/cn";

const MODES: Array<{ id: AgentMode; label: string; hint: string }> = [
  { id: "ask", label: "Ask", hint: "Answer questions. Read-only; never changes files." },
  {
    id: "plan",
    label: "Plan",
    hint: "Inspect the repository and propose a plan for approval. No edits.",
  },
  {
    id: "agent",
    label: "Agent",
    hint: "Execute an approved plan with tools, run validation, then review.",
  },
];

export function ModeSelect({
  mode,
  disabled,
  onChange,
}: {
  mode: AgentMode;
  disabled?: boolean;
  onChange(mode: AgentMode): void;
}) {
  return (
    <fieldset
      aria-label="Mode"
      className="m-0 flex shrink-0 items-center rounded-full border-0 bg-chip p-0.5"
    >
      {MODES.map((item) => (
        <button
          aria-pressed={mode === item.id}
          className={cn(
            "rounded-full px-2 py-0.5 text-2xs transition-colors disabled:opacity-60",
            mode === item.id ? "bg-fg text-canvas" : "text-fg-muted hover:text-fg",
          )}
          disabled={disabled}
          key={item.id}
          onClick={() => onChange(item.id)}
          title={item.hint}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </fieldset>
  );
}
