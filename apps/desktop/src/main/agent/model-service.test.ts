import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ root: "", cli: "", product: "" }));
vi.mock("electron", () => ({
  app: { getPath: () => paths.root },
  shell: { openPath: vi.fn(async () => "") },
}));
vi.mock("./agent-paths", () => ({
  getPiCliAgentDir: () => paths.cli,
}));

import * as service from "./model-service";

beforeAll(async () => {
  paths.root = mkdtempSync(join(tmpdir(), "modus-model-native-"));
  paths.cli = join(paths.root, "cli");
  paths.product = join(paths.root, "product");
  mkdirSync(paths.cli);
  mkdirSync(paths.product);
  writeFileSync(
    join(paths.cli, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          api: "openai-completions",
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "synthetic",
          models: [
            {
              id: "new-model-999",
              name: "Native model",
              contextWindow: 32768,
              maxTokens: 4096,
              reasoning: true,
            },
          ],
        },
      },
    }),
  );
  await service.getModelRuntime();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => rmSync(paths.root, { recursive: true, force: true }));

it("admits newly discovered native chat models without database enablement records", () => {
  expect(service.listModels()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "fixture/new-model-999",
        available: true,
        contextWindow: 32768,
        maxTokens: 4096,
      }),
    ]),
  );
  expect(service.getProviderDetail("fixture")?.models[0]?.name).toBe("Native model");
});
it("reports partial catalog errors and cancellation even when refresh resolves", async () => {
  const runtime = await service.getModelRuntime();
  vi.spyOn(runtime, "refresh").mockResolvedValue({
    aborted: true,
    errors: new Map([["fixture", new Error("synthetic network failure")]]),
  } as Awaited<ReturnType<typeof runtime.refresh>>);
  const state = await service.refreshRemoteModelCatalog();
  expect(state.errors.join("\n")).toContain("synthetic network failure");
  expect(state.errors.join("\n")).toContain("cancelled");
  expect(state.models.some((model) => model.id === "fixture/new-model-999")).toBe(true);
});
it("persists only native model preferences and leaves inherited definitions untouched", async () => {
  const source = readFileSync(join(paths.cli, "models.json"), "utf8");
  await service.setDefaultModel("fixture/new-model-999");
  const info = await service.setModelThinking({
    model: "fixture/new-model-999",
    thinkingVariant: "high",
  });
  expect(info.thinkingLevel).toBe("high");
  const stored = JSON.parse(readFileSync(join(paths.cli, "settings.json"), "utf8"));
  expect(stored).toMatchObject({ defaultProvider: "fixture", defaultModel: "new-model-999" });
  expect(stored.modelThinkingLevels["fixture/new-model-999"]).toBe("high");
  expect(readFileSync(join(paths.cli, "models.json"), "utf8")).toBe(source);
});
it("rejects unavailable explicit choices without selecting a substitute", async () => {
  await expect(service.setDefaultModel("fixture/absent")).rejects.toThrow("not available");
  expect(service.getDefaultModelId()).toBe("fixture/new-model-999");
});

it("advertises Pi's real ChatGPT sign-in method", () => {
  expect(service.getProviderDetail("openai")?.authMethods).toContainEqual({
    type: "oauth",
    label: "Sign in with ChatGPT",
  });
});
it("reports the actual provider failure from a connection test", async () => {
  const runtime = await service.getModelRuntime();
  const { fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const response = fauxAssistantMessage("");
  response.stopReason = "error";
  response.errorMessage = "No credits remaining";
  vi.spyOn(runtime, "completeSimple").mockResolvedValue(response);
  await expect(service.testModelConnection("fixture/new-model-999")).resolves.toMatchObject({
    ok: false,
    message: "No credits remaining",
    category: "quota",
  });
});

it("filters ChatGPT model choices by the signed-in account catalog", async () => {
  const runtime = await service.getModelRuntime();
  vi.spyOn(runtime, "isUsingOAuth").mockReturnValue(true);
  vi.spyOn(runtime, "getAuth").mockResolvedValue({
    auth: { apiKey: "fixture-oauth-token" },
    source: "OAuth",
  });
  const request = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-6.1-sol", display_name: "Account coding model", visibility: "list" },
            { slug: "gpt-4.1-mini", display_name: "Hidden model", visibility: "hide" },
          ],
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", request);
  await service.refreshChatGPTModelCatalog();
  expect(request).toHaveBeenCalledWith(
    "https://api.openai.com/v1/models",
    expect.objectContaining({ headers: { Authorization: "Bearer fixture-oauth-token" } }),
  );
  const detail = service.getProviderDetail("openai")?.models ?? [];
  expect(detail.find((model) => model.id === "openai/gpt-4.1-mini")).toMatchObject({
    available: false,
    unavailableReason: expect.stringContaining("ChatGPT account"),
  });
  expect(detail.find((model) => model.id === "openai/gpt-6.1-sol")).toMatchObject({
    available: false,
    unavailableReason: expect.stringContaining("No credentials"),
  });
  expect(service.findModel("openai/gpt-4.1-mini")).toBeUndefined();
  expect(
    service.getProviderDetail("openai")?.models.find((model) => model.id === "openai/gpt-6.1-sol")
      ?.name,
  ).toBe("Account coding model");
});
it("rejects malformed account catalogs instead of treating static API models as entitled", () => {
  expect(() => service.parseChatGPTModelCatalog({ data: [] })).toThrow("invalid model catalog");
});

it("lists unavailable models after available ones, each with a concrete reason", () => {
  const { models } = service.getModelSettings();
  const firstUnavailable = models.findIndex((model) => !model.available);
  expect(firstUnavailable).toBeGreaterThan(0);
  expect(models.slice(firstUnavailable).every((model) => !model.available)).toBe(true);
  expect(models.slice(0, firstUnavailable).every((model) => model.available)).toBe(true);
  for (const model of models.filter((entry) => !entry.available))
    expect(model.unavailableReason).toMatch(/credentials|catalog/i);
  expect(models.find((model) => model.id === "fixture/new-model-999")?.unavailableReason).toBe(
    undefined,
  );
});

it("labels a model fast only from a measured latency", async () => {
  expect(service.modelSpeed(undefined)).toEqual({});
  expect(service.modelSpeed(service.FAST_LATENCY_MS)).toEqual({
    latencyMs: service.FAST_LATENCY_MS,
    fast: true,
  });
  expect(service.modelSpeed(service.FAST_LATENCY_MS + 1).fast).toBe(false);
  expect(
    service.getModelSettings().models.find((model) => model.id === "fixture/new-model-999")?.fast,
  ).toBeUndefined();
  const runtime = await service.getModelRuntime();
  const { fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  vi.spyOn(runtime, "completeSimple").mockResolvedValue(fauxAssistantMessage("OK"));
  await service.testModelConnection("fixture/new-model-999");
  const measured = service
    .getModelSettings()
    .models.find((model) => model.id === "fixture/new-model-999");
  expect(measured?.latencyMs).toBeTypeOf("number");
  expect(measured?.fast).toBe(measured?.latencyMs !== undefined && measured.latencyMs <= 2500);
});

it("stores a different default model per mode and rejects unavailable choices", async () => {
  await service.setModeModel("ask", "fixture/new-model-999");
  expect(service.getModelSettings().modeModels).toEqual({ ask: "fixture/new-model-999" });
  await expect(service.setModeModel("agent", "fixture/absent")).rejects.toThrow("not available");
  await service.setModeModel("ask", undefined);
  expect(service.getModelSettings().modeModels).toBeUndefined();
});

it("offers off and low thinking only when the model supports them", () => {
  const info = service
    .getModelSettings()
    .models.find((model) => model.id === "fixture/new-model-999");
  expect(info?.supportsThinking).toBe(true);
  expect(info?.thinkingLevels).toContain("off");
  expect(info?.thinkingLevels).toContain("low");
  const plain = service.listAllModels().find((model) => !model.supportsThinking);
  expect(plain?.thinkingLevels.filter((level) => level !== "off")).toEqual([]);
});
