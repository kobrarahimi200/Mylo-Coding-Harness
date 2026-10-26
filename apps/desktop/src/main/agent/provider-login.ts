import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { type BrowserWindow, shell } from "electron";
import type { ProviderAuthEvent } from "../../shared/provider-auth";
import { createAgentSettings } from "./agent-settings";
import { getModelRuntime, getModelSettings } from "./model-service";

type Login = {
  owner: number;
  provider: string;
  controller: AbortController;
  urls: Set<string>;
  pending?: { id: string; answer(value: string): void; reject(reason: Error): void };
};
const logins = new Map<number, Login>();
function cancelled() {
  return new Error("Provider connection cancelled.");
}

export async function loginProvider(
  window: BrowserWindow,
  provider: string,
  type: "api_key" | "oauth",
) {
  const owner = window.webContents.id;
  if (logins.has(owner)) throw new Error("Finish or cancel the current provider connection first.");
  const runtime = await getModelRuntime();
  if (logins.has(owner)) throw new Error("Finish or cancel the current provider connection first.");
  if (window.webContents.isDestroyed()) throw cancelled();
  const definition = runtime.getProvider(provider);
  if (!definition || !(type === "oauth" ? definition.auth.oauth : definition.auth.apiKey?.login))
    throw new Error("This connection method is not supported by the provider.");
  const login: Login = { owner, provider, controller: new AbortController(), urls: new Set() };
  logins.set(owner, login);
  const send = (event: ProviderAuthEvent) => {
    if (!window.webContents.isDestroyed()) window.webContents.send("model:auth-event", event);
  };
  const abort = () => {
    login.controller.abort();
    login.pending?.reject(cancelled());
  };
  window.webContents.once("destroyed", abort);
  const timeout = setTimeout(abort, 10 * 60 * 1000);
  try {
    const settings = createAgentSettings();
    const deviceId = settings.getOrCreateDeviceId();
    await settings.flush();
    await runtime.login(
      provider,
      type,
      {
        signal: login.controller.signal,
        notify: (event: AuthEvent) => {
          if (login.controller.signal.aborted) return;
          if (event.type === "auth_url") {
            login.urls.add(event.url);
            send({
              provider,
              type: "notice",
              message: event.instructions ?? "Open the sign-in page in your browser.",
              url: event.url,
            });
          } else if (event.type === "device_code") {
            login.urls.add(event.verificationUri);
            send({
              provider,
              type: "notice",
              message: `Enter code ${event.userCode} on the sign-in page.`,
              url: event.verificationUri,
            });
          } else send({ provider, type: "notice", message: event.message });
        },
        prompt: async (prompt: AuthPrompt) => {
          if (login.controller.signal.aborted || prompt.signal?.aborted) throw cancelled();
          return await new Promise<string>((resolve, reject) => {
            const id = randomUUID();
            const clean = () => {
              delete login.pending;
              prompt.signal?.removeEventListener("abort", onAbort);
            };
            const onAbort = () => {
              clean();
              reject(cancelled());
            };
            login.pending = {
              id,
              answer: (value) => {
                clean();
                resolve(value);
              },
              reject: (reason) => {
                clean();
                reject(reason);
              },
            };
            prompt.signal?.addEventListener("abort", onAbort, { once: true });
            send({
              provider,
              type: "prompt",
              promptId: id,
              kind: prompt.type,
              message: prompt.message,
              ...(prompt.type === "select" ? { options: prompt.options } : {}),
            });
          });
        },
      },
      { getDeviceId: () => deviceId },
    );
    await runtime.refresh({
      allowNetwork: true,
      providers: [provider],
      signal: login.controller.signal,
    });
    return getModelSettings();
  } finally {
    clearTimeout(timeout);
    window.webContents.removeListener("destroyed", abort);
    login.pending?.reject(cancelled());
    logins.delete(owner);
  }
}
export function answerProviderLogin(owner: number, id: string, value: string): void {
  const login = logins.get(owner);
  if (!login?.pending || login.pending.id !== id)
    throw new Error("This provider prompt is no longer active.");
  login.pending.answer(value);
}
export function cancelProviderLogin(owner: number): void {
  const login = logins.get(owner);
  login?.controller.abort();
  login?.pending?.reject(cancelled());
}
export async function openProviderLoginUrl(owner: number, url: string): Promise<void> {
  if (!logins.get(owner)?.urls.has(url)) throw new Error("Unknown provider sign-in link.");
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  )
    throw new Error("Unsupported sign-in link.");
  await shell.openExternal(url);
}
