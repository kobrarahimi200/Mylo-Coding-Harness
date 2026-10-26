import { expect, it } from "vitest";
import type { AgentSessionInfo, WorkspaceInfo } from "../../../shared/contracts";
import { restoreWorkspaceSelection } from "./workspace-selection";

it("starts with null workspace and no session on a clean installation", () => {
  expect(restoreWorkspaceSelection([], [], "deleted", "stale")).toEqual({
    workspace: null,
    sessionId: undefined,
  });
});
it("restores only sessions belonging to the restored project", () => {
  const first = { id: "one" } as WorkspaceInfo;
  const selected = { id: "two" } as WorkspaceInfo;
  const session = { id: "session", workspaceId: "two" } as AgentSessionInfo;
  expect(restoreWorkspaceSelection([first, selected], [session], "two", "session")).toEqual({
    workspace: selected,
    sessionId: "session",
  });
  expect(restoreWorkspaceSelection([first], [session], "two", "session")).toEqual({
    workspace: first,
    sessionId: undefined,
  });
});
