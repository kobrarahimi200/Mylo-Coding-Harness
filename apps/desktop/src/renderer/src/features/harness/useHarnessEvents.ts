import { useEffect, useState } from "react";
import type { AgentEventItem } from "../../../../shared/agent-events";
import { appendAgentEvents } from "../../../../shared/agent-events";
import type { AgentEvent } from "../../../../shared/contracts";

function relevant(event: AgentEvent): boolean {
  return (
    event.type.startsWith("harness.") ||
    [
      "tool.started",
      "tool.ended",
      "run.started",
      "session.status",
      "run.failed",
      "run.cancelled",
      "run.awaiting_review",
      "run.rejected",
      "runtime.error",
      "extension.notice",
    ].includes(event.type)
  );
}
export function useHarnessEvents(sessionId: string | undefined) {
  const [items, setItems] = useState<AgentEventItem[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setItems([]);
    setError(undefined);
    if (!sessionId) return;
    let active = true;
    let loading = true;
    const received: AgentEventItem[] = [];
    // Do not consume the chat hub's prepared messages; the chat owns that queue.
    const unsubscribe = window.modus.agent.onEvent((event) => {
      if (event.sessionId !== sessionId || !relevant(event)) return;
      const item = { id: crypto.randomUUID(), event, createdAt: new Date().toISOString() };
      if (loading) received.push(item);
      setItems((current) => appendAgentEvents(current, [item]));
    });
    void window.modus.agent
      .listEvents(sessionId)
      .then((all) => {
        loading = false;
        if (active) {
          const history = all.filter((item) => relevant(item.event));
          const seen = new Set(history.map((item) => JSON.stringify(item.event)));
          setItems(
            appendAgentEvents(
              history,
              received.filter((item) => !seen.has(JSON.stringify(item.event))),
            ),
          );
        }
        received.length = 0;
      })
      .catch((cause: unknown) => {
        loading = false;
        received.length = 0;
        if (active) setError(String(cause));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId]);
  return { items, error };
}
