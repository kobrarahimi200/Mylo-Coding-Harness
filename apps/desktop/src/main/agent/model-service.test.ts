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
  expect(service.getProviderDetail("openai")?.models.map((model) => model.id)).toEqual([
    "openai/gpt-6.1-sol",
  ]);
  expect(service.findModel("openai/gpt-4.1-mini")).toBeUndefined();
  expect(service.getProviderDetail("openai")?.models[0]?.name).toBe("Account coding model");
});
it("rejects malformed account catalogs instead of treating static API models as entitled", () => {
  expect(() => service.parseChatGPTModelCatalog({ data: [] })).toThrow("invalid model catalog");
});
