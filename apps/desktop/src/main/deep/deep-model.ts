import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatOpenAI } from "@langchain/openai";

type PiModel = { provider: string; id: string; api: string; baseUrl: string };
type Auth = { apiKey?: string; headers?: Record<string, string>; baseUrl?: string };

// OAuth-backed providers hand out short-lived tokens that LangChain clients cannot refresh.
const UNSUPPORTED_PROVIDERS = new Set(["github-copilot", "openai-codex", "azure-openai-responses"]);

export function supportsDeepAgent(model: Pick<PiModel, "provider" | "api">): boolean {
  if (UNSUPPORTED_PROVIDERS.has(model.provider)) return false;
  return (
    model.api === "anthropic-messages" ||
    model.api === "openai-completions" ||
    model.api === "openai-responses"
  );
}

export function createDeepChatModel(model: PiModel, auth: Auth): BaseLanguageModel | undefined {
  if (!supportsDeepAgent(model) || !auth.apiKey) return undefined;
  const baseUrl = auth.baseUrl ?? model.baseUrl;
  if (model.api === "anthropic-messages")
    return new ChatAnthropic({
      model: model.id,
      apiKey: auth.apiKey,
      ...(baseUrl ? { anthropicApiUrl: baseUrl } : {}),
      ...(auth.headers ? { clientOptions: { defaultHeaders: auth.headers } } : {}),
    });
  return new ChatOpenAI({
    model: model.id,
    apiKey: auth.apiKey,
    useResponsesApi: model.api === "openai-responses",
    configuration: {
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      ...(auth.headers ? { defaultHeaders: auth.headers } : {}),
    },
  });
}
