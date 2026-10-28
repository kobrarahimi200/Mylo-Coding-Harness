import {
  IconCode,
  IconGitBranch,
  IconLayoutSidebarRight,
  IconPlayerStop,
  IconSettings,
} from "@tabler/icons-react";
import type { ModelInfo, WorkspaceInfo } from "../../../../shared/contracts";
export function WorkspaceHeader({
  workspace,
  branch,
  model,
  models,
  status,
  busy,
  onModel,
  onSettings,
  onToggleAgent,
  onStop,
  agentOpen,
}: {
  workspace: WorkspaceInfo | null;
  branch: string | undefined;
  model: string;
  models: ModelInfo[];
  status: string;
  busy: boolean;
  onModel(id: string): void;
  onSettings(): void;
  onToggleAgent(): void;
  onStop(): void;
  agentOpen: boolean;
}) {
  return (
    <header className="mylo-workspace-header">
      <div className="mylo-brand-mark">
        <IconCode size={20} />
      </div>
      <div className="mylo-brand">
        <strong>Mylo</strong>
        <span>CODING WORKSPACE</span>
      </div>
      <span className="mylo-header-divider" />
      <div className="mylo-workspace-name">
        <strong>{workspace?.displayName ?? "No project selected"}</strong>
        {branch ? (
          <span>
            <IconGitBranch size={13} />
            {branch}
          </span>
        ) : null}
      </div>
      <div className="mylo-header-actions">
        <span className={`mylo-status-pill ${busy ? "is-active" : ""}`} role="status">
          <i />
          {status}
        </span>
        <select
          aria-label="Workspace AI model"
          value={model}
          disabled={busy || !models.length}
          title={
            busy
              ? "Stop the task before changing its model"
              : "Select an available configured model"
          }
          onChange={(event) => onModel(event.target.value)}
        >
          {!models.some((m) => m.id === model) ? (
            <option value={model}>{model || "Connect a model"}</option>
          ) : null}
          {models
            .filter((m) => m.available)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
        {busy ? (
          <button type="button" className="mylo-button is-danger" onClick={onStop}>
            <IconPlayerStop size={14} />
            Stop
          </button>
        ) : null}
        <button
          className="mylo-icon-button"
          type="button"
          aria-label="Toggle Agent Workspace"
          aria-pressed={agentOpen}
          onClick={onToggleAgent}
        >
          <IconLayoutSidebarRight size={18} />
        </button>
        <button
          className="mylo-icon-button"
          type="button"
          aria-label="Open Settings"
          onClick={onSettings}
        >
          <IconSettings size={18} />
        </button>
      </div>
    </header>
  );
}
