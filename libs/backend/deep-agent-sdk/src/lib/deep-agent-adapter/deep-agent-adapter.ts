/**
 * DeepAgentAdapter — IAgentAdapter implementation backed by LangChain's
 * `deepagents` package. Runs in-process with NO CLI subprocess.
 *
 * End-to-end flow for startChatSession:
 *   1. Resolve the active OpenAI-compat provider (Ollama, LM Studio, etc.)
 *   2. Build a ChatOpenAI via ModelFactoryService
 *   3. createDeepAgent({ llm, tools, instructions, checkpointer })
 *   4. graph.stream({messages:[HumanMessage]}, {streamMode:'messages'})
 *   5. StreamAdapter.transform(stream) → FlatStreamEventUnion
 *
 * Slash commands / worktree / compaction are NOT supported — they are
 * Claude-SDK-specific. Attempts throw a clear error so the RPC layer can
 * surface "switch runtime" messaging.
 */

import { injectable, inject } from 'tsyringe';
import { createDeepAgent } from 'deepagents';
import { MemorySaver } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import type {
  IAgentAdapter,
  AgentModelInfo,
  AgentPermissionLevel,
  AgentSessionStartConfig,
  AgentSessionResumeConfig,
  SlashCommandRunConfig,
  SessionIdResolvedCallback,
  ResultStatsCallback,
  CompactionStartCallback,
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
  FlatStreamEventUnion,
  ProviderId,
  ProviderInfo,
  ProviderHealth,
  ProviderStatus,
  ProviderCapabilities,
  SessionId,
  AIMessageOptions,
} from '@ptah-extension/shared';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import {
  type AnthropicProviderId,
  ModelResolver,
  OllamaModelDiscoveryService,
  SDK_TOKENS,
} from '@ptah-extension/agent-sdk';
import { DEEP_AGENT_TOKENS } from '../di/tokens';
import { ModelFactoryService } from '../model-factory/model-factory.service';
import {
  SessionRegistry,
  type DeepAgentSession,
} from '../session-registry/session-registry.service';
import { StreamAdapterService } from '../stream-adapter/stream-adapter.service';
import { ToolBridgeService } from '../tool-bridge/tool-bridge.service';

const DEEP_AGENT_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  fileAttachments: true,
  contextManagement: true,
  sessionPersistence: false,
  multiTurn: true,
  codeGeneration: true,
  imageAnalysis: false,
  functionCalling: true,
};

const DEEP_AGENT_PROVIDER_INFO: ProviderInfo = {
  id: 'ptah-cli' as ProviderId,
  name: 'Ptah Deep Agent (LangChain)',
  version: '0.1.0',
  description:
    'Multi-provider agent runtime powered by LangChain deepagents (in-process, no CLI)',
  vendor: 'LangChain + Ptah',
  capabilities: DEEP_AGENT_CAPABILITIES,
  maxContextTokens: 200_000,
  supportedModels: [],
};

const SLASH_COMMAND_UNSUPPORTED_MSG =
  'Slash commands require the Claude SDK runtime. Set ptah.runtime to claude-sdk in settings.';

const RESUME_UNSUPPORTED_MSG =
  'Session resume (from JSONL history) requires the Claude SDK runtime. ' +
  'On deep-agent the LangGraph MemorySaver keeps context in-process only. ' +
  'Set ptah.runtime to claude-sdk to resume past Claude SDK sessions.';

const DEFAULT_INSTRUCTIONS =
  'You are Ptah, an AI coding assistant running inside VS Code. ' +
  'Help the user with code, explanations, and development tasks. ' +
  'Prefer concise, accurate answers. When using tools, keep the user informed.';

/**
 * Minimal structural view of deepagents' compiled graph — just the
 * `stream` method we actually use. Avoids dragging the full LangGraph
 * ReactAgent types into this file's public surface.
 */
interface StreamableGraph {
  stream(
    input: { messages: unknown[] },
    options: {
      configurable?: { thread_id: string };
      signal?: AbortSignal;
      streamMode?: 'messages' | string;
    },
  ): Promise<AsyncIterable<unknown>>;
}

@injectable()
export class DeepAgentAdapter implements IAgentAdapter {
  readonly providerId: ProviderId = 'ptah-cli' as ProviderId;
  readonly info: ProviderInfo = DEEP_AGENT_PROVIDER_INFO;

  private initialized = false;
  private health: ProviderHealth = {
    status: 'initializing' as ProviderStatus,
    lastCheck: Date.now(),
  };

  private sessionIdResolvedCallback: SessionIdResolvedCallback | null = null;
  private resultStatsCallback: ResultStatsCallback | null = null;
  private compactionStartCallback: CompactionStartCallback | null = null;
  private worktreeCreatedCallback: WorktreeCreatedCallback | null = null;
  private worktreeRemovedCallback: WorktreeRemovedCallback | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private readonly config: ConfigManager,
    @inject(DEEP_AGENT_TOKENS.MODEL_FACTORY)
    private readonly modelFactory: ModelFactoryService,
    @inject(DEEP_AGENT_TOKENS.SESSION_REGISTRY)
    private readonly sessionRegistry: SessionRegistry,
    @inject(DEEP_AGENT_TOKENS.STREAM_ADAPTER)
    private readonly streamAdapter: StreamAdapterService,
    @inject(DEEP_AGENT_TOKENS.TOOL_BRIDGE)
    private readonly toolBridge: ToolBridgeService,
    @inject(SDK_TOKENS.SDK_OLLAMA_DISCOVERY)
    private readonly ollamaDiscovery: OllamaModelDiscoveryService,
    @inject(SDK_TOKENS.SDK_MODEL_RESOLVER)
    private readonly modelResolver: ModelResolver,
  ) {}

  async preloadSdk(): Promise<void> {
    return;
  }

  async initialize(): Promise<boolean> {
    this.logger.info('[DeepAgentAdapter] Initializing...');
    this.initialized = true;
    this.health = {
      status: 'available' as ProviderStatus,
      lastCheck: Date.now(),
      responseTime: 0,
      uptime: Date.now(),
    };
    this.logger.info('[DeepAgentAdapter] Initialized');
    return true;
  }

  dispose(): void {
    this.logger.info('[DeepAgentAdapter] Disposing...');
    this.sessionRegistry.clear();
    this.initialized = false;
  }

  async verifyInstallation(): Promise<boolean> {
    return true;
  }

  getHealth(): ProviderHealth {
    return { ...this.health };
  }

  getCliJsPath(): string | null {
    return null;
  }

  /**
   * Return the supported models for the currently active provider.
   * Ollama gets dynamic discovery via /api/tags; other providers return
   * an empty list in Phase 1 (the user enters a model name manually).
   */
  async getSupportedModels(): Promise<readonly AgentModelInfo[]> {
    const providerId = this.resolveActiveProvider();
    if (providerId === 'ollama') {
      try {
        const models = await this.ollamaDiscovery.listLocalModels();
        return models.map((m) => ({
          value: m.id,
          displayName: m.name,
          description: m.description,
        }));
      } catch (err) {
        this.logger.warn(
          '[DeepAgentAdapter] Ollama discovery failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        return [];
      }
    }
    if (providerId === 'ollama-cloud') {
      try {
        const models = await this.ollamaDiscovery.listCloudModels();
        return models.map((m) => ({
          value: m.id,
          displayName: m.name,
          description: m.description,
        }));
      } catch (err) {
        this.logger.warn(
          '[DeepAgentAdapter] Ollama cloud discovery failed',
          err instanceof Error ? err : new Error(String(err)),
        );
        return [];
      }
    }
    return [];
  }

  async getDefaultModel(): Promise<string> {
    const saved = this.config.get<string>('model.selected');
    if (saved && saved !== 'default') return saved;
    const models = await this.getSupportedModels();
    return models[0]?.value ?? 'default';
  }

  async getApiModels(): Promise<readonly AgentModelInfo[]> {
    return this.getSupportedModels();
  }

  async reset(): Promise<void> {
    this.dispose();
    await this.initialize();
  }

  async startChatSession(
    config: AgentSessionStartConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.initialized) {
      throw new Error(
        'DeepAgentAdapter not initialized. Call initialize() first.',
      );
    }

    const providerId = this.resolveActiveProvider();
    const rawModel =
      config.model ?? (await this.getDefaultModel()) ?? 'default';
    const modelId = await this.resolveModelForProvider(rawModel, providerId);
    const prompt = config.prompt ?? '';
    const tabId = config.tabId;
    const trackingId = tabId as SessionId;

    this.logger.info('[DeepAgentAdapter] Starting deep-agent session', {
      tabId,
      providerId,
      rawModel,
      resolvedModel: modelId,
    });

    const llm = await this.modelFactory.createChatModel(providerId, modelId);
    const tools = await this.toolBridge.getTools();
    const abortController = new AbortController();
    const instructions = config.enhancedPromptsContent ?? DEFAULT_INSTRUCTIONS;

    const agent = createDeepAgent({
      model: llm,
      // `tools` in Phase 1 is empty — deepagents' built-ins take over.
      // Casting is unavoidable here because deepagents' tools generic is
      // a deep inference union; we deliberately pass [] which satisfies
      // the base constraint at runtime.
      tools: tools as never,
      systemPrompt: instructions,
      checkpointer: new MemorySaver(),
    });

    const threadId = String(trackingId);
    const session: DeepAgentSession = {
      tabId,
      sessionId: trackingId,
      threadId,
      graph: agent,
      abortController,
      startedAt: Date.now(),
      providerId,
      model: modelId,
    };
    this.sessionRegistry.register(session);

    // Notify the ID-resolved sink with our synthetic session ID. The
    // deep-agent runtime has no external UUID — tabId doubles as it.
    if (this.sessionIdResolvedCallback) {
      try {
        this.sessionIdResolvedCallback(tabId, threadId);
      } catch (err) {
        this.logger.warn(
          '[DeepAgentAdapter] sessionIdResolvedCallback threw',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    const streamable = agent as unknown as StreamableGraph;
    const rawStream = await streamable.stream(
      { messages: [new HumanMessage(prompt)] },
      {
        configurable: { thread_id: threadId },
        signal: abortController.signal,
        streamMode: 'messages',
      },
    );

    return this.streamAdapter.transform(
      {
        stream: rawStream,
        sessionId: trackingId,
        tabId,
        abortSignal: abortController.signal,
        model: modelId,
      },
      (payload) => {
        if (this.resultStatsCallback) {
          try {
            this.resultStatsCallback({
              sessionId: payload.sessionId,
              cost: 0,
              tokens: { input: 0, output: 0 },
              duration: payload.durationMs,
            });
          } catch (err) {
            this.logger.warn(
              '[DeepAgentAdapter] resultStatsCallback threw',
              err instanceof Error ? err : new Error(String(err)),
            );
          }
        }
      },
    );
  }

  endSession(sessionId: SessionId): void {
    const session = this.sessionRegistry.get(sessionId);
    if (session) {
      try {
        session.abortController.abort();
      } catch (err) {
        this.logger.warn(
          '[DeepAgentAdapter] Error aborting session',
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      this.sessionRegistry.remove(sessionId);
    }
  }

  async sendMessageToSession(
    sessionId: SessionId,
    content: string,
    _options?: AIMessageOptions,
  ): Promise<void> {
    const session = this.sessionRegistry.get(sessionId);
    if (!session) {
      throw new Error(
        `[DeepAgentAdapter] No active session for ${String(sessionId)}`,
      );
    }
    // deepagents follow-on turns are driven by re-streaming with the same
    // thread_id; the MemorySaver re-hydrates context. For parity with the
    // SDK's "append-to-live-session" model we'd need a persistent queue —
    // Phase 2. For now, kick a new stream and drain it in the background.
    const graph = session.graph as unknown as StreamableGraph;
    const stream = await graph.stream(
      { messages: [new HumanMessage(content)] },
      {
        configurable: { thread_id: session.threadId },
        signal: session.abortController.signal,
        streamMode: 'messages',
      },
    );
    // Drain to keep the checkpointer in sync. Caller doesn't get events
    // from this helper — full streaming turns go through startChatSession.
    for await (const _ of this.streamAdapter.transform({
      stream,
      sessionId,
      abortSignal: session.abortController.signal,
      model: session.model,
    })) {
      // discard
      void _;
    }
  }

  async resumeSession(
    _sessionId: SessionId,
    _config?: AgentSessionResumeConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    throw new Error(RESUME_UNSUPPORTED_MSG);
  }

  isSessionActive(sessionId: SessionId): boolean {
    return this.sessionRegistry.has(sessionId);
  }

  async executeSlashCommand(
    _sessionId: SessionId,
    _command: string,
    _config: SlashCommandRunConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    throw new Error(SLASH_COMMAND_UNSUPPORTED_MSG);
  }

  async interruptCurrentTurn(sessionId: SessionId): Promise<boolean> {
    const session = this.sessionRegistry.get(sessionId);
    if (!session) return false;
    try {
      session.abortController.abort();
      return true;
    } catch (err) {
      this.logger.warn(
        '[DeepAgentAdapter] interruptCurrentTurn failed',
        err instanceof Error ? err : new Error(String(err)),
      );
      return false;
    }
  }

  async interruptSession(sessionId: SessionId): Promise<void> {
    this.endSession(sessionId);
  }

  async setSessionPermissionLevel(
    _sessionId: SessionId,
    _level: AgentPermissionLevel,
  ): Promise<void> {
    this.logger.info(
      '[DeepAgentAdapter] setSessionPermissionLevel is a no-op on deep-agent runtime',
    );
  }

  async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
    this.logger.info(
      `[DeepAgentAdapter] setSessionModel: ${String(sessionId)} -> ${model} ` +
        '(applied to new sessions only; existing graph keeps its model)',
    );
  }

  setSessionIdResolvedCallback(cb: SessionIdResolvedCallback): void {
    this.sessionIdResolvedCallback = cb;
  }
  setResultStatsCallback(cb: ResultStatsCallback): void {
    this.resultStatsCallback = cb;
  }
  setCompactionStartCallback(cb: CompactionStartCallback): void {
    this.compactionStartCallback = cb;
    // Compaction is a Claude SDK concept — we silently accept the
    // callback so the selector can forward to both adapters without
    // error, but we never invoke it.
    void this.compactionStartCallback;
  }
  setWorktreeCreatedCallback(cb: WorktreeCreatedCallback): void {
    this.worktreeCreatedCallback = cb;
    void this.worktreeCreatedCallback;
  }
  setWorktreeRemovedCallback(cb: WorktreeRemovedCallback): void {
    this.worktreeRemovedCallback = cb;
    void this.worktreeRemovedCallback;
  }

  // ---------------- private helpers ----------------

  /**
   * Resolve the model ID for the active provider.
   *
   * Uses the SDK's ModelResolver (reads ANTHROPIC_DEFAULT_*_MODEL env vars
   * set by AuthManager). If the resolved model is a Claude model ID but the
   * provider isn't Anthropic, falls back to model discovery.
   */
  private async resolveModelForProvider(
    rawModel: string,
    providerId: AnthropicProviderId,
  ): Promise<string> {
    const resolved = this.modelResolver.resolve(rawModel);

    if (!resolved.startsWith('claude-')) {
      return resolved;
    }

    // ModelResolver returned a Claude model ID — won't work on non-Anthropic providers.
    const models = await this.getSupportedModels();
    if (models.length > 0) {
      this.logger.info(
        `[DeepAgentAdapter] '${rawModel}' resolved to Claude model '${resolved}', ` +
          `using discovered model instead: ${models[0].value}`,
      );
      return models[0].value;
    }

    this.logger.warn(
      `[DeepAgentAdapter] No model discovery for ${providerId}, ` +
        `using '${resolved}' — may fail if provider doesn't support Claude model names`,
    );
    return resolved;
  }

  /**
   * Read the active provider ID from config.
   *
   * Uses the same `anthropicProviderId` config key that AuthManager reads.
   * The runtime selector already guarantees this adapter is only called for
   * non-Claude-native providers, so `anthropicProviderId` is always set.
   */
  private resolveActiveProvider(): AnthropicProviderId {
    const providerId =
      this.config.get<string>('anthropicProviderId') ?? 'ollama';

    this.logger.info(`[DeepAgentAdapter] Resolved provider: ${providerId}`);

    return providerId as AnthropicProviderId;
  }
}
