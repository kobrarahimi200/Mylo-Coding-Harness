import { EventEmitter } from "node:events";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import type { ProviderAuthEvent } from "../../shared/provider-auth";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  refresh: vi.fn(async () => ({})),
  open: vi.fn(async () => {}),
}));
vi.mock("./agent-settings", () => ({
  createAgentSettings: () => ({
    getOrCreateDeviceId: () => "659a5642-bc0b-47e9-a7b3-6d324cb246c5",
    flush: async () => {},
  }),
}));
vi.mock("electron", () => ({ shell: { openExternal: mocks.open } }));
vi.mock("./model-service", () => ({
  getModelRuntime: async () => ({
    getProvider: () => ({ auth: { oauth: {}, apiKey: { login: () => {} } } }),
    login: mocks.login,
    refresh: mocks.refresh,
  }),
  getModelSettings: () => ({ models: [], providers: [], errors: [] }),
}));

import {
  answerProviderLogin,
  cancelProviderLogin,
  loginProvider,
  openProviderLoginUrl,
} from "./provider-login";

let nextId = 0;
function fixture(onEvent?: (event: ProviderAuthEvent, owner: number) => void) {
  const events: ProviderAuthEvent[] = [];
  const contents = Object.assign(new EventEmitter(), {
    id: ++nextId,
    isDestroyed: () => false,
    send: (_channel: string, event: ProviderAuthEvent) => {
      events.push(event);
      onEvent?.(event, contents.id);
    },
  });
  return { window: { webContents: contents } as unknown as BrowserWindow, contents, events };
}
afterEach(() => {
  mocks.login.mockReset();
  mocks.refresh.mockClear();
  mocks.open.mockClear();
});
it("routes secret input directly into Pi login without broadcasting credentials", async () => {
  mocks.login.mockImplementation(async (_provider, _type, interaction: AuthInteraction) => {
    const value = await interaction.prompt({ type: "secret", message: "API key" });
    expect(value).toBe("fixture-secret");
    return { type: "api_key", key: value };
  });
  const { window, events } = fixture((event, owner) => {
    if (event.type === "prompt") answerProviderLogin(owner, event.promptId, "fixture-secret");
  });
  await expect(loginProvider(window, "fixture", "api_key")).resolves.toEqual({
    models: [],
    providers: [],
    errors: [],
  });
  expect(JSON.stringify(events)).not.toContain("fixture-secret");
});
it("permits only the owning renderer to answer prompts or open issued sign-in links", async () => {
  mocks.login.mockImplementation(async (_provider, _type, interaction: AuthInteraction) => {
    interaction.notify({ type: "auth_url", url: "https://auth.example.test/login" });
    await interaction.prompt({ type: "manual_code", message: "Callback URL" });
    return {
      type: "oauth",
      access: "never-forward",
      refresh: "never-forward",
      expires: 99999999999,
    };
  });
  const { window, contents, events } = fixture();
  const pending = loginProvider(window, "fixture", "oauth");
  await vi.waitFor(() => expect(events.some((event) => event.type === "prompt")).toBe(true));
  const prompt = events.find((event) => event.type === "prompt");
  if (prompt?.type !== "prompt") throw new Error("Prompt missing");
  expect(() => answerProviderLogin(contents.id + 1, prompt.promptId, "code")).toThrow(
    "no longer active",
  );
  await expect(
    openProviderLoginUrl(contents.id + 1, "https://auth.example.test/login"),
  ).rejects.toThrow("Unknown");
  await expect(openProviderLoginUrl(contents.id, "file:///secret")).rejects.toThrow("Unknown");
  await openProviderLoginUrl(contents.id, "https://auth.example.test/login");
  answerProviderLogin(contents.id, prompt.promptId, "code");
  await pending;
  expect(mocks.open).toHaveBeenCalledWith("https://auth.example.test/login");
  expect(JSON.stringify(events)).not.toContain("never-forward");
});
it("cancels a pending native prompt and permits another login afterward", async () => {
  mocks.login.mockImplementation(async (_provider, _type, interaction: AuthInteraction) => {
    await interaction.prompt({ type: "secret", message: "Key" });
  });
  const { window, contents, events } = fixture();
  const pending = loginProvider(window, "fixture", "api_key");
  const result = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(events).toHaveLength(1));
  cancelProviderLogin(contents.id);
  await result;
  mocks.login.mockResolvedValue({ type: "api_key", key: "fixture" });
  await expect(loginProvider(window, "fixture", "api_key")).resolves.toMatchObject({ errors: [] });
});
it("rejects overlapping login requests instead of overwriting the pending prompt", async () => {
  mocks.login.mockImplementation(async (_provider, _type, interaction: AuthInteraction) => {
    await interaction.prompt({ type: "secret", message: "Key" });
  });
  const { window, contents } = fixture();
  const pending = loginProvider(window, "fixture", "api_key");
  const cancelled = expect(pending).rejects.toThrow("cancelled");
  await expect(loginProvider(window, "fixture", "oauth")).rejects.toThrow("Finish or cancel");
  cancelProviderLogin(contents.id);
  await cancelled;
});

it("passes Pi's stable installation identity to ChatGPT OAuth", async () => {
  mocks.login.mockImplementation(async (_provider, _type, _interaction, options) => {
    expect(options.getDeviceId()).toBe("659a5642-bc0b-47e9-a7b3-6d324cb246c5");
    return { type: "oauth", access: "fixture", refresh: "fixture", expires: Date.now() + 3600000 };
  });
  const { window } = fixture();
  await loginProvider(window, "openai", "oauth");
});
