import { useEffect, useRef } from "react";
import type {
  AgentSessionInfo,
  ModelSettingsState,
  WorkspaceInfo,
} from "../../../shared/contracts";
import {
  beginInitialAppHydration,
  type InitialAppHydration,
  loadInitialWorkspaceState,
} from "./initial-hydration";
import { reportRendererStartup } from "./startup-report";
import { restoreWorkspaceSelection } from "./workspace-selection";

export function useInitialHydration({
  setWorkspaces,
  setActiveWorkspace,
  setAgentSessions,
  setActiveSessionId,
  applyModelSettings,
  setSessionCreateError,
}: {
  setWorkspaces(workspaces: WorkspaceInfo[]): void;
  setActiveWorkspace(workspace: WorkspaceInfo | null): void;
  setAgentSessions(sessions: AgentSessionInfo[]): void;
  setActiveSessionId(id: string | undefined): void;
  applyModelSettings(settings: ModelSettingsState): void;
  setSessionCreateError(message: string | undefined): void;
}) {
  const initialHydrationRef = useRef<InitialAppHydration | null>(null);
  useEffect(() => {
    if (!window.modus) return;
    let active = true;
    if (!initialHydrationRef.current) {
      initialHydrationRef.current = beginInitialAppHydration(window.modus);
    }
    const hydration = initialHydrationRef.current;
    const load = <T>(resource: string, result: Promise<T>, apply: (value: T) => void) => {
      void result
        .then((value) => {
          if (active) apply(value);
        })
        .catch((error: unknown) => {
          if (active) {
            console.error(`Unable to load initial ${resource}.`, error);
            setSessionCreateError(`Unable to load ${resource}: ${String(error)}`);
          }
        });
    };
    load(
      "workspace and session state",
      loadInitialWorkspaceState(hydration),
      ({ workspaces: items, sessions, errors }) => {
        if (errors.length) setSessionCreateError(errors.join("\n"));
        setWorkspaces(items);
        setAgentSessions(sessions);
        const restored = restoreWorkspaceSelection(
          items,
          sessions,
          localStorage.getItem("mylo.workspace"),
          localStorage.getItem("mylo.session"),
        );
        setActiveWorkspace(restored.workspace);
        setActiveSessionId(restored.sessionId);
      },
    );
    load("model settings", hydration.modelSettings, applyModelSettings);
    void hydration.settled.then(() => {
      if (active) reportRendererStartup("renderer.initial-hydration-settled");
    });
    return () => {
      active = false;
    };
  }, [
    setWorkspaces,
    setActiveWorkspace,
    setAgentSessions,
    setActiveSessionId,
    applyModelSettings,
    setSessionCreateError,
  ]);
}
