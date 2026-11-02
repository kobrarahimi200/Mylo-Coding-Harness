export type PlanSurface = "workspace" | "plan-tab" | "chat" | "dialog";

/**
 * The single surface that owns the interactive plan approval for the active session.
 * Exactly one is interactive at a time; "dialog" is the fallback when no plan view is visible,
 * so a pending approval is never lost when the sidebar or a tab is closed.
 */
export function planSurface(input: { agentOpen: boolean; panel: string }): PlanSurface {
  if (input.agentOpen) return "workspace";
  if (input.panel === "plan") return "plan-tab";
  if (input.panel === "chat") return "chat";
  return "dialog";
}
