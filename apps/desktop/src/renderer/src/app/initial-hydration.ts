import type {
  AgentSessionInfo,
  ModelSettingsState,
  WorkspaceInfo,
} from "../../../shared/contracts";

export type InitialAppDataSource = {
  workspace: {
    list(): Promise<WorkspaceInfo[]>;
  };
  agent: {
    list(): Promise<AgentSessionInfo[]>;
  };
  model: {
    settings(): Promise<ModelSettingsState>;
  };
};

export type InitialAppHydration = {
  workspaces: Promise<WorkspaceInfo[]>;
  sessions: Promise<AgentSessionInfo[]>;
  modelSettings: Promise<ModelSettingsState>;
  settled: Promise<void>;
};

export async function loadInitialWorkspaceState(hydration: InitialAppHydration) {
  const [workspaces, sessions] = await Promise.allSettled([
    hydration.workspaces,
    hydration.sessions,
  ]);
  return {
    workspaces: workspaces.status === "fulfilled" ? workspaces.value : [],
    sessions: sessions.status === "fulfilled" ? sessions.value : [],
    errors: [workspaces, sessions].flatMap((result, index) =>
      result.status === "rejected"
        ? [`Unable to load ${index === 0 ? "projects" : "sessions"}: ${String(result.reason)}`]
        : [],
    ),
  };
}

/** Starts the independent first-screen reads together without coupling their failures. */
export function beginInitialAppHydration(api: InitialAppDataSource): InitialAppHydration {
  const sessions = api.agent.list();
  // Native session discovery also discovers workspaces; read recents after it settles.
  const workspaces = sessions.catch(() => []).then(() => api.workspace.list());
  const modelSettings = api.model.settings();
  const pending = [workspaces, sessions, modelSettings];

  return {
    workspaces,
    sessions,
    modelSettings,
    settled: Promise.allSettled(pending).then(() => undefined),
  };
}
