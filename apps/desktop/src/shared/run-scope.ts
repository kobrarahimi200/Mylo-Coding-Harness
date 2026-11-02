import type { AgentEventItem } from "./agent-events";

const TERMINAL = [
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.awaiting_review",
  "run.rejected",
];

/** Id of the newest run that has started in this event log. */
export function latestRunId(items: AgentEventItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const event = items[index]?.event;
    if (event?.type === "run.started" || event?.type === "harness.task") return event.runId;
  }
  return undefined;
}

/**
 * A terminal event is stale when it names a run that started before the newest
 * one. A late event from an older run (rapid session switching, replayed
 * history) must not fail, complete or reopen the newer run. Events naming a run
 * we never saw start are kept, since they cannot be proven older.
 */
export function scopeToLatestRun(items: AgentEventItem[]): AgentEventItem[] {
  const order: string[] = [];
  for (const { event } of items) {
    if (event.type !== "run.started" && event.type !== "harness.task") continue;
    if (!order.includes(event.runId)) order.push(event.runId);
  }
  const latest = order.length - 1;
  return items.filter(({ event }) => {
    if (!TERMINAL.includes(event.type)) return true;
    const index = order.indexOf((event as { runId?: string }).runId ?? "");
    return index === -1 || index === latest;
  });
}
