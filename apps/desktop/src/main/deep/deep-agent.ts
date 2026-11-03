import { randomUUID } from "node:crypto";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { AgentEvent } from "../../shared/contracts";

const READ_ONLY = "Deep mode is read-only. Describe the change in your answer instead.";

/** Reads the workspace but refuses every mutation, so Deep Agents can never bypass approvals. */
export class ReadOnlyFilesystemBackend extends FilesystemBackend {
  override async write() {
    return { error: READ_ONLY };
  }
  override async edit() {
    return { error: READ_ONLY };
  }
  override async delete() {
    return { error: READ_ONLY };
  }
  override async uploadFiles(files: Array<[string, Uint8Array]>) {
    return files.map(([path]) => ({ path, error: "permission_denied" as const }));
  }
}

const SYSTEM_PROMPT = `You are a senior engineer answering a complex question about the user's repository.
Plan with write_todos, split independent investigations across sub-agents, and read real files before answering.
You are read-only: never claim to have changed files. Cite file paths. Finish with a clear, concise answer in Markdown.`;

export type DeepAgentInput = {
  sessionId: string;
  cwd: string;
  prompt: string;
  history?: string;
  model: BaseLanguageModel;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
};

type StreamEvent = {
  event: string;
  name?: string;
  run_id?: string;
  metadata?: { checkpoint_ns?: string };
  data?: { chunk?: { content?: unknown }; input?: unknown; output?: unknown };
};

function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part
        ? String(part.text)
        : "",
    )
    .join("");
}

function outputText(output: unknown): string {
  const content = (output as { content?: unknown } | undefined)?.content ?? output;
  const text = chunkText(content);
  if (text) return text.slice(0, 4000);
  try {
    return JSON.stringify(content)?.slice(0, 4000) ?? "";
  } catch {
    return "";
  }
}

// Sub-agent runs are nested inside a `tools:` namespace; only the lead agent's text is the answer.
const isNested = (event: StreamEvent) => (event.metadata?.checkpoint_ns ?? "").includes("|");

export async function runDeepAgent(input: DeepAgentInput): Promise<string> {
  const { sessionId, emit, signal } = input;
  const agent = createDeepAgent({
    model: input.model,
    systemPrompt: SYSTEM_PROMPT,
    backend: new ReadOnlyFilesystemBackend({ rootDir: input.cwd, virtualMode: true }),
  });
  const messageId = `deep:${randomUUID()}`;
  let started = false;
  let answer = "";
  const content = input.history
    ? `Earlier conversation:\n${input.history}\n\nQuestion:\n${input.prompt}`
    : input.prompt;
  const stream = agent.streamEvents(
    { messages: [{ role: "user", content }] },
    { version: "v2", signal, recursionLimit: 120 },
  ) as AsyncIterable<StreamEvent>;
  for await (const event of stream) {
    if (signal.aborted) break;
    if (event.event === "on_chat_model_stream" && !isNested(event)) {
      const delta = chunkText(event.data?.chunk?.content);
      if (!delta) continue;
      if (!started) {
        started = true;
        emit({ type: "message.started", sessionId, messageId, role: "assistant" });
      }
      answer += delta;
      emit({ type: "message.delta", sessionId, messageId, delta });
    } else if (event.event === "on_tool_start" && event.run_id && event.name) {
      emit({
        type: "tool.started",
        sessionId,
        toolCallId: event.run_id,
        toolName: event.name,
        args: event.data?.input,
      });
    } else if (event.event === "on_tool_end" && event.run_id && event.name) {
      emit({
        type: "tool.ended",
        sessionId,
        toolCallId: event.run_id,
        output: outputText(event.data?.output),
        isError: false,
      });
    }
  }
  if (started) emit({ type: "message.completed", sessionId, messageId });
  return answer;
}
