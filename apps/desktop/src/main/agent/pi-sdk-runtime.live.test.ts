import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { BrowserWindow } from "electron";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../shared/contracts";

// Opt-in only. All model-visible files and requests are synthetic. Pi's native
// credential store is reused; credentials are never copied into the fixture.
const enabled = process.env.MYLO_LIVE_HARNESS === "1" && process.platform === "darwin";
const authPath = join(getAgentDir(), "auth.json");
const modelId = process.env.MYLO_LIVE_MODEL ?? "openai/gpt-6.1-sol";
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
let root = "";
let models: ModelRuntime;
vi.mock("electron", () => ({
  app: { getPath: () => root },
  shell: { openPath: vi.fn(), openExternal: vi.fn() },
  Notification: { isSupported: () => false },
}));
vi.mock("./model-service", () => ({
  getModelRuntime: async () => models,
  findModel: (reference: string) => {
    const separator = reference.indexOf("/");
    return models.getModel(reference.slice(0, separator), reference.slice(separator + 1));
  },
  modelToId: (model: { provider: string; id: string }) => `${model.provider}/${model.id}`,
  resolveModelThinking: (model: unknown) => ({ model, thinkingLevel: "low" }),
  listScopedModels: async () => [],
  getModelInfo: (id: string) => ({ id }),
  getModelSettings: () => ({ models: [], providers: [], errors: [] }),
  refreshRemoteModelCatalog: () => models.refresh({ allowNetwork: false }),
  setDefaultModel: vi.fn(),
  setModelThinking: vi.fn(),
  cycleDefaultModel: vi.fn(),
}));

import { resolveQuestionRequest } from "../interaction/question-broker";
import { upsertWorkspace } from "../workspace/workspace-store";
import { PiSdkRuntime } from "./pi-sdk-runtime";

const runtime = new PiSdkRuntime();
const events: AgentEvent[] = [];
let fixtureRoot = "";
let injected = false;
const window = {
  isDestroyed: () => false,
  isFocused: () => true,
  isMinimized: () => false,
  webContents: {
    send: (_channel: string, event: AgentEvent) => {
      events.push(event);
      if (event.type === "harness.phase" || event.type === "harness.validation")
        console.info(JSON.stringify(event));
      if (event.type === "tool.started" || event.type === "tool.ended")
        console.info(JSON.stringify({ activity: event.type }));
      if (event.type !== "question.requested") return;
      console.info(JSON.stringify({ question: event.request.questions[0]?.id }));
      queueMicrotask(() => {
        const question = event.request.questions[0];
        if (!question) return;
        const allowed = [
          "task-plan",
          "edit-proposed-change",
          "run-workspace-tests",
          "accept-task",
        ].includes(question.id);
        if (!allowed) {
          resolveQuestionRequest(event.request.id, [], true);
          return;
        }
        let custom = question.prefill;
        if (question.id === "edit-proposed-change") {
          if (
            !question.codeChange ||
            resolve(fixtureRoot, question.codeChange.path) !== join(fixtureRoot, "sum.cjs")
          ) {
            resolveQuestionRequest(event.request.id, [], true);
            return;
          }
          // A deliberate manual regression exercises the real correction loop.
          // The first accepted proposal keeps subtraction; npm test must fail.
          if (!injected) {
            custom = "exports.add = (a, b) => a - b;\n";
            injected = true;
          }
        }
        resolveQuestionRequest(
          event.request.id,
          [
            {
              questionId: question.id,
              selected: question.options[0] ? [question.options[0].label] : [],
              ...(custom !== undefined ? { custom } : {}),
            },
          ],
          false,
        );
      });
    },
  },
} as unknown as BrowserWindow;

describe.runIf(enabled)("live synthetic harness round trip", () => {
  beforeAll(async () => {
    if (!existsSync(authPath))
      throw new Error("Connect a provider in Mylo before running the opt-in live harness test.");
    root = realpathSync(mkdtempSync(join(tmpdir(), "mylo-live-roundtrip-")));
    const agent = join(root, "agent");
    mkdirSync(agent);
    process.env.PI_CODING_AGENT_DIR = agent;
    process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
    const separator = modelId.indexOf("/");
    writeFileSync(
      join(agent, "settings.json"),
      JSON.stringify({
        defaultProvider: modelId.slice(0, separator),
        defaultModel: modelId.slice(separator + 1),
        defaultTools: ["read", "write", "edit"],
        defaultProjectTrust: "always",
        compaction: { enabled: false },
        retry: { enabled: false },
      }),
    );
    models = await ModelRuntime.create({ authPath, modelsPath: null, refreshOnCreate: false });
    await models.refresh({ allowNetwork: false });
    const model = models.getModel(modelId.slice(0, separator), modelId.slice(separator + 1));
    if (!model) throw new Error(`Model is not in Pi's installed catalog: ${modelId}`);
    const probe = await models.completeSimple(
      model,
      { messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }] },
      { maxTokens: 16, signal: AbortSignal.timeout(20000) },
    );
    if (probe.stopReason === "error" || probe.stopReason === "aborted")
      throw new Error(`Live provider probe failed: ${probe.errorMessage ?? probe.stopReason}`);
    console.info(JSON.stringify({ liveProvider: "connected" }));
  }, 30000);
  afterAll(async () => {
    await runtime.shutdown();
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    if (originalSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = originalSessionDir;
    if (root) rmSync(root, { recursive: true, force: true });
  });
  it("plans, applies a reviewed edit, observes real failing tests, corrects, and passes", async () => {
    fixtureRoot = join(root, "project");
    mkdirSync(fixtureRoot);
    writeFileSync(
      join(fixtureRoot, "package.json"),
      JSON.stringify({
        name: "synthetic-harness-fixture",
        private: true,
        scripts: { test: "node test.cjs" },
      }),
    );
    writeFileSync(join(fixtureRoot, "sum.cjs"), "exports.add = (a, b) => a - b;\n");
    writeFileSync(
      join(fixtureRoot, "test.cjs"),
      "const assert = require('node:assert/strict'); const { add } = require('./sum.cjs'); assert.equal(add(2,3),5); assert.equal(add(-2,3),1); console.log('REAL_FIXTURE_TESTS_PASSED');\n",
    );
    const workspace = upsertWorkspace(fixtureRoot, false);
    const session = await runtime.create(window, {
      workspaceId: workspace.id,
      cwd: fixtureRoot,
      model: modelId,
      title: "Synthetic live harness verification",
    });
    await runtime.prompt(window, {
      sessionId: session.id,
      message:
        "Fix numeric addition in sum.cjs so the existing tests pass. Use the write tool to replace sum.cjs. Do not modify tests or package.json. Do not run shell commands; the harness runs npm test after your implementation. Read the fixture files, generate the required plan, then implement the change after approval.",
    });
    const results = events.filter((event) => event.type === "harness.validation");
    expect(injected).toBe(true);
    expect(
      results.some(
        (event) =>
          event.type === "harness.validation" && event.status === "failed" && event.exitCode === 1,
      ),
    ).toBe(true);
    expect(
      events.some((event) => event.type === "harness.phase" && event.phase === "correcting"),
    ).toBe(true);
    expect(
      results.some(
        (event) =>
          event.type === "harness.validation" &&
          event.status === "passed" &&
          event.exitCode === 0 &&
          event.output.includes("REAL_FIXTURE_TESTS_PASSED"),
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "run.completed")).toBe(true);
    expect(events.some((event) => event.type === "run.failed")).toBe(false);
    expect(readFileSync(join(fixtureRoot, "sum.cjs"), "utf8")).not.toContain("a - b");
    console.info(
      JSON.stringify({
        liveHarness: "passed",
        model: modelId,
        actualValidationExitCodes: results.flatMap((event) =>
          event.type === "harness.validation" && event.status !== "running" ? [event.exitCode] : [],
        ),
        correctionAttempts: events.filter(
          (event) => event.type === "harness.phase" && event.phase === "correcting",
        ).length,
      }),
    );
  }, 240000);
});
