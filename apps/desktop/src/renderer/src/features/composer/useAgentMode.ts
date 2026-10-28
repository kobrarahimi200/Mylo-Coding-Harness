import { useCallback, useEffect, useState } from "react";
import { AGENT_MODES, type AgentMode } from "../../../../shared/harness";

const KEY = "mylo.agentMode";
const DEFAULT_MODE: AgentMode = "ask";

function parse(value: string | null): AgentMode | undefined {
  return AGENT_MODES.find((mode) => mode === value);
}

export function readAgentMode(sessionId?: string): AgentMode {
  try {
    return (
      (sessionId ? parse(localStorage.getItem(`${KEY}.${sessionId}`)) : undefined) ??
      parse(localStorage.getItem(KEY)) ??
      DEFAULT_MODE
    );
  } catch {
    return DEFAULT_MODE;
  }
}

export function writeAgentMode(mode: AgentMode, sessionId?: string): void {
  try {
    localStorage.setItem(KEY, mode);
    if (sessionId) localStorage.setItem(`${KEY}.${sessionId}`, mode);
  } catch {
    /* Storage can be unavailable; the mode then lasts for this window only. */
  }
}

/** The chosen mode is explicit, persisted per session and never switched implicitly. */
export function useAgentMode(sessionId?: string): readonly [AgentMode, (mode: AgentMode) => void] {
  const [mode, setMode] = useState<AgentMode>(() => readAgentMode(sessionId));
  useEffect(() => setMode(readAgentMode(sessionId)), [sessionId]);
  const change = useCallback(
    (next: AgentMode) => {
      writeAgentMode(next, sessionId);
      setMode(next);
    },
    [sessionId],
  );
  return [mode, change] as const;
}
