import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import {
  type AgentSession,
  createAgentSession,
  type ResourceLoader,
  SessionManager,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { BrowserWindow as BrowserWindowType } from "electron";
import type {
  AgentEvent,
  AgentRunInfo,
  AgentSessionInfo,
  AgentSessionSnapshot,
  ModelInfo,
} from "../../shared/contracts";
import { type AgentMode, validationStatusLabel } from "../../shared/harness";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "../../shared/session-title";
import { classifyFailure, redactSecrets, type TaskFailure } from "../../shared/task-failure";
import { resolveWithin } from "../files/path-within";
import { preparePromptImage } from "../files/prompt-image";
import { createHarnessApprovalExtension } from "../harness/approval-policy";
import { auditHarnessEvent } from "../harness/audit-log";
import { checkpointStore } from "../harness/checkpoints";
import { approveTaskPlan, parseTaskPlan } from "../harness/planning";
import { createValidationRetryPrompt, shouldRetryValidation } from "../harness/retry-policy";
import {
  finalReviewDecision,
  TaskFailureError,
  TaskRejectedError,
} from "../harness/task-lifecycle";
import { findValidationCommands, runValidation } from "../harness/validation";
import {
  denyPendingQuestionRequestsForSession,
  requestQuestions,
} from "../interaction/question-broker";
import { IPC_CHANNELS } from "../ipc/channels";
import { maybeNotifyAgentEvent } from "../notifications/agent-notifications";
import { listSkills } from "../skills/skills-service";
import {
  appendAgentView,
  messagePresentations,
  releaseAgentView,
  seedAgentView,
} from "./agent-history";
import { getPiCliAgentDir } from "./agent-paths";
import { createAgentResourceLoader } from "./agent-resources";
import {
  createAgentRun,
  getActiveAgentRun,
  getAgentRun,
  listAgentRuns,
  releaseAgentRuns,
  updateAgentRunStatus,
} from "./agent-run-store";
import { createAgentSettings } from "./agent-settings";
import {
  bindSessionManager,
  createAgentSessionRecord,
  getAgentSession,
  openSessionFile,
  releaseSessionManager,
  touchAgentSession,
  updateAgentSessionMetadata,
  updateAgentSessionStatus,
  updateAgentSessionTitle,
} from "./agent-store";
import { createDialogUI, createExtensionUI, isExtensionCommandActive } from "./extension-ui";
import { diagnoseModelSelection, logProviderFailure } from "./model-diagnostics";
import {
  cycleDefaultModel,
  findModel,
  getModelInfo,
  getModelRuntime,
  listScopedModels,
  modelToId,
  resolveModelThinking,
} from "./model-service";
import { createPiEventNormalizer } from "./pi-event-normalizer";
import type {
  AgentRuntime,
  CreateAgentRuntimeInput,
  EmitAgentEvent,
  PromptAgentInput,
} from "./runtime";
import { sessionDirectory } from "./session-directory";
import {
  assertConfigurationReady,
  registerSessionResources,
  releaseSessionResources,
  reloadPiConfiguration,
} from "./session-resources";

type SdkRuntimeSession = {
  info: AgentSessionInfo;
  session: AgentSession;
  unsubscribe: () => void;
  emit: EmitAgentEvent;
  emitVolatile: EmitAgentEvent;
};

type RunObservation = {
  startedAt: number;
  assistant?: { stopReason: string; errorMessage?: string };
};

function resetAssistant(observation: RunObservation): void {
  delete observation.assistant;
}

const TOOL_DELTA_THROTTLE_MS = 100;

export class PiSdkRuntime implements AgentRuntime {
  private taskControllers = new Map<string, AbortController>();
  private sessions = new Map<string, SdkRuntimeSession>();
  private resumePromises = new Map<string, Promise<SdkRuntimeSession | undefined>>();
  private disposePromises = new Map<string, Promise<void>>();
  private runObservations = new Map<string, RunObservation>();
  private cancellingRuns = new Set<string>();
  private approvedPlans = new Map<string, import("../harness/planning").TaskPlan>();
  private reviewedChanges = new Map<
    string,
    Map<string, { path: string; before: string; after: string }>
  >();
  private planningSessions = new Set<string>();
  private validationControllers = new Map<string, AbortController>();
  private changedSessions = new Set<string>();
  private presentations = new Map<
    string,
    {
      messageId: string;
      text: string;
      paths?: string[];
      skills?: PromptAgentInput["skills"];
      attachments?: { path: string; mimeType: string; name?: string }[];
    }[]
  >();

  private emitToWindow(window: BrowserWindowType): EmitAgentEvent {
    return (event) => {
      if (event.type === "harness.change") {
        const changes = this.reviewedChanges.get(event.sessionId) ?? new Map();
        const previous = changes.get(event.path);
        changes.set(event.path, {
          path: event.path,
          before: previous?.before ?? event.before,
          after: event.after,
        });
        this.reviewedChanges.set(event.sessionId, changes);
      }
      if (event.type.startsWith("harness.")) {
        this.sessions
          .get(event.sessionId)
          ?.session.sessionManager.appendCustomEntry("mylo.harness", event);
      }
      appendAgentView(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
      maybeNotifyAgentEvent(window, event);
    };
  }

  private emitVolatileToWindow(window: BrowserWindowType): EmitAgentEvent {
    return (event) => {
      if (event.type === "tool.delta") appendAgentView(event);
      window.webContents.send(IPC_CHANNELS.agentEvent, event);
    };
  }

  private emitContextUsage(runtimeSession: SdkRuntimeSession): void {
    const event = createContextUsageEvent(runtimeSession.info.id, runtimeSession.session);
    if (event) {
      runtimeSession.emitVolatile(event);
    }
  }

  private sessionSnapshot(runtime: SdkRuntimeSession): AgentSessionSnapshot {
    const model = runtime.session.model;
    runtime.info =
      updateAgentSessionMetadata(runtime.info.id, {
        ...(model ? { model: modelToId(model) } : {}),
        thinkingLevel: runtime.session.thinkingLevel,
      }) ?? runtime.info;
    const usage = createContextUsageEvent(runtime.info.id, runtime.session)?.usage;
    return { ...runtime.info, ...(usage ? { contextUsage: usage } : {}) };
  }

  private publishSession(runtime: SdkRuntimeSession): AgentSessionSnapshot {
    const session = this.sessionSnapshot(runtime);
    runtime.emitVolatile({ type: "session.updated", sessionId: session.id, session });
    return session;
  }

  private async getOrResume(
    window: BrowserWindowType,
    sessionId: string,
    modelOverride?: string,
  ): Promise<SdkRuntimeSession | undefined> {
    assertConfigurationReady();
    await this.disposePromises.get(sessionId);
    assertConfigurationReady();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const pending = this.resumePromises.get(sessionId);
    if (pending) {
      return await pending;
    }

    const next = this.createRuntimeSession(window, sessionId, modelOverride).finally(() => {
      this.resumePromises.delete(sessionId);
    });
    this.resumePromises.set(sessionId, next);
    return await next;
  }

  assertIdle(): void {
    if (
      this.taskControllers.size ||
      this.resumePromises.size ||
      this.disposePromises.size ||
      this.runObservations.size ||
      this.presentations.size ||
      [...this.sessions.values()].some(
        ({ session }) => !session.isIdle || isExtensionCommandActive(session),
      )
    )
      throw new Error(
        "Wait for the agent, compaction, or extension command to finish before reloading PI configuration.",
      );
  }

  async reloadConfiguration() {
    const state = await reloadPiConfiguration(this);
    for (const session of this.sessions.values()) this.publishSession(session);
    return state;
  }

  async ensure(window: BrowserWindowType, sessionId: string): Promise<AgentSessionSnapshot> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }
    return this.sessionSnapshot(runtimeSession);
  }

  private async createSessionResources(
    cwd: string,
    sessionId: string,
    emit: EmitAgentEvent,
  ): Promise<{ settingsManager: SettingsManager; loader: ResourceLoader }> {
    const settingsManager = createAgentSettings({
      cwd,
    });
    const loader = await createAgentResourceLoader(
      cwd,
      settingsManager,
      [
        {
          name: "session-model",
          factory: (pi) => {
            const publish = () => {
              const runtime = this.sessions.get(sessionId);
              if (runtime) this.publishSession(runtime);
            };
            pi.on("model_select", publish);
            pi.on("thinking_level_select", publish);
          },
        },
        createHarnessApprovalExtension({
          cwd,
          sessionId,
          emit,
          getPlan: () => this.approvedPlans.get(sessionId),
          isPlanning: () => this.planningSessions.has(sessionId),
          onCodeChanged: () => this.changedSessions.add(sessionId),
          onWillChange: (change) => {
            const run = getActiveAgentRun(sessionId);
            if (!run) throw new Error("A running task is required before changing project files.");
            checkpointStore().capture(sessionId, run.id, cwd, change.path, change.after);
          },
        }),
      ],
      { cwd, mode: "rpc", hasUI: true, ui: createDialogUI(sessionId, emit) },
    );
    return { settingsManager, loader };
  }

  private async assembleSession(params: {
    info: AgentSessionInfo;
    emit: EmitAgentEvent;
    emitVolatile: EmitAgentEvent;
    agentDir: string;
    loader: ResourceLoader;
    settingsManager: SettingsManager;
    sessionManager: SessionManager;
    model: NonNullable<Parameters<typeof createAgentSession>[0]>["model"];
    thinkingLevel: NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"];
  }): Promise<SdkRuntimeSession> {
    const sessionOptions: Parameters<typeof createAgentSession>[0] = {
      cwd: params.info.cwd,
      agentDir: params.agentDir,
      modelRuntime: await getModelRuntime(),
      resourceLoader: params.loader,
      sessionManager: params.sessionManager,
      settingsManager: params.settingsManager,
      scopedModels: await listScopedModels(params.settingsManager),
    };
    if (params.model !== undefined) {
      sessionOptions.model = params.model;
      if (params.thinkingLevel !== undefined) {
        sessionOptions.thinkingLevel = params.thinkingLevel;
      }
    }

    const { session, modelFallbackMessage } = await createAgentSession(sessionOptions);
    if (modelFallbackMessage)
      params.emitVolatile({
        type: "extension.notice",
        sessionId: params.info.id,
        message: modelFallbackMessage,
        level: "warning",
      });
    bindSessionManager(params.info.id, session.sessionManager);
    seedAgentView(params.info.id);
    if (!session.sessionManager.getSessionName() && params.info.title !== "New chat")
      session.setSessionName(params.info.title);
    const normalizePiEvent = createPiEventNormalizer(params.info.id);
    const publishContextUsage = () => {
      const event = createContextUsageEvent(params.info.id, session);
      if (event) {
        params.emitVolatile(event);
      }
    };
    let lastToolDeltaAt = 0;
    let pendingToolDelta: Extract<AgentEvent, { type: "tool.delta" }> | undefined;
    let toolDeltaTimer: ReturnType<typeof setTimeout> | undefined;
    let runtimeSession: SdkRuntimeSession | undefined;
    const flushPendingToolDelta = (): void => {
      toolDeltaTimer = undefined;
      if (!pendingToolDelta) return;
      const event = pendingToolDelta;
      pendingToolDelta = undefined;
      lastToolDeltaAt = Date.now();
      params.emitVolatile(event);
    };
    const hiddenPlanningMessages = new Set<string>();
    const sessionUnsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "user") {
        const message = event.message;
        queueMicrotask(() => {
          const entry = session.sessionManager
            .getBranch()
            .find((item) => item.type === "message" && item.message === message);
          const presentation = this.presentations.get(params.info.id)?.shift();
          if (entry && presentation)
            session.sessionManager.appendCustomEntry("modus.message", {
              entryId: entry.id,
              ...presentation,
            });
        });
      }
      const observation = this.runObservations.get(params.info.id);
      if (observation && event.type === "message_end" && event.message.role === "assistant") {
        observation.assistant = {
          stopReason: event.message.stopReason,
          ...(event.message.errorMessage ? { errorMessage: event.message.errorMessage } : {}),
        };
      }
      for (const normalized of normalizePiEvent(event)) {
        if (this.planningSessions.has(params.info.id)) {
          // The planning reply is machine JSON; it is parsed and re-emitted as harness.plan.
          if (normalized.type === "message.started" && normalized.role === "assistant")
            hiddenPlanningMessages.add(normalized.messageId);
          if (
            (normalized.type === "message.started" ||
              normalized.type === "message.delta" ||
              normalized.type === "message.completed") &&
            hiddenPlanningMessages.has(normalized.messageId)
          )
            continue;
        }
        if (normalized.type === "tool.started") {
          const label = session.getToolDefinition(normalized.toolName)?.label;
          if (label) normalized.label = label;
        }
        if (normalized.type === "tool.delta") {
          pendingToolDelta = normalized;
          const wait = TOOL_DELTA_THROTTLE_MS - (Date.now() - lastToolDeltaAt);
          if (wait <= 0) {
            if (toolDeltaTimer !== undefined) {
              clearTimeout(toolDeltaTimer);
              toolDeltaTimer = undefined;
            }
            flushPendingToolDelta();
          } else if (toolDeltaTimer === undefined) {
            toolDeltaTimer = setTimeout(flushPendingToolDelta, wait);
          }
        } else {
          if (pendingToolDelta || toolDeltaTimer !== undefined) {
            if (toolDeltaTimer !== undefined) clearTimeout(toolDeltaTimer);
            flushPendingToolDelta();
          }
          params.emit(normalized);
        }
      }
      if (shouldPublishContextUsage(event)) {
        publishContextUsage();
      }
    });
    const unsubscribe = (): void => {
      if (toolDeltaTimer !== undefined) {
        clearTimeout(toolDeltaTimer);
        toolDeltaTimer = undefined;
      }
      if (pendingToolDelta) {
        params.emitVolatile(pendingToolDelta);
        pendingToolDelta = undefined;
      }
      sessionUnsubscribe();
    };

    const metadata: Parameters<typeof updateAgentSessionMetadata>[1] = {
      piSessionId: session.sessionId,
    };
    const nextModelId = session.model
      ? modelToId(session.model)
      : params.model
        ? modelToId(params.model)
        : params.info.model;
    if (nextModelId !== undefined) {
      metadata.model = nextModelId;
    }
    if (session.sessionFile !== undefined) {
      metadata.piSessionFile = session.sessionFile;
    }
    const updated = updateAgentSessionMetadata(params.info.id, metadata) ?? params.info;
    updateAgentSessionStatus(params.info.id, "idle");
    runtimeSession = {
      info: updated,
      session,
      unsubscribe,
      emit: params.emit,
      emitVolatile: params.emitVolatile,
    };
    this.sessions.set(params.info.id, runtimeSession);
    try {
      await session.bindExtensions({
        uiContext: createExtensionUI(session, params.info.id, (event) => {
          if (event.type === "extension.notice") params.emitVolatile(event);
          else params.emit(event);
        }),
        mode: "rpc",
      });
      registerSessionResources({
        id: params.info.id,
        cwd: params.info.cwd,
        session,
        loader: params.loader,
      });
    } catch (error) {
      this.sessions.delete(params.info.id);
      await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
      unsubscribe();
      session.dispose();
      throw error;
    }
    this.publishSession(runtimeSession);
    return runtimeSession;
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.resumePromises.values()]);
    const results = await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.dispose(id)),
    );
    await Promise.allSettled([...this.disposePromises.values()]);
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length)
      throw new AggregateError(
        errors.map((result) => result.reason),
        "Failed to close agent sessions.",
      );
  }

  async create(
    window: BrowserWindowType,
    input: CreateAgentRuntimeInput,
  ): Promise<AgentSessionInfo> {
    assertConfigurationReady();
    const emit = this.emitToWindow(window);
    const emitVolatile = this.emitVolatileToWindow(window);
    const selectedModel = input.model ? findModel(input.model) : undefined;
    if (input.model && !selectedModel) {
      throw new Error(
        `Model is not available: ${input.model ?? "default"}. Check the native provider configuration.`,
      );
    }
    const modelId = selectedModel ? modelToId(selectedModel) : input.model;
    const sessionManager = SessionManager.create(
      input.cwd,
      sessionDirectory(input.cwd),
      input.id ? { id: input.id } : undefined,
    );
    const recordInput: Parameters<typeof createAgentSessionRecord>[0] = {
      id: sessionManager.getSessionId(),
      piSessionId: sessionManager.getSessionId(),
      piSessionFile: sessionManager.getSessionFile()!,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      title: input.title,
      runtime: "pi-sdk",
    };
    if (modelId !== undefined) {
      recordInput.model = modelId;
    }
    const info = createAgentSessionRecord(recordInput);
    bindSessionManager(info.id, sessionManager);
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;

    const agentDir = getPiCliAgentDir();
    mkdirSync(agentDir, { recursive: true });

    const warmup = (async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const { settingsManager, loader } = await this.createSessionResources(
        input.cwd,
        info.id,
        emit,
      );
      return await this.assembleSession({
        info,
        emit,
        emitVolatile,
        agentDir,
        loader,
        settingsManager,
        sessionManager,
        model: selectedThinking?.model ?? selectedModel,
        thinkingLevel: selectedThinking?.thinkingLevel,
      });
    })().finally(() => {
      this.resumePromises.delete(info.id);
    });
    this.resumePromises.set(info.id, warmup);
    void warmup.catch(() => {
      updateAgentSessionStatus(info.id, "error");
    });
    return info;
  }

  private async createRuntimeSession(
    window: BrowserWindowType,
    sessionId: string,
    modelOverride?: string,
  ): Promise<SdkRuntimeSession | undefined> {
    const info = getAgentSession(sessionId);
    if (!info) {
      return undefined;
    }

    const emit = this.emitToWindow(window);
    const emitVolatile = this.emitVolatileToWindow(window);
    const agentDir = getPiCliAgentDir();
    const sessionDir = sessionDirectory(info.cwd);
    mkdirSync(agentDir, { recursive: true });

    const { settingsManager, loader } = await this.createSessionResources(info.cwd, info.id, emit);

    const requestedModel = modelOverride;
    const selectedModel = requestedModel ? findModel(requestedModel) : undefined;
    if (requestedModel && !selectedModel) {
      throw new Error(
        `Model is not available: ${requestedModel ?? "default"}. Check the native provider configuration.`,
      );
    }
    const selectedThinking = selectedModel ? resolveModelThinking(selectedModel) : undefined;
    const sessionFile = info.piSessionFile;
    const sessionManager = sessionFile
      ? openSessionFile(sessionFile)
      : SessionManager.create(info.cwd, sessionDir);
    const runtime = await this.assembleSession({
      info,
      emit,
      emitVolatile,
      agentDir,
      loader,
      settingsManager,
      sessionManager,
      model: sessionFile && !modelOverride ? undefined : (selectedThinking?.model ?? selectedModel),
      thinkingLevel: sessionFile && !modelOverride ? undefined : selectedThinking?.thinkingLevel,
    });
    if (!this.taskControllers.has(sessionId)) {
      const previous = runtime.session.sessionManager
        .getBranch()
        .findLast(
          (entry) =>
            entry.type === "custom" &&
            entry.customType === "mylo.harness" &&
            (entry.data as { type?: string })?.type === "harness.phase",
        );
      const phase =
        previous?.type === "custom" ? (previous.data as { phase?: string }).phase : undefined;
      if (
        phase &&
        !["completed", "failed", "cancelled", "awaiting_review", "rejected"].includes(phase)
      )
        runtime.emit({
          type: "harness.phase",
          sessionId,
          phase: "cancelled",
          detail:
            "Previous task was interrupted when the app closed. Review existing changes before starting another task.",
        });
    }
    return runtime;
  }

  async prompt(window: BrowserWindowType, input: PromptAgentInput): Promise<void> {
    assertConfigurationReady();
    if (this.taskControllers.has(input.sessionId)) {
      const current = this.sessions.get(input.sessionId);
      if (
        input.delivery &&
        input.delivery !== "normal" &&
        current?.session.isStreaming &&
        this.approvedPlans.has(input.sessionId) &&
        !this.planningSessions.has(input.sessionId)
      ) {
        await this.enqueueTurnMessage(current, input, input.delivery);
        return;
      }
      throw new Error(
        "A task is already active in this session. Finish its approval or stop it before starting another task.",
      );
    }
    const controller = new AbortController();
    this.taskControllers.set(input.sessionId, controller);
    try {
      await this.runPrompt(window, input, controller.signal);
    } finally {
      this.taskControllers.delete(input.sessionId);
    }
  }

  private async runPrompt(
    window: BrowserWindowType,
    input: PromptAgentInput,
    signal: AbortSignal,
  ): Promise<void> {
    assertConfigurationReady();
    if (input.attachments?.length) {
      input = {
        ...input,
        attachments: await Promise.all(
          input.attachments.map(async (image) => ({
            ...image,
            path: await preparePromptImage(image),
          })),
        ),
      };
    }
    const delivery = input.delivery ?? "normal";
    const emit = this.emitToWindow(window);
    let earlyUserMessageId: string | undefined;
    const failEarlyPrompt = (error: unknown): Error => {
      const message = error instanceof Error ? error.message : String(error);
      if (earlyUserMessageId !== undefined) {
        updateAgentSessionStatus(input.sessionId, "error");
        emit({ type: "runtime.error", sessionId: input.sessionId, message });
        emit({ type: "session.status", sessionId: input.sessionId, status: { type: "idle" } });
      }
      return error instanceof Error ? error : new Error(message);
    };
    if (delivery === "normal") {
      earlyUserMessageId = input.userMessageId ?? `local-user:${randomUUID()}`;
      this.emitUserMessage(emit, input, earlyUserMessageId);
      updateAgentSessionStatus(input.sessionId, "running");
      emit({ type: "session.status", sessionId: input.sessionId, status: { type: "busy" } });
    }

    let runtimeSession: SdkRuntimeSession | undefined;
    try {
      runtimeSession = await this.getOrResume(window, input.sessionId);
    } catch (error) {
      throw failEarlyPrompt(error);
    }
    if (!runtimeSession) {
      throw failEarlyPrompt(`Agent session not running: ${input.sessionId}`);
    }

    if (signal.aborted) throw failEarlyPrompt(new Error("Task cancelled before execution."));
    runtimeSession.info = {
      ...runtimeSession.info,
      updatedAt: touchAgentSession(input.sessionId),
    };

    try {
      if (input.model !== undefined) {
        await this.applyModelSelection(
          runtimeSession,
          input.model,
          input.thinkingVariant ?? input.thinkingLevel,
        );
      }
    } catch (error) {
      throw failEarlyPrompt(error);
    }

    if (delivery !== "normal" && runtimeSession.session.isStreaming) {
      await this.enqueueTurnMessage(runtimeSession, input, delivery);
      return;
    }
    const mode: AgentMode = input.mode ?? "agent";

    if (shouldReplaceSessionTitle(runtimeSession.info.title)) {
      const title = deriveSessionTitle(input.message);
      const updated = updateAgentSessionTitle(input.sessionId, title);
      if (updated) {
        runtimeSession.info = updated;
        this.publishSession(runtimeSession);
      }
    }
    const runInput: Parameters<typeof createAgentRun>[0] = {
      sessionId: input.sessionId,
      prompt: input.message,
    };
    if (earlyUserMessageId !== undefined) runInput.userMessageId = earlyUserMessageId;
    else if (input.userMessageId !== undefined) runInput.userMessageId = input.userMessageId;
    if (runtimeSession.info.model !== undefined) runInput.model = runtimeSession.info.model;
    runInput.mode = mode;
    const run = createAgentRun(runInput);
    const observation: RunObservation = {
      startedAt: Date.now(),
    };
    this.runObservations.set(input.sessionId, observation);

    updateAgentSessionStatus(input.sessionId, "running");
    const userMessageId = earlyUserMessageId ?? input.userMessageId ?? `user:${run.id}`;
    if (earlyUserMessageId === undefined)
      this.emitUserMessage(runtimeSession.emit, input, userMessageId);
    const startedEvent = {
      type: "run.started",
      sessionId: input.sessionId,
      runId: run.id,
      userMessageId,
      delivery,
    } as const;
    runtimeSession.emit(startedEvent);
    runtimeSession.emit({
      type: "harness.task",
      sessionId: input.sessionId,
      runId: run.id,
      request: input.message,
      startedAt: new Date().toISOString(),
      mode,
    });
    runtimeSession.emit({
      type: "harness.skills",
      sessionId: input.sessionId,
      skills: listSkills(input.sessionId).skills.map(({ name, description, path, source }) => ({
        name,
        description,
        path,
        source,
      })),
    });
    if (earlyUserMessageId === undefined) {
      runtimeSession.emit({
        type: "session.status",
        sessionId: input.sessionId,
        status: { type: "busy" },
      });
    }
    let manualReview = false;
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      if (this.cancellingRuns.has(run.id)) throw new Error("Prompt cancelled");
      console.info(
        `[modus-timing] composeTurnMessage done +${Date.now() - observation.startedAt}ms`,
      );
      await this.preflightModel(runtimeSession);
      if (mode === "ask") {
        const answer = await this.answerReadOnly(runtimeSession, message, observation);
        if (answer.aborted) this.cancellingRuns.add(run.id);
        if (this.cancellingRuns.has(run.id)) throw new Error("Prompt cancelled");
        updateAgentRunStatus(run.id, "completed");
        runtimeSession.emit({
          type: "harness.phase",
          sessionId: input.sessionId,
          phase: "completed",
          detail: "Answered in Ask mode. No files were changed.",
        });
        runtimeSession.emit({ type: "run.completed", sessionId: input.sessionId, runId: run.id });
        return;
      }
      const plan = await this.planTask(runtimeSession, message, mode);
      this.runObservations.set(input.sessionId, observation);
      if (this.cancellingRuns.has(run.id)) throw new Error("Prompt cancelled");
      if (mode === "plan") {
        updateAgentRunStatus(run.id, "completed");
        runtimeSession.emit({
          type: "harness.phase",
          sessionId: input.sessionId,
          phase: "completed",
          detail: `Plan approved (${plan.steps.length} steps). No files were changed. Switch to Agent mode to execute it.`,
        });
        runtimeSession.emit({
          type: "run.completed",
          sessionId: input.sessionId,
          runId: run.id,
          summary: `Plan: ${plan.goal}`,
        });
        return;
      }
      this.approvedPlans.set(input.sessionId, plan);
      runtimeSession.session.setActiveToolsByName([
        ...new Set([...runtimeSession.session.getActiveToolNames(), "mylo_step"]),
      ]);
      runtimeSession.emit({
        type: "harness.phase",
        sessionId: input.sessionId,
        phase: "executing",
        detail: "Executing the approved plan with Pi tools.",
      });
      resetAssistant(observation);
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        ...(delivery !== "normal"
          ? { streamingBehavior: delivery === "follow-up" ? "followUp" : "steer" }
          : {}),
      });
      this.emitContextUsage(runtimeSession);
      if (observation.assistant?.stopReason === "error")
        throw new Error(
          observation.assistant.errorMessage || "The provider failed during execution.",
        );
      if (observation.assistant?.stopReason === "aborted") this.cancellingRuns.add(run.id);
      const validationOutcome = !this.cancellingRuns.has(run.id)
        ? await this.validateAndCorrect(runtimeSession, run.id)
        : "skipped";
      if (!this.cancellingRuns.has(run.id) && observation.assistant?.stopReason !== "error") {
        runtimeSession.emit({
          type: "harness.phase",
          sessionId: input.sessionId,
          phase: "review",
          detail: "Review the file diffs and validation results before accepting.",
        });
        const review = await requestQuestions({
          sessionId: input.sessionId,
          emit: runtimeSession.emit,
          questions: [
            {
              codeChanges: [...(this.reviewedChanges.get(input.sessionId)?.values() ?? [])].map(
                (change) => {
                  let after = change.after;
                  try {
                    const path = resolveWithin(runtimeSession.info.cwd, change.path);
                    resolveWithin(realpathSync(runtimeSession.info.cwd), realpathSync(path));
                    after = readFileSync(path, "utf8").slice(0, 128000);
                  } catch {
                    /* Deleted files retain the last approved proposal. */
                  }
                  return { ...change, after };
                },
              ),
              id: "accept-task",
              header: "Accept this task result?",
              detail: `Validation: ${validationStatusLabel(validationOutcome)}.${validationOutcome !== "passed" ? " No validation passed." : ""} Review the Diff and Tests panels. File changes already approved individually remain on disk. You can keep them for manual review instead of marking the task accepted.`,
              options: [{ label: "Accept result" }, { label: "Keep for manual review" }],
            },
          ],
        });
        manualReview = finalReviewDecision(review) === "manual_review";
      }
      const currentRun = getAgentRun(run.id);
      if (currentRun?.status === "running") {
        const cancelled =
          this.cancellingRuns.has(run.id) || observation.assistant?.stopReason === "aborted";
        if (cancelled) {
          updateAgentRunStatus(run.id, "cancelled");
          runtimeSession.emit({ type: "run.cancelled", sessionId: input.sessionId, runId: run.id });
        } else if (observation.assistant?.stopReason === "error") {
          const turnFailure = classifyFailure(
            observation.assistant.errorMessage ||
              "The model returned an error without additional details.",
          );
          updateAgentRunStatus(run.id, "failed", turnFailure.message, turnFailure);
          updateAgentSessionStatus(input.sessionId, "error");
          runtimeSession.emit({
            type: "run.failed",
            sessionId: input.sessionId,
            runId: run.id,
            message: turnFailure.message,
            failure: turnFailure,
          });
        } else if (manualReview) {
          updateAgentRunStatus(run.id, "awaiting_review");
          runtimeSession.emit({
            type: "harness.phase",
            sessionId: input.sessionId,
            phase: "awaiting_review",
            detail: `Kept for manual review. File changes were preserved and nothing was marked accepted. Validation: ${validationStatusLabel(validationOutcome)}.`,
          });
          runtimeSession.emit({
            type: "run.awaiting_review",
            sessionId: input.sessionId,
            runId: run.id,
            validation: validationOutcome,
          });
        } else {
          runtimeSession.emit({
            type: "harness.phase",
            sessionId: input.sessionId,
            phase: "completed",
            detail: `Task result accepted. Validation: ${validationStatusLabel(validationOutcome)}.${validationOutcome !== "passed" ? " No validation passed." : ""}`,
          });
          updateAgentRunStatus(run.id, "completed");
          runtimeSession.emit({
            type: "run.completed",
            sessionId: input.sessionId,
            runId: run.id,
          });
        }
      }
    } catch (error) {
      const currentRun = getAgentRun(run.id);
      if (!currentRun || currentRun.status === "cancelled") {
        return;
      }
      if (this.cancellingRuns.has(run.id)) {
        updateAgentRunStatus(run.id, "cancelled");
        runtimeSession.emit({ type: "run.cancelled", sessionId: input.sessionId, runId: run.id });
        return;
      }
      if (error instanceof TaskRejectedError) {
        updateAgentRunStatus(run.id, "rejected");
        runtimeSession.emit({
          type: "harness.phase",
          sessionId: input.sessionId,
          phase: "rejected",
          detail: `${error.message} Nothing was executed.`,
        });
        runtimeSession.emit({
          type: "run.rejected",
          sessionId: input.sessionId,
          runId: run.id,
          reason: error.reason,
        });
        return;
      }
      const failure: TaskFailure =
        error instanceof TaskFailureError ? error.failure : classifyFailure(error);
      logProviderFailure(`run:${failure.category}`, runtimeSession.info.model, error);
      updateAgentRunStatus(run.id, "failed", failure.message, failure);
      updateAgentSessionStatus(input.sessionId, "error");
      runtimeSession.emit({
        type: "run.failed",
        sessionId: input.sessionId,
        runId: run.id,
        message: failure.message,
        failure,
      });
      throw error;
    } finally {
      await auditHarnessEvent({
        type: "run.result",
        sessionId: input.sessionId,
        outcome: getAgentRun(run.id)?.status ?? "unknown",
      });
      const outcome = getAgentRun(run.id)?.status;
      if (outcome === "failed" || outcome === "cancelled")
        runtimeSession.emit({
          type: "harness.phase",
          sessionId: input.sessionId,
          phase: outcome,
          detail: getAgentRun(run.id)?.error ?? "Task cancelled.",
        });
      this.reviewedChanges.delete(input.sessionId);
      this.approvedPlans.delete(input.sessionId);
      this.changedSessions.delete(input.sessionId);
      this.presentations.delete(input.sessionId);
      this.runObservations.delete(input.sessionId);
      this.cancellingRuns.delete(run.id);
      console.info(`[modus-timing] turn end (idle emit) +${Date.now() - observation.startedAt}ms`);
      const session = getAgentSession(input.sessionId);
      if (session?.status !== "error") {
        updateAgentSessionStatus(input.sessionId, "idle");
      }
      runtimeSession.emit({
        type: "session.status",
        sessionId: input.sessionId,
        status: { type: "idle" },
      });
    }
  }

  private async preflightModel(runtime: SdkRuntimeSession): Promise<void> {
    const modelRuntime = await getModelRuntime();
    const failure = diagnoseModelSelection(runtime.info.model, {
      find: (reference) => findModel(reference),
      isProviderConfigured: (provider) => {
        try {
          return modelRuntime.getProviderAuthStatus(provider).configured;
        } catch {
          return undefined;
        }
      },
    });
    if (failure) throw new TaskFailureError(failure);
  }

  /** Ask mode: answer with read-only repository tools; no plan, edits, commands or validation. */
  private async answerReadOnly(
    runtime: SdkRuntimeSession,
    message: string,
    observation: RunObservation,
  ): Promise<{ aborted: boolean }> {
    const { session, info, emit } = runtime;
    emit({
      type: "harness.phase",
      sessionId: info.id,
      phase: "executing",
      detail: "Answering in Ask mode with read-only tools. Files will not be changed.",
    });
    const tools = session.getActiveToolNames();
    try {
      session.setActiveToolsByName(["read", "ls", "find", "grep"]);
      resetAssistant(observation);
      await session.prompt(message, { source: "rpc" });
      this.emitContextUsage(runtime);
      if (observation.assistant?.stopReason === "error")
        throw new Error(
          observation.assistant.errorMessage || "The provider failed while answering.",
        );
      return { aborted: observation.assistant?.stopReason === "aborted" };
    } finally {
      session.setActiveToolsByName(tools);
    }
  }

  private async planTask(
    runtime: SdkRuntimeSession,
    request: string,
    mode: AgentMode = "agent",
  ): Promise<import("../../shared/harness").TaskPlan> {
    const { session, info, emit } = runtime;
    emit({
      type: "harness.phase",
      sessionId: info.id,
      phase: "planning",
      detail: "Pi is exploring the repository with read-only tools.",
    });
    this.planningSessions.add(info.id);
    const tools = session.getActiveToolNames();
    try {
      session.setActiveToolsByName(["read", "ls", "find", "grep"]);
      await session.prompt(
        `${request}\n\nPLAN ONLY: Explore relevant repository files using read-only tools. Do not edit or execute commands. Return only JSON: {"goal":"specific goal","steps":["concrete steps referencing actual files and validation commands"]}.`,
        { source: "extension" },
      );
      const last = session.messages.findLast((message) => message.role === "assistant");
      if (!last || last.role !== "assistant")
        throw new Error("Pi returned no assistant response while planning.");
      if (last.stopReason === "aborted") throw new Error("Planning cancelled.");
      if (last.stopReason === "error")
        throw new Error(
          `Pi planning failed: ${last.errorMessage || "The model provider returned an error without details."}`,
        );
      const text = last.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      let parsed: import("../../shared/harness").TaskPlan;
      try {
        parsed = parseTaskPlan(text);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        emit({
          type: "harness.plan_error",
          sessionId: info.id,
          message: `The plan returned by the model could not be parsed: ${reason}`,
          raw: redactSecrets(text).slice(0, 4000),
        });
        throw new Error(`Pi planning failed: the plan could not be parsed (${reason}).`);
      }
      return await approveTaskPlan(parsed, info.id, emit, mode);
    } finally {
      this.planningSessions.delete(info.id);
      session.setActiveToolsByName(tools);
    }
  }

  private async validateAndCorrect(
    runtime: SdkRuntimeSession,
    runId: string,
  ): Promise<"passed" | "skipped" | "not_configured"> {
    const { info, session, emit } = runtime;
    const commands = await findValidationCommands(info.cwd);
    if (!commands.length) {
      emit({
        type: "harness.validation",
        sessionId: info.id,
        attempt: 0,
        label: "Project checks",
        status: "not_configured",
        output: "No supported validation scripts found. Validation was not performed.",
        exitCode: null,
      });
      return "not_configured";
    }
    const approval = await requestQuestions({
      sessionId: info.id,
      emit,
      questions: [
        {
          id: "run-workspace-tests",
          header: "Run workspace validation?",
          detail: commands.map((command) => command.label).join("\n"),
          options: [{ label: "Run checks" }, { label: "Skip" }],
        },
      ],
    });
    if (approval.skipped || approval.answers[0]?.selected[0] !== "Run checks") {
      emit({
        type: "harness.validation",
        sessionId: info.id,
        attempt: 0,
        label: "Project checks",
        status: "skipped",
        output: "Validation skipped by the user.",
        exitCode: null,
      });
      return "skipped";
    }
    const controller = new AbortController();
    this.validationControllers.set(info.id, controller);
    try {
      for (let attempt = 0; attempt <= 3; attempt++) {
        if (this.cancellingRuns.has(runId)) throw new Error("Task cancelled");
        emit({
          type: "harness.phase",
          sessionId: info.id,
          phase: "validating",
          detail: `Running project checks (attempt ${attempt + 1}/4).`,
        });
        const failures: string[] = [];
        for (const command of commands) {
          emit({
            type: "harness.validation",
            sessionId: info.id,
            attempt,
            label: command.label,
            status: "running",
            output: "",
            exitCode: null,
          });
          const result = await runValidation(command, undefined, controller.signal);
          emit({
            type: "harness.validation",
            sessionId: info.id,
            attempt,
            label: command.label,
            status: result.passed ? "passed" : "failed",
            output: result.output,
            exitCode: result.exitCode,
          });
          await auditHarnessEvent({
            type: "validation",
            sessionId: info.id,
            outcome: result.passed ? "passed" : "failed",
            attempt,
            detail: `${command.label}: exit=${result.exitCode}`,
          });
          if (!result.passed)
            failures.push(`${command.label} (exit ${result.exitCode}):\n${result.output}`);
          if (controller.signal.aborted) throw new Error("Task cancelled");
        }
        if (!failures.length) return "passed";
        if (!shouldRetryValidation(attempt, false))
          throw new Error("Workspace validation failed after three correction attempts.");
        emit({
          type: "harness.phase",
          sessionId: info.id,
          phase: "correcting",
          detail: `Pi correction ${attempt + 1}/3.`,
        });
        const observation = this.runObservations.get(info.id);
        if (observation) resetAssistant(observation);
        await session.prompt(createValidationRetryPrompt(attempt + 1, failures.join("\n\n")), {
          source: "extension",
        });
        if (observation?.assistant?.stopReason === "error")
          throw new Error(
            observation.assistant.errorMessage || "The provider failed during correction.",
          );
        if (observation?.assistant?.stopReason === "aborted") {
          this.cancellingRuns.add(runId);
          throw new Error("Task cancelled");
        }
      }
      throw new Error("Workspace validation did not finish.");
    } finally {
      this.validationControllers.delete(info.id);
    }
  }

  async navigate(window: BrowserWindowType, sessionId: string, messageId: string): Promise<void> {
    const runtime = await this.getOrResume(window, sessionId);
    if (!runtime) throw new Error(`Agent session not found: ${sessionId}`);
    const presentation = [...messagePresentations(runtime.session.sessionManager)].find(
      ([, item]) => item.messageId === messageId,
    );
    const targetId = presentation?.[0] ?? messageId;
    const result = await runtime.session.navigateTree(targetId);
    if (result.cancelled) throw new Error("Session navigation was cancelled.");
    releaseAgentView(sessionId);
    seedAgentView(sessionId);
    this.publishSession(runtime);
  }

  async compact(window: BrowserWindowType, sessionId: string): Promise<void> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }
    if (!runtimeSession.session.isIdle) {
      throw new Error("Context can only be compacted while Modus is idle.");
    }

    updateAgentSessionStatus(sessionId, "running");
    runtimeSession.emit({ type: "session.status", sessionId, status: { type: "busy" } });
    try {
      await runtimeSession.session.compact();
    } finally {
      updateAgentSessionStatus(sessionId, "idle");
      runtimeSession.emit({ type: "session.status", sessionId, status: { type: "idle" } });
    }
  }

  private emitUserMessage(
    emit: EmitAgentEvent,
    input: PromptAgentInput,
    userMessageId: string,
  ): void {
    const pending = this.presentations.get(input.sessionId) ?? [];
    pending.push({
      messageId: userMessageId,
      text: input.message,
      ...(input.paths?.length ? { paths: input.paths } : {}),
      ...(input.skills?.length ? { skills: input.skills } : {}),
      ...(input.attachments?.length
        ? {
            attachments: input.attachments
              .filter((image) => image.path)
              .map((image) => ({
                path: image.path!,
                mimeType: image.mimeType,
                ...(image.name ? { name: image.name } : {}),
              })),
          }
        : {}),
    });
    this.presentations.set(input.sessionId, pending);
    emit({
      type: "message.started",
      sessionId: input.sessionId,
      messageId: userMessageId,
      role: "user",
      ...(input.attachments && input.attachments.length > 0
        ? { attachments: input.attachments }
        : {}),
      ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
      ...(input.paths?.length
        ? { contextItems: input.paths.map((path) => ({ type: "file" as const, path })) }
        : {}),
    });
    emit({
      type: "message.delta",
      sessionId: input.sessionId,
      messageId: userMessageId,
      delta: input.message,
    });
    emit({
      type: "message.completed",
      sessionId: input.sessionId,
      messageId: userMessageId,
    });
  }

  private async composeTurnMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
  ): Promise<string> {
    const message = [
      ...(input.paths ?? []),
      ...(input.skills?.slice(1).map((skill) => skill.path) ?? []),
      input.message,
      ...(input.attachments ?? []).map((image) => image.path),
    ]
      .filter(Boolean)
      .join("\n\n");
    const selected = input.skills?.[0];
    if (!selected) return message;
    const skill = runtimeSession.session.resourceLoader
      .getSkills()
      .skills.find((item) => item.filePath === selected.path);
    if (!skill)
      throw new Error(
        "The selected skill is not available in this session. Refresh the skill menu.",
      );
    return `/skill:${skill.name} ${message}`;
  }

  private async enqueueTurnMessage(
    runtimeSession: SdkRuntimeSession,
    input: PromptAgentInput,
    delivery: NonNullable<PromptAgentInput["delivery"]>,
  ): Promise<void> {
    const userMessageId = input.userMessageId ?? `local-user:${randomUUID()}`;
    this.emitUserMessage(runtimeSession.emit, input, userMessageId);
    try {
      const message = await this.composeTurnMessage(runtimeSession, input);
      const currentPlan = this.approvedPlans.get(input.sessionId);
      if (!currentPlan)
        throw new Error(
          "Wait for the current task plan or stop the agent before sending another task.",
        );
      const plan = await approveTaskPlan(
        {
          goal: currentPlan.goal,
          steps: [...currentPlan.steps, `Additional user instruction: ${input.message}`],
        },
        input.sessionId,
        runtimeSession.emit,
      );
      this.approvedPlans.set(input.sessionId, plan);
      await runtimeSession.session.prompt(message, {
        source: "rpc",
        streamingBehavior: delivery === "follow-up" ? "followUp" : "steer",
      });
      this.emitContextUsage(runtimeSession);
    } catch (error) {
      runtimeSession.emit({
        type: "runtime.error",
        sessionId: input.sessionId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async abort(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId)?.session;
    const queued = session?.clearQueue();
    await this.abortSessionOnly(sessionId);
    return queued ? [...queued.steering, ...queued.followUp] : [];
  }

  private async abortSessionOnly(sessionId: string): Promise<void> {
    this.taskControllers.get(sessionId)?.abort();
    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }
    const activeRun = getActiveAgentRun(sessionId);
    if (activeRun) {
      this.cancellingRuns.add(activeRun.id);
    }

    this.validationControllers.get(sessionId)?.abort();
    denyPendingQuestionRequestsForSession(sessionId);
    await runtimeSession.session.abort();
  }

  async listRuns(sessionId: string): Promise<AgentRunInfo[]> {
    return listAgentRuns(sessionId);
  }

  async dispose(sessionId: string): Promise<void> {
    assertConfigurationReady();
    await this.disposeSessionOnly(sessionId);
  }

  async releaseRuntime(sessionId: string): Promise<void> {
    assertConfigurationReady();
    await this.disposeSessionOnly(sessionId, true);
  }

  private disposeSessionOnly(sessionId: string, idleOnly = false): Promise<void> {
    const pending = this.disposePromises.get(sessionId);
    if (pending) return pending;
    const operation = this.closeRuntimeSession(sessionId, idleOnly).finally(() =>
      this.disposePromises.delete(sessionId),
    );
    this.disposePromises.set(sessionId, operation);
    return operation;
  }

  private async closeRuntimeSession(sessionId: string, idleOnly: boolean): Promise<void> {
    const pending = this.resumePromises.get(sessionId);
    if (pending) {
      await pending.catch(() => undefined);
    }

    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      return;
    }

    if (
      idleOnly &&
      (runtimeSession.session.isStreaming ||
        getActiveAgentRun(sessionId) ||
        isExtensionCommandActive(runtimeSession.session))
    )
      return;

    this.sessions.delete(sessionId);
    releaseSessionResources(sessionId);
    this.validationControllers.get(sessionId)?.abort();
    denyPendingQuestionRequestsForSession(sessionId);
    try {
      if (runtimeSession.session.isStreaming) await runtimeSession.session.abort();
      await runtimeSession.session.extensionRunner?.emit({
        type: "session_shutdown",
        reason: "quit",
      });
    } finally {
      runtimeSession.unsubscribe();
      runtimeSession.session.dispose();
      releaseSessionManager(sessionId);
      releaseAgentView(sessionId);
      releaseAgentRuns(sessionId);
    }
  }

  private async applyModelSelection(
    runtimeSession: SdkRuntimeSession,
    modelId: string,
    thinkingVariant?: string,
  ): Promise<void> {
    const model = findModel(modelId);
    if (!model) throw new Error(`Model is not available: ${modelId}`);
    await runtimeSession.session.setModel(model);
    if (thinkingVariant !== undefined) {
      const resolved = resolveModelThinking(model, thinkingVariant);
      runtimeSession.session.setThinkingLevel(resolved.thinkingLevel);
    }
  }

  async setModel(
    window: BrowserWindowType,
    sessionId: string,
    modelId: string,
    thinkingVariant?: string,
  ): Promise<AgentSessionSnapshot> {
    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Unable to set model: ${modelId}`);
    }
    await this.applyModelSelection(runtimeSession, modelId, thinkingVariant);
    return this.publishSession(runtimeSession);
  }

  async setThinking(
    window: BrowserWindowType,
    sessionId: string,
    thinkingVariant: string,
  ): Promise<AgentSessionSnapshot> {
    const runtime = await this.getOrResume(window, sessionId);
    if (!runtime?.session.model) throw new Error(`Agent session has no model: ${sessionId}`);
    const resolved = resolveModelThinking(runtime.session.model, thinkingVariant);
    runtime.session.setThinkingLevel(resolved.thinkingLevel);
    return this.publishSession(runtime);
  }

  async cycleModel(
    window: BrowserWindowType | undefined,
    sessionId: string | undefined,
    direction: "forward" | "backward" = "forward",
  ): Promise<ModelInfo> {
    if (!sessionId || !window) {
      return cycleDefaultModel(direction);
    }

    const runtimeSession = await this.getOrResume(window, sessionId);
    if (!runtimeSession) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }

    const selected = await runtimeSession.session.cycleModel(direction);
    if (!selected)
      throw new Error("No other model is available in this session's native model scope.");
    const id = modelToId(selected.model);
    this.publishSession(runtimeSession);
    const info = getModelInfo(id);
    if (!info) throw new Error(`Model is no longer available: ${id}`);
    return { ...info, thinkingLevel: selected.thinkingLevel };
  }
}

function createContextUsageEvent(
  sessionId: string,
  session: AgentSession,
): Extract<AgentEvent, { type: "context.updated" }> | undefined {
  const stats = session.getSessionStats();
  const usage = stats.contextUsage;
  if (!usage) {
    return undefined;
  }
  return {
    type: "context.updated",
    sessionId,
    usage: {
      ...usage,
      totals: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        cost: stats.cost,
      },
    },
  };
}

function shouldPublishContextUsage(event: { type?: unknown }): boolean {
  return (
    event.type === "agent_settled" ||
    event.type === "message_end" ||
    event.type === "tool_execution_end" ||
    event.type === "compaction_end"
  );
}
