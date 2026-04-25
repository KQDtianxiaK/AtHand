import { randomUUID } from "node:crypto";
import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentPersistenceHandle,
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
  ListModelsOptions,
  ListModesOptions,
} from "../agent-sdk-types.js";
import {
  applyProviderEnv,
  isProviderCommandAvailable,
  type ProviderRuntimeSettings,
} from "../provider-launch-config.js";
import { spawnProcess } from "../../../utils/spawn.js";
import { formatProviderDiagnosticError } from "./diagnostic-utils.js";
import { buildKimiArgs, buildKimiCommandPrefix } from "./kimi/command-builder.js";
import { formatKimiDiagnostic } from "./kimi/diagnostic.js";
import { translateKimiJsonLine, translateKimiNonJsonLine, mergeKimiUsage } from "./kimi/event-translator.js";
import { getKimiModels, normalizeKimiRuntimeModelId } from "./kimi/kimi-models.js";
import { buildKimiPersistenceHandle, coerceKimiResumeMetadata, extractKimiSessionId } from "./kimi/session-handle.js";

const KIMI_PROVIDER_ID = "kimi" as const;

const KIMI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

const DEFAULT_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Default",
    description: "Run Kimi Code in standard execution mode.",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Run Kimi Code with planning enabled.",
  },
  {
    id: "continue",
    label: "Continue",
    description: "Continue from the current working context without resume handle.",
  },
];

type KimiAgentConfig = AgentSessionConfig & { provider: "kimi" };

interface KimiAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
}

interface ExecuteTurnResult {
  result: AgentRunResult;
  turnId: string;
}

export class KimiAgentClient implements AgentClient {
  readonly provider = KIMI_PROVIDER_ID;
  readonly capabilities = KIMI_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;

  constructor(options: KimiAgentClientOptions) {
    this.logger = options.logger.child({ module: "agent", provider: KIMI_PROVIDER_ID });
    this.runtimeSettings = options.runtimeSettings;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const kimiConfig = this.assertConfig(config);
    return new KimiAgentSession(kimiConfig, {
      logger: this.logger,
      runtimeSettings: this.runtimeSettings,
      launchEnv: launchContext?.env,
    });
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadata = coerceKimiResumeMetadata(handle);
    const merged: Partial<AgentSessionConfig> = { ...metadata, ...overrides };
    if (!merged.cwd) {
      throw new Error("Kimi resume requires the original working directory in metadata");
    }
    const config: AgentSessionConfig = {
      provider: KIMI_PROVIDER_ID,
      cwd: merged.cwd,
      modeId: merged.modeId,
      model: merged.model,
      title: merged.title,
      approvalPolicy: merged.approvalPolicy,
      sandboxMode: merged.sandboxMode,
      networkAccess: merged.networkAccess,
      webSearch: merged.webSearch,
      featureValues: merged.featureValues,
      systemPrompt: merged.systemPrompt,
      mcpServers: merged.mcpServers,
    };
    const kimiConfig = this.assertConfig(config);
    return new KimiAgentSession(kimiConfig, {
      logger: this.logger,
      runtimeSettings: this.runtimeSettings,
      handle,
      launchEnv: launchContext?.env,
    });
  }

  async listModels(_options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return getKimiModels();
  }

  async listModes(_options: ListModesOptions): Promise<AgentMode[]> {
    return DEFAULT_MODES;
  }

  async isAvailable(): Promise<boolean> {
    return await isProviderCommandAvailable(this.runtimeSettings?.command, async () => "kimi");
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const available = await this.isAvailable();
      return { diagnostic: await formatKimiDiagnostic(available, this.runtimeSettings) };
    } catch (error) {
      return { diagnostic: formatProviderDiagnosticError("Kimi", error) };
    }
  }

  private assertConfig(config: AgentSessionConfig): KimiAgentConfig {
    if (config.provider !== KIMI_PROVIDER_ID) {
      throw new Error(`Invalid Kimi config provider: ${config.provider}`);
    }
    return config;
  }
}

interface KimiAgentSessionOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  handle?: AgentPersistenceHandle;
  launchEnv?: Record<string, string>;
}

class KimiAgentSession implements AgentSession {
  readonly provider = KIMI_PROVIDER_ID;
  readonly capabilities = KIMI_CAPABILITIES;
  readonly features = undefined;

  private readonly config: KimiAgentConfig;
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly launchEnv?: Record<string, string>;
  private readonly eventHistory: AgentStreamEvent[] = [];
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private readonly pendingPermissions: AgentPermissionRequest[] = [];

  private currentMode: string | null;
  private currentSessionId: string | null;
  private currentProcess: ChildProcessWithoutNullStreams | null = null;
  private currentTurnPromise: Promise<ExecuteTurnResult> | null = null;
  private currentTurnId: string | null = null;
  private interruptedTurnId: string | null = null;
  private closed = false;

  constructor(config: KimiAgentConfig, options: KimiAgentSessionOptions) {
    this.config = config;
    this.logger = options.logger.child({ provider: KIMI_PROVIDER_ID, cwd: config.cwd });
    this.runtimeSettings = options.runtimeSettings;
    this.launchEnv = options.launchEnv;
    this.currentMode = config.modeId ?? "default";
    this.currentSessionId = options.handle?.sessionId ?? null;
  }

  get id(): string | null {
    return this.currentSessionId;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const turnId = randomUUID();
    const { result } = await this.executeTurn(turnId, prompt, options);
    return result;
  }

  async startTurn(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<{ turnId: string }> {
    const turnId = randomUUID();
    const promise = this.executeTurn(turnId, prompt, options).finally(() => {
      if (this.currentTurnId === turnId) {
        this.currentTurnPromise = null;
        this.currentTurnId = null;
      }
    });
    this.currentTurnPromise = promise;
    this.currentTurnId = turnId;
    void promise.catch(() => undefined);
    return { turnId };
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.eventHistory) {
      yield event;
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return {
      provider: KIMI_PROVIDER_ID,
      sessionId: this.currentSessionId,
      model: normalizeKimiRuntimeModelId(this.config.model),
      modeId: this.currentMode,
      thinkingOptionId: this.config.thinkingOptionId ?? null,
      extra: {
        title: this.config.title ?? null,
      },
    };
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return DEFAULT_MODES;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentMode;
  }

  async setMode(modeId: string): Promise<void> {
    const matched = DEFAULT_MODES.find((mode) => mode.id === modeId);
    if (!matched) {
      throw new Error(`Unsupported Kimi mode: ${modeId}`);
    }
    this.currentMode = matched.id;
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pendingPermissions];
  }

  async respondToPermission(
    _requestId: string,
    _response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    return undefined;
  }

  describePersistence(): AgentPersistenceHandle | null {
    if (!this.currentSessionId) {
      return null;
    }
    return buildKimiPersistenceHandle(this.config, this.currentSessionId);
  }

  async interrupt(): Promise<void> {
    if (!this.currentProcess || !this.currentTurnId) {
      return;
    }
    this.interruptedTurnId = this.currentTurnId;
    this.currentProcess.kill();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.interrupt();
  }

  private async executeTurn(
    turnId: string,
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<ExecuteTurnResult> {
    if (this.closed) {
      throw new Error("Kimi session is closed");
    }
    if (this.currentProcess) {
      throw new Error("Concurrent Kimi turns are not supported");
    }

    const commandPrefix = await buildKimiCommandPrefix(this.runtimeSettings);
    const args = [...commandPrefix.args, ...buildKimiArgs({
      prompt,
      cwd: this.config.cwd,
      modeId: this.currentMode,
      resumeHandle: options?.resumeFrom ?? this.describePersistence(),
    })];
    const env = applyProviderEnv(
      {
        ...process.env,
        ...this.launchEnv,
      },
      this.runtimeSettings,
    );

    const processHandle = spawnProcess(commandPrefix.command, args, {
      cwd: this.config.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    this.currentProcess = processHandle;
    this.currentTurnId = turnId;

    const timeline: AgentTimelineItem[] = [];
    let usage = undefined;

    if (!this.currentSessionId) {
      this.emit({
        type: "thread_started",
        sessionId: turnId,
        provider: KIMI_PROVIDER_ID,
      });
    }
    this.emit({ type: "turn_started", provider: KIMI_PROVIDER_ID, turnId });

    const stdoutTask = (async () => {
      const reader = createInterface({ input: processHandle.stdout });
      for await (const line of reader) {
        try {
          const translated = translateKimiJsonLine(line);
          usage = mergeKimiUsage(usage, translated.usage);
          for (const item of translated.items) {
            timeline.push(item);
            this.emit({ type: "timeline", provider: KIMI_PROVIDER_ID, item, turnId });
          }
        } catch {
          const fallback = translateKimiNonJsonLine(line);
          if (!fallback) {
            continue;
          }
          timeline.push(fallback);
          this.emit({ type: "timeline", provider: KIMI_PROVIDER_ID, item: fallback, turnId });
        }
      }
    })();

    const stderrTask = (async () => {
      const reader = createInterface({ input: processHandle.stderr });
      const chunks: string[] = [];
      for await (const line of reader) {
        chunks.push(line);
      }
      return chunks.join("\n");
    })();

    const exitCode = await new Promise<number>((resolve, reject) => {
      processHandle.once("error", reject);
      processHandle.once("close", (code) => resolve(code ?? 0));
    });

    const stderr = await stderrTask;
    await stdoutTask;

    this.currentProcess = null;

    const extractedSessionId = extractKimiSessionId(stderr);
    if (extractedSessionId) {
      this.currentSessionId = extractedSessionId;
    }

    if (usage) {
      this.emit({ type: "usage_updated", provider: KIMI_PROVIDER_ID, usage, turnId });
    }

    if (this.interruptedTurnId === turnId) {
      this.interruptedTurnId = null;
      this.emit({ type: "turn_canceled", provider: KIMI_PROVIDER_ID, reason: "interrupted", turnId });
      this.emit({
        type: "attention_required",
        provider: KIMI_PROVIDER_ID,
        reason: "error",
        timestamp: new Date().toISOString(),
      });
      return {
        turnId,
        result: {
          sessionId: this.currentSessionId ?? turnId,
          finalText: timeline
            .filter((item): item is Extract<AgentTimelineItem, { type: "assistant_message" }> => item.type === "assistant_message")
            .map((item) => item.text)
            .join("\n\n"),
          usage,
          timeline,
          canceled: true,
        },
      };
    }

    if (exitCode !== 0) {
      const errorMessage = stderr.trim() || `Kimi exited with code ${exitCode}`;
      const item: AgentTimelineItem = { type: "error", message: errorMessage };
      timeline.push(item);
      this.emit({ type: "timeline", provider: KIMI_PROVIDER_ID, item, turnId });
      this.emit({
        type: "turn_failed",
        provider: KIMI_PROVIDER_ID,
        error: errorMessage,
        turnId,
      });
      this.emit({
        type: "attention_required",
        provider: KIMI_PROVIDER_ID,
        reason: "error",
        timestamp: new Date().toISOString(),
      });
      throw new Error(errorMessage);
    }

    this.emit({ type: "turn_completed", provider: KIMI_PROVIDER_ID, usage, turnId });
    this.emit({
      type: "attention_required",
      provider: KIMI_PROVIDER_ID,
      reason: "finished",
      timestamp: new Date().toISOString(),
    });

    return {
      turnId,
      result: {
        sessionId: this.currentSessionId ?? turnId,
        finalText: timeline
          .filter((item): item is Extract<AgentTimelineItem, { type: "assistant_message" }> => item.type === "assistant_message")
          .map((item) => item.text)
          .join("\n\n"),
        usage,
        timeline,
      },
    };
  }

  private emit(event: AgentStreamEvent): void {
    this.eventHistory.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}