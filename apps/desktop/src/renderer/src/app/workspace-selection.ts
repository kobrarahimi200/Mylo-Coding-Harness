import type { AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
export function restoreWorkspaceSelection(
  workspaces: WorkspaceInfo[],
  sessions: AgentSessionInfo[],
  savedWorkspaceId: string | null,
  savedSessionId: string | null,
) {
  const workspace =
    workspaces.find((item) => item.id === savedWorkspaceId) ?? workspaces[0] ?? null;
  const session = workspace
    ? sessions.find((item) => item.id === savedSessionId && item.workspaceId === workspace.id)
    : undefined;
  return { workspace, sessionId: session?.id };
}
