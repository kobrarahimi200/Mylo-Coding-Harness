import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
  type InlineExtension,
  isToolCallEventType,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentEvent, QuestionPrompt } from "../../shared/contracts";
import { resolveWithin } from "../files/path-within";
import { requestQuestions } from "../interaction/question-broker";
import { auditHarnessEvent } from "./audit-log";
import type { TaskPlan } from "./planning";
import { sandboxOperations } from "./sandbox";

type ApprovalContext = {
  cwd: string;
  sessionId: string;
  emit(event: AgentEvent): void;
  getPlan?(): TaskPlan | undefined;
  isPlanning?(): boolean;
  onCodeChanged?(): void;
  onWillChange?(change: { path: string; after: string }): void;
};

export type ToolAssessment =
  | { allowed: true }
  | { allowed: false; reason: string; approvalRequired?: boolean };

const ISOLATION_REQUIRED =
  /\b(?:sudo|doas|diskpart|format|shutdown|mkfs|dd\s+if=|reg\s+(?:add|delete)|rm\s+-rf|remove-item\s+.*-recurse|curl\b.*\|\s*(?:bash|sh)|invoke-expression)\b/i;

export function requiresExecutionIsolation(command: string): boolean {
  return ISOLATION_REQUIRED.test(command);
}

export function assertToolPathsWithinWorkspace(root: string, event: ToolCallEvent): void {
  const input = event.input as Record<string, unknown>;
  const paths = [input.path, input.cwd, input.filePath, input.file_path, input.paths]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const canonicalRoot = realpathSync(root);
  for (const path of paths) {
    const resolved = resolveWithin(canonicalRoot, path);
    let existing = resolved;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) throw new Error("Unable to resolve a workspace tool path.");
      existing = parent;
    }
    resolveWithin(canonicalRoot, realpathSync(existing));
  }
}

export function assessToolCall(root: string, event: ToolCallEvent): ToolAssessment {
  try {
    assertToolPathsWithinWorkspace(root, event);
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const command =
    isToolCallEventType("bash", event) || isToolCallEventType("powershell", event)
      ? event.input.command
      : undefined;
  if (command && requiresExecutionIsolation(command)) {
    return {
      allowed: false,
      reason:
        "This command is blocked by the harness sensitive-command policy even inside the sandbox. It was not run.",
    };
  }
  if (
    isToolCallEventType("bash", event) ||
    isToolCallEventType("powershell", event) ||
    isToolCallEventType("write", event) ||
    isToolCallEventType("edit", event)
  ) {
    return { allowed: false, approvalRequired: true, reason: "Human approval is required." };
  }
  if (["read", "ls", "find", "grep", "tool_search", "mylo_step"].includes(event.toolName))
    return { allowed: true };
  return {
    allowed: false,
    reason: "This extension tool has no workspace confinement policy and is blocked.",
  };
}

export async function approveToolCall(
  context: ApprovalContext,
  event: ToolCallEvent,
): Promise<{ block?: boolean; reason?: string; terminate?: boolean }> {
  if (context.isPlanning?.() && !["read", "ls", "find", "grep"].includes(event.toolName))
    return {
      block: true,
      reason: "Planning is read-only. Execution needs an approved plan.",
      terminate: true,
    };
  const changes: Extract<AgentEvent, { type: "harness.change" }>[] = [];
  const assessment = assessToolCall(context.cwd, event);
  if (!assessment.allowed) {
    if (!assessment.approvalRequired) {
      await auditHarnessEvent({
        type: "tool.blocked",
        sessionId: context.sessionId,
        toolName: event.toolName,
        outcome: "blocked",
        detail: assessment.reason,
      });
      return { block: true, reason: assessment.reason, terminate: true };
    }
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      if (isToolCallEventType("write", event)) {
        const edited = await askForEditedText(context, event, event.input.content);
        if (edited === undefined)
          return { block: true, reason: "Code change rejected.", terminate: true };
        const violation = currentPathViolation(context.cwd, event);
        if (violation) return violation;
        const path = resolveWithin(context.cwd, event.input.path);
        const before = existsSync(path) ? readFileSync(path, "utf8") : "";
        changes.push({
          type: "harness.change",
          sessionId: context.sessionId,
          path: event.input.path,
          before,
          after: edited,
        });
        event.input.content = edited;
      } else if (isToolCallEventType("edit", event)) {
        const path = resolveWithin(context.cwd, event.input.path);
        const before = readFileSync(path, "utf8");
        let after = before;
        for (const edit of event.input.edits) {
          const edited = await askForEditedText(context, event, edit.newText);
          if (edited === undefined)
            return { block: true, reason: "Code change rejected.", terminate: true };
          const violation = currentPathViolation(context.cwd, event);
          if (violation) return violation;
          after = after.replace(edit.oldText, edited);
          edit.newText = edited;
        }
        changes.push({
          type: "harness.change",
          sessionId: context.sessionId,
          path: event.input.path,
          before,
          after,
        });
      }
    } else {
      const decision = await ask(context, event, "Approve this command?", [
        { label: "Approve once" },
        { label: "Reject" },
      ]);
      if (decision !== "Approve once") {
        await auditHarnessEvent({
          type: "approval",
          sessionId: context.sessionId,
          toolName: event.toolName,
          outcome: "rejected",
        });
        return { block: true, reason: "The user rejected this action.", terminate: true };
      }
    }
  }

  try {
    for (const change of changes) context.onWillChange?.(change);
  } catch (error) {
    return {
      block: true,
      terminate: true,
      reason: `Unable to preserve a file checkpoint: ${String(error)}`,
    };
  }
  for (const change of changes) context.emit(change);
  await auditHarnessEvent({
    type: "approval",
    sessionId: context.sessionId,
    toolName: event.toolName,
    outcome: "approved",
  });
  return currentPathViolation(context.cwd, event) ?? {};
}

function currentPathViolation(root: string, event: ToolCallEvent) {
  // An approval dialog can remain open while another process changes symlinks.
  // Recheck before reading the approved proposal and again at the tool boundary.
  try {
    assertToolPathsWithinWorkspace(root, event);
    return undefined;
  } catch (error) {
    return {
      block: true,
      reason: error instanceof Error ? error.message : String(error),
      terminate: true,
    };
  }
}

function toolDetail(event: ToolCallEvent): string {
  const input = JSON.stringify(event.input, (_key, value: unknown) => value);
  return input.length > 6000 ? `${input.slice(0, 6000)}\n[details truncated]` : input;
}

async function ask(
  context: ApprovalContext,
  event: ToolCallEvent,
  header: string,
  options: QuestionPrompt["options"],
): Promise<string | undefined> {
  const response = await requestQuestions({
    sessionId: context.sessionId,
    emit: context.emit,
    questions: [
      {
        id: "tool-approval",
        header,
        detail: `${event.toolName}\n${toolDetail(event)}`,
        options,
      },
    ],
  });
  if (response.skipped) return undefined;
  return response.answers[0]?.selected[0];
}

async function askForEditedText(
  context: ApprovalContext,
  event: ToolCallEvent,
  proposed: string,
): Promise<string | undefined> {
  const response = await requestQuestions({
    sessionId: context.sessionId,
    emit: context.emit,
    questions: [
      {
        id: "edit-proposed-change",
        header: "Review and apply the code change",
        detail: `${event.toolName}\n${toolDetail(event)}`,
        prefill: proposed,
        codeChange: {
          path: String((event.input as Record<string, unknown>).path ?? "change"),
          before: isToolCallEventType("write", event)
            ? (() => {
                try {
                  return readFileSync(resolveWithin(context.cwd, event.input.path), "utf8");
                } catch {
                  return "";
                }
              })()
            : isToolCallEventType("edit", event)
              ? (event.input.edits.find((edit) => edit.newText === proposed)?.oldText ?? "")
              : "",
          after: proposed,
        },
        options: [],
      },
    ],
  });
  if (response.skipped) return undefined;
  return response.answers[0]?.custom;
}

export function createHarnessApprovalExtension(context: ApprovalContext): InlineExtension {
  return {
    name: "harness-approval",
    factory: (pi) => {
      pi.registerTool({
        name: "mylo_step",
        label: "Report plan step",
        description:
          "Report the current approved execution plan step and its actual status. Does not edit files or run commands.",
        parameters: Type.Object({
          step: Type.Integer({ minimum: 1 }),
          status: Type.Union([
            Type.Literal("running"),
            Type.Literal("completed"),
            Type.Literal("failed"),
          ]),
          detail: Type.String(),
        }),
        execute: async (_id, input) => {
          const plan = context.getPlan?.();
          if (!plan || context.isPlanning?.() || input.step > plan.steps.length)
            throw new Error("A valid approved plan step is required.");
          context.emit({
            type: "harness.step",
            sessionId: context.sessionId,
            index: input.step - 1,
            status: input.status,
            detail: input.detail,
          });
          return {
            content: [{ type: "text", text: `Step ${input.step}: ${input.status}` }],
            details: {},
          };
        },
      });
      pi.registerTool(
        createBashToolDefinition(context.cwd, {
          operations: sandboxOperations(context.cwd),
          exposeSessionEnvironment: false,
        }),
      );
      pi.registerTool(
        createPowerShellToolDefinition(context.cwd, {
          operations: sandboxOperations(context.cwd, "pwsh"),
          exposeSessionEnvironment: false,
        }),
      );
      pi.on("before_agent_start", (event) => {
        const plan = context.getPlan?.();
        return plan
          ? {
              systemPrompt: `${event.systemPrompt}\nShell commands use an OS sandbox. On Windows they run in WSL + bubblewrap; use Linux commands there. Use relative workspace paths. Network access is disabled. Use write/edit tools for source edits so they have rollback checkpoints; shell changes are not covered. Report each actual plan step using mylo_step before starting and when it completes or fails.\n\nHuman-approved task plan:\n${JSON.stringify(plan)}`,
            }
          : undefined;
      });
      pi.on("user_bash", () => ({
        result: {
          output: "Direct shell shortcuts are disabled. Ask the agent to run an approved command.",
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      }));
      pi.on("tool_call", (event) => approveToolCall(context, event));
      pi.on("tool_execution_start", async (event) => {
        await auditHarnessEvent({
          type: "tool.started",
          sessionId: context.sessionId,
          toolName: event.toolName,
          outcome: "started",
        });
      });
      pi.on("tool_execution_end", async (event) => {
        await auditHarnessEvent({
          type: "tool.completed",
          sessionId: context.sessionId,
          toolName: event.toolName,
          outcome: event.isError ? "failed" : "completed",
        });
        if (!event.isError && ["edit", "write", "bash", "powershell"].includes(event.toolName))
          context.onCodeChanged?.();
      });
    },
  };
}
