import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { BrowserWindow } from "electron";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../shared/contracts";
import { desktopPreferences } from "../preferences/desktop-preferences";

let root: string;
let models: ModelRuntime;
const faux = fauxProvider({
  tokensPerSecond: 0,
  models: [
    { id: "default" },
    { id: "wide", reasoning: true, contextWindow: 1048576 },
    { id: "compact", reasoning: true, contextWindow: 272000 },
  ],
});
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
vi.mock("electron", () => ({
  app: { getPath: () => root },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Notification: class {
    static isSupported() {
      return false;
    }
  },
}));
vi.mock("./model-service", () => ({
  getModelRuntime: () => Promise.resolve(models),
  refreshRemoteModelCatalog: () => models.refresh({ allowNetwork: false }),
  getModelSettings: () => ({ models: [], providers: [], errors: [] }),
  findModel: (id: string) => faux.models.find((model) => `${model.provider}/${model.id}` === id),
  modelToId: (model: { provider: string; id: string }) => `${model.provider}/${model.id}`,
  resolveModelThinking: (model: unknown, variant?: string) => ({
    model,
    thinkingLevel: variant ?? "off",
  }),
  listScopedModels: () => Promise.resolve([]),
  setDefaultModel: vi.fn(),
  setModelThinking: vi.fn(),
  cycleDefaultModel: vi.fn(),
  getModelInfo: (id: string) => ({ id }),
}));

import { resolveQuestionRequest } from "../interaction/question-broker";
import { listAgentEvents, readAgentHistory } from "./agent-history";
import {
  bindSessionManager,
  createAgentSessionRecord,
  getAgentSession,
  releaseSessionManager,
} from "./agent-store";
import { setDefaultModel, setModelThinking } from "./model-service";
import { PiSdkRuntime } from "./pi-sdk-runtime";
import { sessionResources } from "./session-resources";

const runtime = new PiSdkRuntime();
const events: AgentEvent[] = [];
let rejectPlan = false;
let holdPlan = false;
let rejectTool = false;
const window = {
  webContents: {
    send: (_channel: string, event: AgentEvent) => {
      events.push(event);
      if (event.type === "question.requested")
        queueMicrotask(() => {
          const question = event.request.questions[0];
          if (!question || (holdPlan && question.id === "approve-plan")) return;
          resolveQuestionRequest(
            event.request.id,
            [
              {
                questionId: question.id,
                selected: question.options[0]
                  ? [
                      (rejectPlan && question.id === "approve-plan") ||
                      (rejectTool && question.id === "tool-approval")
                        ? "Reject"
                        : question.options[0].label,
                    ]
                  : [],
                ...(question.prefill !== undefined ? { custom: question.prefill } : {}),
              },
            ],
            false,
          );
        });
    },
  },
  isDestroyed: () => false,
  isFocused: () => true,
  isMinimized: () => false,
} as unknown as BrowserWindow;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "modus-runtime-native-"));
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
  mkdirSync(process.env.PI_CODING_AGENT_DIR);
  writeFileSync(
    join(process.env.PI_CODING_AGENT_DIR, "settings.json"),
    JSON.stringify({
      defaultTools: ["read"],
      defaultProjectTrust: "always",
      defaultProvider: faux.getModel().provider,
      defaultModel: faux.getModel().id,
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  );
  models = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  models.registerNativeProvider(faux.provider);
  await models.refresh({ allowNetwork: false });
}, 30000);
afterAll(async () => {
  try {
    await runtime.shutdown();
  } finally {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    if (originalSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = originalSessionDir;
    rmSync(root, { recursive: true, force: true });
  }
});
function workspace() {
  const id = crypto.randomUUID(),
    cwd = join(root, id);
  mkdirSync(cwd);
  const now = new Date().toISOString();
  desktopPreferences().workspaces.push({
    id,
    rootPath: cwd,
    displayName: "Fixture",
    isGitRepository: false,
    pinned: false,
    lastOpenedAt: now,
  });
  return { id, cwd };
}
function answer(text = "Answer") {
  faux.appendResponses([
    fauxAssistantMessage(
      JSON.stringify({
        goal: "Fixture coding task",
        steps: [
          "Inspect input.txt and relevant source",
          "Implement the requested change",
          "Run project checks",
        ],
      }),
    ),
    fauxAssistantMessage(text),
  ]);
}
it("shows the real session and preparing feedback before native initialization finishes", async () => {
  const { id, cwd } = workspace();
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Immediate title" });
  answer();
  const pending = runtime.prompt(window, {
    sessionId: session.id,
    userMessageId: "early",
    message: "Question",
  });
  expect(getAgentSession(session.id)?.title).toBe("Immediate title");
  expect(
    events.some((event) => event.type === "message.started" && event.messageId === "early"),
  ).toBe(true);
  await pending;
  const file = getAgentSession(session.id)?.piSessionFile;
  expect(file).toBeDefined();
  if (!file) throw new Error("Session file was not persisted");
  expect(dirname(file)).toBe(join(root, "sessions"));
  expect(SessionManager.open(file).getCwd()).toBe(cwd);
  expect(
    listAgentEvents(session.id).filter(
      ({ event }) => event.type === "message.started" && event.role === "user",
    ),
  ).toHaveLength(1);
  await runtime.dispose(session.id);
}, 30000);
it("passes paths through native prompt handling and keeps GUI metadata outside model context", async () => {
  const { id, cwd } = workspace();
  const file = join(cwd, "input.txt");
  writeFileSync(file, "File body");
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Paths" });
  answer();
  await runtime.prompt(window, {
    sessionId: session.id,
    message: "Explain",
    paths: [file],
    userMessageId: "path-user",
  });
  const manager = SessionManager.open(getAgentSession(session.id)?.piSessionFile as string);
  const user = manager.buildSessionContext().messages.find((message) => message.role === "user");
  expect(user?.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "text", text: expect.stringContaining(file) }),
    ]),
  );
  expect(
    manager
      .getEntries()
      .some((entry) => entry.type === "custom" && entry.customType === "modus.message"),
  ).toBe(true);
  expect(JSON.stringify(manager.buildSessionContext().messages)).not.toContain("path-user");
  await runtime.dispose(session.id);
  expect(
    readAgentHistory(session.id).events.find(
      ({ event }) => event.type === "message.started" && event.role === "user",
    )?.event,
  ).toMatchObject({ messageId: "path-user", contextItems: [{ type: "file", path: file }] });
}, 30000);
it("uses native model fallback when restoring a recorded unavailable model", async () => {
  const { id, cwd } = workspace();
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  manager.appendModelChange("missing", "old-model");
  manager.appendMessage({ role: "user", content: "Original", timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage([{ type: "text", text: "Saved" }]));
  manager.appendModelChange("missing", "old-model");
  createAgentSessionRecord({ id, workspaceId: id, cwd, title: "Fallback" });
  bindSessionManager(id, manager);
  releaseSessionManager(id);
  const restored = await runtime.ensure(window, id);
  expect(restored.piSessionId).toBe(manager.getSessionId());
  expect(restored.model).toBe(`${faux.getModel().provider}/${faux.getModel().id}`);
  expect(
    events.some(
      (event) =>
        event.sessionId === id && event.type === "extension.notice" && event.level === "warning",
    ),
  ).toBe(true);
  expect(restored.contextUsage?.totals).toBeDefined();
  await runtime.dispose(id);
}, 30000);

it("keeps model and thinking changes in the native session and restores a consistent snapshot", async () => {
  const { id, cwd } = workspace();
  const settingsPath = join(root, "agent", "settings.json");
  const defaults = readFileSync(settingsPath, "utf8");
  vi.mocked(setDefaultModel).mockClear();
  vi.mocked(setModelThinking).mockClear();
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Selection" });
  await runtime.ensure(window, session.id);
  answer();
  await runtime.prompt(window, { sessionId: session.id, message: "Save session" });
  const sdk = sessionResources().find(({ id }) => id === session.id)?.session;
  const wide = faux.getModel("wide");
  const compact = faux.getModel("compact");
  if (!sdk || !wide || !compact) throw new Error("Selection fixture was not initialized");
  const wideId = `${wide.provider}/${wide.id}`;
  const compactId = `${compact.provider}/${compact.id}`;
  try {
    expect(await runtime.setModel(window, session.id, wideId)).toMatchObject({
      model: wideId,
      contextUsage: { contextWindow: wide.contextWindow },
    });
    const modelChanges = sdk.sessionManager
      .getEntries()
      .filter((entry) => entry.type === "model_change").length;
    expect(await runtime.setThinking(window, session.id, "high")).toMatchObject({
      model: wideId,
      thinkingLevel: "high",
      contextUsage: { contextWindow: wide.contextWindow },
    });
    expect(
      sdk.sessionManager.getEntries().filter((entry) => entry.type === "model_change"),
    ).toHaveLength(modelChanges);
    expect(await runtime.setModel(window, session.id, compactId)).toMatchObject({
      model: compactId,
      thinkingLevel: "high",
      contextUsage: { contextWindow: compact.contextWindow },
    });
    const cycled = await runtime.cycleModel(window, session.id);
    expect(cycled.id).toBe(`${sdk.model?.provider}/${sdk.model?.id}`);
    await sdk.setModel(wide);
    sdk.setThinkingLevel("medium");
    expect(
      events.findLast(
        (event) => event.type === "session.updated" && event.sessionId === session.id,
      ),
    ).toMatchObject({
      session: {
        model: wideId,
        thinkingLevel: "medium",
        contextUsage: { contextWindow: wide.contextWindow },
      },
    });
    await runtime.releaseRuntime(session.id);
    expect(await runtime.ensure(window, session.id)).toMatchObject({
      model: wideId,
      thinkingLevel: "medium",
      contextUsage: { contextWindow: wide.contextWindow },
    });
    expect(readFileSync(settingsPath, "utf8")).toBe(defaults);
    expect(setDefaultModel).not.toHaveBeenCalled();
    expect(setModelThinking).not.toHaveBeenCalled();
  } finally {
    await runtime.dispose(session.id);
  }
}, 30000);
it.each([
  "missing",
  "empty",
  "invalid",
])("refuses to replace a %s restored session", async (kind) => {
  const { id, cwd } = workspace();
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "Saved", timestamp: Date.now() });
  manager.appendMessage(fauxAssistantMessage([{ type: "text", text: "Answer" }]));
  const file = manager.getSessionFile()!;
  createAgentSessionRecord({ id, workspaceId: id, cwd, title: "Saved" });
  bindSessionManager(id, manager);
  releaseSessionManager(id);
  if (kind === "missing") unlinkSync(file);
  else writeFileSync(file, kind === "empty" ? "" : "Invalid data");
  await expect(runtime.ensure(window, id)).rejects.toThrow();
  if (kind !== "missing")
    expect(readFileSync(file, "utf8")).toBe(kind === "empty" ? "" : "Invalid data");
}, 30000);
it("navigates the PI tree for edit resend while preserving files and previous branches", async () => {
  const { id, cwd } = workspace();
  const file = join(cwd, "work.txt");
  writeFileSync(file, "Original");
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Branch" });
  answer("First");
  await runtime.prompt(window, {
    sessionId: session.id,
    message: "First question",
    userMessageId: "edit-anchor",
  });
  writeFileSync(file, "Current work");
  await runtime.navigate(window, session.id, "edit-anchor");
  answer("Second");
  await runtime.prompt(window, { sessionId: session.id, message: "Edited question" });
  expect(readFileSync(file, "utf8")).toBe("Current work");
  await runtime.dispose(session.id);
  const manager = SessionManager.open(getAgentSession(session.id)?.piSessionFile as string);
  expect(JSON.stringify(manager.getEntries())).toContain("First question");
  expect(JSON.stringify(manager.buildSessionContext().messages)).not.toContain("First question");
  expect(JSON.stringify(manager.buildSessionContext().messages)).toContain("Edited question");
}, 30000);

it("invokes a selected skill through PI and carries additional file paths as user input", async () => {
  const { id, cwd } = workspace();
  const paths = ["alpha", "beta"].map((name) => {
    const directory = join(cwd, ".pi", "skills", name);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "SKILL.md");
    writeFileSync(
      path,
      "---\nname: " + name + "\ndescription: Fixture skill\n---\nNATIVE SKILL " + name,
    );
    return { name, path };
  });
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Native skills" });
  answer();
  await runtime.prompt(window, { sessionId: session.id, message: "Inspect", skills: paths });
  await runtime.dispose(session.id);
  const manager = SessionManager.open(getAgentSession(session.id)?.piSessionFile as string);
  const messages = JSON.stringify(manager.buildSessionContext().messages);
  expect(messages).toContain("NATIVE SKILL alpha");
  expect(messages).toContain("Inspect");
  expect(messages).toContain(paths[1]?.path.replaceAll("\\", "\\\\"));
  expect(messages).not.toContain("[skill:");
}, 30000);

it("reloads native resources, keeps the selected model, and publishes current usage", async () => {
  const initial = readFileSync(join(root, "agent", "settings.json"), "utf8");
  const { id, cwd } = workspace();
  const session = await runtime.create(window, {
    workspaceId: id,
    cwd,
    title: "Reload fixture",
    model: `${faux.getModel().provider}/${faux.getModel().id}`,
  });
  try {
    await runtime.ensure(window, session.id);
    answer("Saved before reload");
    await runtime.prompt(window, { sessionId: session.id, message: "Before reload" });
    const sdk = sessionResources().find(({ id }) => id === session.id)?.session;
    expect(sdk).toBeDefined();
    writeFileSync(
      join(root, "agent", "settings.json"),
      JSON.stringify({
        ...JSON.parse(initial),
        defaultTools: ["read", "write"],
        retry: { enabled: true, maxRetries: 5 },
      }),
    );
    events.length = 0;
    expect((await runtime.reloadConfiguration()).errors).toEqual([]);
    expect(sdk?.settingsManager.getRetrySettings().maxRetries).toBe(5);
    expect(sdk?.getActiveToolNames()).toContain("write");
    expect(sdk?.model?.id).toBe(faux.getModel().id);
    expect(
      events.some((event) => event.type === "session.updated" && event.session.contextUsage),
    ).toBe(true);
    expect(JSON.stringify(sdk?.state.messages)).toContain("Saved before reload");
  } finally {
    writeFileSync(join(root, "agent", "settings.json"), initial);
    await runtime.dispose(session.id);
  }
}, 30000);

it("uses Pi to generate a repository plan, executes an approved file tool, and persists harness state", async () => {
  const { id, cwd } = workspace();
  writeFileSync(join(cwd, "input.txt"), "original");
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Real tools" });
  await runtime.ensure(window, session.id);
  const sdk = sessionResources().find((item) => item.id === session.id)?.session;
  if (!sdk) throw new Error("Missing session");
  sdk.setActiveToolsByName(["read", "write"]);
  const write = fauxAssistantMessage([
    {
      type: "toolCall",
      id: "write-fixture",
      name: "write",
      arguments: { path: "input.txt", content: "approved change" },
    },
  ]);
  write.stopReason = "toolUse";
  faux.appendResponses([
    fauxAssistantMessage(
      JSON.stringify({
        goal: "Update input.txt",
        steps: ["Read input.txt", "Write the requested content"],
      }),
    ),
    write,
    fauxAssistantMessage("Edited input.txt"),
  ]);
  await runtime.prompt(window, { sessionId: session.id, message: "Update input.txt" });
  expect(readFileSync(join(cwd, "input.txt"), "utf8")).toBe("approved change");
  const relevant = events.filter((event) => event.sessionId === session.id);
  expect(relevant).toContainEqual(
    expect.objectContaining({ type: "harness.plan", approved: true }),
  );
  expect(relevant).toContainEqual(
    expect.objectContaining({
      type: "question.requested",
      request: expect.objectContaining({
        questions: expect.arrayContaining([
          expect.objectContaining({
            codeChange: expect.objectContaining({ before: "original", after: "approved change" }),
          }),
        ]),
      }),
    }),
  );
  await runtime.dispose(session.id);
  expect(
    readAgentHistory(session.id).events.some(({ event }) => event.type === "harness.plan"),
  ).toBe(true);
}, 30000);

it("blocks execution when the generated plan is rejected", async () => {
  const { id, cwd } = workspace();
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Reject plan" });
  faux.appendResponses([
    fauxAssistantMessage(JSON.stringify({ goal: "Rejected task", steps: ["Write data"] })),
  ]);
  rejectPlan = true;
  try {
    await expect(
      runtime.prompt(window, { sessionId: session.id, message: "Change files" }),
    ).rejects.toThrow("Task plan rejected");
    expect(
      events.some((event) => event.sessionId === session.id && event.type === "tool.started"),
    ).toBe(false);
  } finally {
    rejectPlan = false;
    await runtime.dispose(session.id);
  }
}, 30000);

it("runs the bounded correction loop through the same Pi session", async () => {
  const validation = await import("../harness/validation");
  const { id, cwd } = workspace();
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.cjs" } }));
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Correct test" });
  const run = vi.spyOn(validation, "runValidation").mockImplementation(async (command) => ({
    command,
    passed: run.mock.calls.length >= 2,
    exitCode: run.mock.calls.length >= 2 ? 0 : 1,
    output: run.mock.calls.length >= 2 ? "test passed" : "AssertionError: expected true",
  }));
  answer("Initial implementation");
  faux.appendResponses([fauxAssistantMessage("Corrected the assertion")]);
  try {
    await runtime.prompt(window, { sessionId: session.id, message: "Fix failing test" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "harness.phase",
        sessionId: session.id,
        phase: "correcting",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "harness.validation",
        sessionId: session.id,
        status: "passed",
        exitCode: 0,
      }),
    );
  } finally {
    run.mockRestore();
    await runtime.dispose(session.id);
  }
}, 30000);

it("stops after three corrections when checks keep failing", async () => {
  const validation = await import("../harness/validation");
  const { id, cwd } = workspace();
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ scripts: { test: "node test.cjs" } }));
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Retry limit" });
  const run = vi.spyOn(validation, "runValidation").mockImplementation(async (command) => ({
    command,
    passed: false,
    exitCode: 1,
    output: "test still fails",
  }));
  answer("Initial change");
  faux.appendResponses([1, 2, 3].map((attempt) => fauxAssistantMessage(`Correction ${attempt}`)));
  try {
    await expect(
      runtime.prompt(window, { sessionId: session.id, message: "Fix test" }),
    ).rejects.toThrow("three correction attempts");
    expect(run).toHaveBeenCalledTimes(4);
  } finally {
    run.mockRestore();
    await runtime.dispose(session.id);
  }
}, 30000);

it("rejects an unapproved command before its shell can run", async () => {
  const { id, cwd } = workspace();
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Reject command" });
  await runtime.ensure(window, session.id);
  const sdk = sessionResources().find((item) => item.id === session.id)?.session;
  if (!sdk) throw new Error("Missing session");
  sdk.setActiveToolsByName(["read", "bash"]);
  const command = fauxAssistantMessage([
    {
      type: "toolCall",
      id: "blocked-shell",
      name: "bash",
      arguments: { command: "touch should-not-exist.txt" },
    },
  ]);
  command.stopReason = "toolUse";
  faux.appendResponses([
    fauxAssistantMessage(
      JSON.stringify({ goal: "Run command", steps: ["Request command approval"] }),
    ),
    command,
    fauxAssistantMessage("Command rejected"),
  ]);
  rejectTool = true;
  try {
    await runtime
      .prompt(window, { sessionId: session.id, message: "Run the command" })
      .catch(() => {});
    expect(existsSync(join(cwd, "should-not-exist.txt"))).toBe(false);
    expect(
      events.some(
        (event) =>
          event.sessionId === session.id &&
          event.type === "question.requested" &&
          event.request.questions[0]?.id === "tool-approval",
      ),
    ).toBe(true);
  } finally {
    rejectTool = false;
    await runtime.dispose(session.id);
  }
}, 30000);

it("adds a custom Pi skill and persists its enabled state", async () => {
  const { setSkillEnabled, listSkills } = await import("../skills/skills-service");
  const { id, cwd } = workspace();
  const directory = join(cwd, ".pi", "skills", "custom-check");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  writeFileSync(
    path,
    "---\nname: custom-check\ndescription: Custom regression skill\n---\nRead the project test instructions before editing.",
  );
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Custom skill" });
  await runtime.ensure(window, session.id);
  try {
    expect(listSkills(session.id).skills.some((skill) => skill.path === path)).toBe(true);
    expect(
      (await setSkillEnabled(session.id, path, false)).skills.some((skill) => skill.path === path),
    ).toBe(false);
    expect(desktopPreferences().disabledSkillPaths).toContain(path);
    expect(
      (await setSkillEnabled(session.id, path, true)).skills.some((skill) => skill.path === path),
    ).toBe(true);
  } finally {
    await runtime.dispose(session.id);
  }
}, 30000);

it("cancels a task while it waits for plan approval", async () => {
  const { id, cwd } = workspace();
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Cancel plan" });
  faux.setResponses([
    fauxAssistantMessage(JSON.stringify({ goal: "Wait for approval", steps: ["Change a file"] })),
  ]);
  holdPlan = true;
  try {
    const pending = runtime.prompt(window, { sessionId: session.id, message: "Change a file" });
    await vi.waitFor(() =>
      expect(
        events.some(
          (event) =>
            event.sessionId === session.id &&
            event.type === "question.requested" &&
            event.request.questions[0]?.id === "approve-plan",
        ),
      ).toBe(true),
    );
    await runtime.abort(session.id);
    await pending;
    expect(
      events.some((event) => event.sessionId === session.id && event.type === "run.cancelled"),
    ).toBe(true);
    expect(
      events.some((event) => event.sessionId === session.id && event.type === "tool.started"),
    ).toBe(false);
  } finally {
    holdPlan = false;
    await runtime.dispose(session.id);
  }
}, 30000);

it("preserves the actual provider error when planning fails", async () => {
  const { id, cwd } = workspace();
  const session = await runtime.create(window, { workspaceId: id, cwd, title: "Provider failure" });
  const response = fauxAssistantMessage("");
  response.stopReason = "error";
  response.errorMessage = "Provider fixture: no credits remaining";
  faux.setResponses([response]);
  try {
    await expect(
      runtime.prompt(window, { sessionId: session.id, message: "Plan a change" }),
    ).rejects.toThrow("Provider fixture: no credits remaining");
    expect(
      events.some(
        (event) =>
          event.sessionId === session.id &&
          event.type === "run.failed" &&
          event.message.includes("no credits remaining"),
      ),
    ).toBe(true);
  } finally {
    await runtime.dispose(session.id);
  }
}, 30000);
