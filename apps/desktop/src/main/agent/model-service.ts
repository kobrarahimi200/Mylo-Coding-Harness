import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import {
  ModelRegistry,
  ModelRuntime,
  resolveModelScopeWithDiagnostics,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { shell } from "electron";
import type {
  ModelInfo,
  ModelProviderDetail,
  ModelProviderInfo,
  ModelSettingsState,
  ThinkingLevel,
  ThinkingOption,
} from "../../shared/contracts";
import { classifyFailure, type TaskFailure } from "../../shared/task-failure";
import { getPiCliAgentDir } from "./agent-paths";
import { createAgentSettings } from "./agent-settings";
import { diagnoseModelSelection, logProviderFailure } from "./model-diagnostics";

let initialization: Promise<ModelRuntime> | undefined;
let modelRuntimeSnapshot: ModelRuntime | undefined;
let registry: ModelRegistry | undefined;
let refreshErrors: string[] = [];
let chatGPTModels: Map<string, string> | undefined;

export function getModelRuntime(): Promise<ModelRuntime> {
  initialization ??= (async () => {
    const runtime = await ModelRuntime.create({
      authPath: join(getPiCliAgentDir(), "auth.json"),
      modelsPath: join(getPiCliAgentDir(), "models.json"),
    });
    await runtime.refresh({ allowNetwork: false });
    modelRuntimeSnapshot = runtime;
    registry = new ModelRegistry(runtime);
    refreshErrors = [];
    await loadChatGPTModels(runtime);
    return runtime;
  })().catch((error: unknown) => {
    initialization = undefined;
    refreshErrors = [error instanceof Error ? error.message : String(error)];
    throw error;
  });
  return initialization;
}

export async function refreshRemoteModelCatalog(): Promise<ModelSettingsState> {
  const runtime = await getModelRuntime();
  const result = await runtime.refresh({ allowNetwork: true });
  refreshErrors = [...result.errors].map(([provider, error]) => `${provider}: ${error.message}`);
  if (result.aborted) refreshErrors.push("Model refresh was cancelled.");
  await loadChatGPTModels(runtime);
  return getModelSettings();
}

export function getModelRegistry(): ModelRegistry {
  if (!registry) throw new Error("Model runtime has not been initialized.");
  return registry;
}

export function modelToId(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

export function findModel(reference: string | undefined): Model<Api> | undefined {
  if (!reference || !registry) return undefined;
  const separator = reference.indexOf("/");
  if (separator < 1) return undefined;
  const provider = reference.slice(0, separator),
    id = reference.slice(separator + 1);
  if (
    provider === "openai" &&
    modelRuntimeSnapshot?.isUsingOAuth(provider) &&
    chatGPTModels &&
    !chatGPTModels.has(id)
  )
    return undefined;
  return getModelRegistry().find(provider, id);
}

function thinkingOptions(model: Model<Api>): ThinkingOption[] {
  return getSupportedThinkingLevels(model).map((level) => {
    const wire = model.thinkingLevelMap?.[level];
    const value = typeof wire === "string" && wire ? wire : level;
    return { value, label: value, level, ...(value !== level ? { wireValue: value } : {}) };
  });
}

export function resolveModelThinking(
  model: Model<Api>,
  variant?: string,
  settings = createAgentSettings(),
) {
  const options = thinkingOptions(model);
  const preferred =
    settings.getModelThinkingLevel(model.provider, model.id) ??
    settings.getDefaultThinkingLevel() ??
    "off";
  const selected = variant
    ? options.find((option) => option.value === variant)
    : (options.find((option) => option.level === preferred) ?? options[0]);
  if (!selected) throw new Error(`Thinking option is not available for ${modelToId(model)}.`);
  return { model, thinkingLevel: selected.level, variant: selected.value };
}

function modelToInfo(model: Model<Api>, settings: SettingsManager): ModelInfo {
  const thinking = resolveModelThinking(model, undefined, settings);
  const options = thinkingOptions(model);
  return {
    id: modelToId(model),
    provider: model.provider,
    providerName: getModelRegistry().getProviderDisplayName(model.provider),
    name:
      model.provider === "openai" && modelRuntimeSnapshot?.isUsingOAuth("openai")
        ? (chatGPTModels?.get(model.id) ?? model.name)
        : model.name,
    available: getModelRegistry().hasConfiguredAuth(model),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    supportsThinking: model.reasoning,
    thinkingLevel: thinking.thinkingLevel,
    thinkingLevels: options.map((option) => option.level),
    thinkingVariant: thinking.variant,
    thinkingOptions: options,
  };
}

export function listModels(settings = createAgentSettings()): ModelInfo[] {
  if (!registry) return [];
  return getModelRegistry()
    .getAvailable()
    .filter(accountAllowsModel)
    .map((model) => modelToInfo(model, settings))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

export function getModelInfo(reference: string | undefined): ModelInfo | undefined {
  const model = findModel(reference);
  return model ? modelToInfo(model, createAgentSettings()) : undefined;
}

export function listProviders(): ModelProviderInfo[] {
  if (!initialization) return [];
  const registry = getModelRegistry();
  return [...new Set(registry.getAll().map((model) => model.provider))]
    .map((id) => {
      const models = registry.getAll().filter((model) => model.provider === id);
      const available = models.filter(
        (model) => registry.hasConfiguredAuth(model) && accountAllowsModel(model),
      );
      const status = registry.getProviderAuthStatus(id);
      const source = providerConfigSource(status.source);
      return {
        id,
        name: registry.getProviderDisplayName(id),
        configured: status.configured,
        modelCount: models.length,
        availableModelCount: available.length,
        ...(source ? { source } : {}),
        ...(status.source ? { authSource: status.source } : {}),
      };
    })
    .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name));
}

export function getProviderDetail(provider: string): ModelProviderDetail | undefined {
  const info = listProviders().find((entry) => entry.id === provider);
  const settings = createAgentSettings();
  return info
    ? {
        ...info,
        authMethods: providerAuthMethods(provider),
        models: getModelRegistry()
          .getAll()
          .filter((model) => model.provider === provider && accountAllowsModel(model))
          .map((model) => modelToInfo(model, settings)),
      }
    : undefined;
}

export function getModelSettings(): ModelSettingsState {
  if (!registry) return { models: [], providers: [], errors: refreshErrors };
  const settings = createAgentSettings();
  const models = listModels(settings);
  const defaultModel = getDefaultModelId(models, settings);
  const error = getModelRegistry().getError();
  return {
    models,
    providers: listProviders(),
    ...(defaultModel ? { defaultModel } : {}),
    errors: [...refreshErrors, ...(error ? [error] : [])],
  };
}

export async function listScopedModels(settings = createAgentSettings()) {
  const patterns = settings.getEnabledModels();
  if (!patterns?.length) return [];
  const result = await resolveModelScopeWithDiagnostics(patterns, await getModelRuntime());
  if (result.diagnostics.length)
    throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.scopedModels;
}

export function getDefaultModelId(
  models = listModels(),
  settings = createAgentSettings(),
): string | undefined {
  const provider = settings.getDefaultProvider();
  const model = settings.getDefaultModel();
  if (!provider || !model) return models[0]?.id;
  const selected = `${provider}/${model}`;
  return models.some((entry) => entry.id === selected) ? selected : undefined;
}

export function getDefaultModel(): Model<Api> | undefined {
  return findModel(getDefaultModelId());
}

export function getModelThinkingLevel(reference: string | undefined): ThinkingLevel {
  return getModelInfo(reference)?.thinkingLevel ?? "off";
}

export function toPiThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  return level;
}

export async function setDefaultModel(reference: string | undefined): Promise<void> {
  const model = findModel(reference);
  if (!model || !getModelRegistry().hasConfiguredAuth(model))
    throw new Error(`Model is not available: ${reference ?? ""}`);
  const settings = createAgentSettings();
  settings.setDefaultModelAndProvider(model.provider, model.id);
  await settings.flush();
}

export async function setModelThinking(input: {
  model: string;
  thinkingVariant: string;
}): Promise<ModelInfo> {
  const model = findModel(input.model);
  if (!model) throw new Error(`Unknown model: ${input.model}`);
  const thinking = resolveModelThinking(model, input.thinkingVariant);
  const settings = createAgentSettings();
  settings.setModelThinkingLevel(model.provider, model.id, thinking.thinkingLevel);
  await settings.flush();
  return modelToInfo(model, settings);
}

export async function cycleDefaultModel(
  direction: "forward" | "backward" = "forward",
): Promise<ModelInfo> {
  const scope = await listScopedModels();
  const models = scope.length
    ? scope.flatMap(({ model }) => {
        const info = getModelInfo(modelToId(model));
        return info ? [info] : [];
      })
    : listModels();
  const current = models.findIndex((model) => model.id === getDefaultModelId(models));
  const start = current >= 0 ? current : direction === "forward" ? -1 : 0;
  const next = models[(start + (direction === "forward" ? 1 : -1) + models.length) % models.length];
  if (!next) throw new Error("No authenticated models are available.");
  await setDefaultModel(next.id);
  return next;
}

export async function revealProviderConfig(provider: string): Promise<void> {
  const path = providerConfigSource(getModelRegistry().getProviderAuthStatus(provider).source);
  const error = await shell.openPath(path && existsSync(path) ? dirname(path) : getPiCliAgentDir());
  if (error) throw new Error(error);
}

function providerConfigSource(source: string | undefined): string | undefined {
  if (source === "stored") return join(getPiCliAgentDir(), "auth.json");
  if (source === "models_json_key") return join(getPiCliAgentDir(), "models.json");
  return undefined;
}

function providerAuthMethods(
  provider: string,
): import("../../shared/provider-auth").ProviderAuthMethod[] {
  // Availability of auth methods is defined by the existing Pi provider itself.
  // getProviderDetail runs only after runtime initialization.
  const definition = modelRuntimeSnapshot?.getProvider(provider);
  const methods: import("../../shared/provider-auth").ProviderAuthMethod[] = [];
  if (definition?.auth.apiKey?.login) methods.push({ type: "api_key", label: "Connect API key" });
  if (definition?.auth.oauth)
    methods.push({
      type: "oauth",
      label: definition.auth.oauth.loginLabel ?? `Sign in to ${definition.auth.oauth.name}`,
    });
  return methods;
}
const CONNECTION_TEST_TIMEOUT_MS = 20000;

export async function testModelConnection(
  reference: string,
): Promise<import("../../shared/provider-auth").ProviderConnectionResult> {
  const failed = (failure: TaskFailure) => ({
    ok: false,
    message: failure.message,
    category: failure.category,
    recovery: failure.recovery,
  });
  const runtime = await getModelRuntime();
  const diagnosis = diagnoseModelSelection(reference, {
    find: (value) => findModel(value),
    isProviderConfigured: (provider) => runtime.getProviderAuthStatus(provider).configured,
  });
  if (diagnosis) return failed(diagnosis);
  const model = findModel(reference);
  if (!model) return failed(classifyFailure("Model is not registered in the provider catalog."));
  try {
    const response = await runtime.completeSimple(
      model,
      { messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }] },
      { maxTokens: 16, signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS) },
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") {
      const message = response.errorMessage || "The provider did not complete the connection test.";
      logProviderFailure("test-connection", reference, new Error(message));
      return failed(
        classifyFailure(response.stopReason === "aborted" ? `Timed out: ${message}` : message),
      );
    }
    return { ok: true, message: `Received a response from ${reference}.` };
  } catch (error) {
    logProviderFailure("test-connection", reference, error);
    return failed(classifyFailure(error));
  }
}

function accountAllowsModel(model: Model<Api>): boolean {
  return (
    model.provider !== "openai" ||
    !modelRuntimeSnapshot?.isUsingOAuth("openai") ||
    !chatGPTModels ||
    chatGPTModels.has(model.id)
  );
}
export function parseChatGPTModelCatalog(value: unknown): Map<string, string> {
  if (!value || typeof value !== "object" || !("models" in value) || !Array.isArray(value.models))
    throw new Error("ChatGPT returned an invalid model catalog.");
  return new Map(
    value.models.flatMap((model: unknown) => {
      if (
        !model ||
        typeof model !== "object" ||
        !("visibility" in model) ||
        model.visibility !== "list" ||
        !("slug" in model) ||
        typeof model.slug !== "string"
      )
        return [];
      const name =
        "display_name" in model && typeof model.display_name === "string"
          ? model.display_name
          : model.slug;
      return [[model.slug, name] as const];
    }),
  );
}
async function loadChatGPTModels(runtime: ModelRuntime): Promise<void> {
  if (!runtime.isUsingOAuth("openai")) {
    chatGPTModels = undefined;
    return;
  }
  try {
    const auth = await runtime.getAuth("openai");
    if (!auth?.auth.apiKey)
      throw new Error("ChatGPT access token is not available. Reconnect the account.");
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${auth.auth.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`ChatGPT model catalog request failed (${response.status}).`);
    chatGPTModels = parseChatGPTModelCatalog(await response.json());
  } catch (error) {
    refreshErrors.push(error instanceof Error ? error.message : String(error));
  }
}
export async function refreshChatGPTModelCatalog(): Promise<void> {
  chatGPTModels = undefined;
  await loadChatGPTModels(await getModelRuntime());
}
