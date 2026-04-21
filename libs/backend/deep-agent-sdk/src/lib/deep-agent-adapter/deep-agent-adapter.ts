/**
 * DeepAgentAdapter — IAgentAdapter implementation backed by LangChain's
 * `deepagents` package. Runs in-process with NO CLI subprocess.
 *
 * Full feature parity with SdkAgentAdapter:
 *   - System prompts (identity + PTAH_CORE + enhanced + user custom)
 *   - Plugin skills passed to createDeepAgent({ skills })
 *   - MCP tools bridged via ToolBridgeService (IToolRegistry → StructuredTools)
 *   - FilesystemBackend for workspace file access
 *   - CLAUDE.md / AGENTS.md memory paths
 *   - Persistent sessions via JsonFileCheckpointer (JSON files in workspace)
 *   - Session resume via checkpointer thread_id lookup
 *   - Permission level → interruptOn mapping
 *
 * Slash commands / worktree / compaction are NOT supported — they are
 * Claude-SDK-specific. Attempts throw a clear error so the RPC layer can
 * surface "switch runtime" messaging.
 */

import { injectable, inject } from 'tsyringe';
import { createDeepAgent, FilesystemBackend } from 'deepagents';
import { HumanMessage } from '@langchain/core/messages';
import { existsSync } from 'fs';
import { join } from 'path';
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
  AuthEnv,
} from '@ptah-extension/shared';
import { Logger, TOKENS, ConfigManager } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import type {
  AgentDiscoveryService,
  AgentInfo,
} from '@ptah-extension/workspace-intelligence';
import {
  type AnthropicProviderId,
  ModelResolver,
  OllamaModelDiscoveryService,
  PluginLoaderService,
  SessionMetadataStore,
  assembleSystemPrompt,
  discoverPluginSkills,
  PTAH_MCP_PORT,
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
import { JsonFileCheckpointer } from '../checkpointer/json-file-checkpointer';
import { PTAH_SUBAGENTS } from '../subagents/subagent-definitions';

const DEEP_AGENT_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  fileAttachments: true,
  contextManagement: true,
  sessionPersistence: true,
  multiTurn: true,
  codeGeneration: true,
  imageAnalysis: false,
  functionCalling: true,
};

const DEEP_AGENT_PROVIDER_INFO: ProviderInfo = {
  id: 'ptah-cli' as ProviderId,
  name: 'Ptah Deep Agent (LangChain)',
  version: '0.2.0',
  description:
    'Multi-provider agent runtime powered by LangChain deepagents (in-process, no CLI)',
  vendor: 'LangChain + Ptah',
  capabilities: DEEP_AGENT_CAPABILITIES,
  maxContextTokens: 200_000,
  supportedModels: [],
};

const SLASH_COMMAND_UNSUPPORTED_MSG =
  'Slash commands require the Claude SDK runtime. Set ptah.runtime to claude-sdk in settings.';

const DEFAULT_INSTRUCTIONS =
  'You are Ptah, an AI coding assistant running inside VS Code. ' +
  'Help the user with code, explanations, and development tasks. ' +
  'Prefer concise, accurate answers. When using tools, keep the user informed.';

const CHECKPOINTER_DIR_NAME = '.ptah/deep-agent-sessions';

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
  private checkpointer: JsonFileCheckpointer | null = null;
  private currentPermissionLevel: AgentPermissionLevel = 'ask';

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
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private readonly authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadataStore: SessionMetadataStore,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.AGENT_DISCOVERY_SERVICE)
    private readonly agentDiscovery: AgentDiscoveryService,
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
        const error = err instanceof Error ? err : new Error(String(err));
        this.sentryService.captureException(error, {
          errorSource: 'DeepAgentAdapter.getSupportedModels',
        });
        this.logger.warn('[DeepAgentAdapter] Ollama discovery failed', error);
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
        const error = err instanceof Error ? err : new Error(String(err));
        this.sentryService.captureException(error, {
          errorSource: 'DeepAgentAdapter.getSupportedModels',
        });
        this.logger.warn(
          '[DeepAgentAdapter] Ollama cloud discovery failed',
          error,
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
      isPremium: config.isPremium,
      hasPluginPaths: !!(config.pluginPaths && config.pluginPaths.length > 0),
      hasEnhancedPrompts: !!config.enhancedPromptsContent,
    });

    const llm = await this.modelFactory.createChatModel(providerId, modelId);
    const abortController = new AbortController();

    // Load MCP tools from the Ptah HTTP MCP server (if running)
    if (config.isPremium && config.mcpServerRunning !== false) {
      const mcpUrl = `http://localhost:${PTAH_MCP_PORT}`;
      await this.toolBridge.loadMcpTools(mcpUrl);
    }
    const tools = await this.toolBridge.getTools();

    const systemPrompt = this.buildSystemPrompt(config, providerId);
    const skillPaths = this.resolveSkillPaths(config.pluginPaths);
    const memoryPaths = this.resolveMemoryPaths(config);
    const backend = this.createBackend(config);
    const checkpointer = this.getOrCreateCheckpointer(config);
    const interruptOn = this.mapPermissionToInterrupt();

    // Subagents: prefer .claude/agents/*.md from the workspace (parity with
    // the Claude SDK runtime) and fall back to PTAH_SUBAGENTS if the user
    // has no agent files configured. Subagents inherit parent model/tools
    // via deepagents — do NOT inject the shared `llm` instance here, as
    // sharing one ChatModel across the parent graph and every concurrent
    // subagent creates re-entrance conflicts when `task` runs in parallel
    // with other tool_calls.
    const subagents = await this.resolveSubagents();

    this.logger.info('[DeepAgentAdapter] createDeepAgent params', {
      hasSystemPrompt: !!systemPrompt,
      systemPromptLength: systemPrompt?.length ?? 0,
      toolCount: tools.length,
      skillPathCount: skillPaths.length,
      memoryPathCount: memoryPaths.length,
      subagentCount: subagents.length,
      hasBackend: !!backend,
      hasCheckpointer: !!checkpointer,
      interruptOnKeys: Object.keys(interruptOn),
    });

    const agent = createDeepAgent({
      model: llm,
      tools: tools as never,
      systemPrompt: systemPrompt ?? DEFAULT_INSTRUCTIONS,
      checkpointer: checkpointer ?? true,
      backend: backend ?? undefined,
      skills: skillPaths.length > 0 ? skillPaths : undefined,
      memory: memoryPaths.length > 0 ? memoryPaths : undefined,
      subagents: subagents as never,
      interruptOn:
        Object.keys(interruptOn).length > 0 ? interruptOn : undefined,
      name: 'ptah-deep-agent',
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
      streamCompleted: false,
      resumeConsumedPrompt: false,
    };
    this.sessionRegistry.register(session);

    // Register in SessionMetadataStore so session appears in sidebar
    const workspaceId = config.projectPath ?? config.workspaceId ?? '';
    if (workspaceId) {
      const sessionName = config.name ?? `Deep Agent — ${modelId}`;
      this.metadataStore
        .create(threadId, workspaceId, sessionName)
        .catch((err) =>
          this.logger.warn(
            '[DeepAgentAdapter] Failed to save session metadata',
            err instanceof Error ? err : new Error(String(err)),
          ),
        );
    }

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
        // Mark stream as naturally completed so endSession() skips abort().
        // Without this guard, abort() fires after Pregel's graph has already
        // resolved, causing an async rejection via processTicksAndRejections.
        const completedSession = this.sessionRegistry.get(trackingId);
        if (completedSession) {
          completedSession.streamCompleted = true;
        }

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
      if (!session.streamCompleted) {
        try {
          session.abortController.abort();
        } catch (err) {
          this.logger.warn(
            '[DeepAgentAdapter] Error aborting session',
            err instanceof Error ? err : new Error(String(err)),
          );
        }
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

    // resumeSession() already sent the prompt as part of the LangGraph stream.
    // The caller (chat-rpc.handlers) still calls sendMessageToSession() for
    // Claude SDK compat, but for deep-agent that would duplicate the send and
    // silently discard the response. Skip and reset the flag.
    if (session.resumeConsumedPrompt) {
      session.resumeConsumedPrompt = false;
      return;
    }

    const graph = session.graph as unknown as StreamableGraph;
    const stream = await graph.stream(
      { messages: [new HumanMessage(content)] },
      {
        configurable: { thread_id: session.threadId },
        signal: session.abortController.signal,
        streamMode: 'messages',
      },
    );
    for await (const _ of this.streamAdapter.transform({
      stream,
      sessionId,
      abortSignal: session.abortController.signal,
      model: session.model,
    })) {
      void _;
    }
  }

  async resumeSession(
    sessionId: SessionId,
    config?: AgentSessionResumeConfig,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    if (!this.checkpointer) {
      throw new Error(
        'Session resume requires a persistent checkpointer. ' +
          'No workspace path was available to create one.',
      );
    }

    const threadId = String(sessionId);
    const tuple = await this.checkpointer.getTuple({
      configurable: { thread_id: threadId },
    });

    if (!tuple) {
      throw new Error(
        `[DeepAgentAdapter] No persisted session found for thread '${threadId}'. ` +
          'The session may have been created with in-memory checkpointing only.',
      );
    }

    this.logger.info('[DeepAgentAdapter] Resuming session from checkpoint', {
      threadId,
      checkpointId: tuple.checkpoint.id,
    });

    const providerId = this.resolveActiveProvider();
    const rawModel =
      config?.model ?? (await this.getDefaultModel()) ?? 'default';
    const modelId = await this.resolveModelForProvider(rawModel, providerId);
    const llm = await this.modelFactory.createChatModel(providerId, modelId);
    const tools = await this.toolBridge.getTools();
    const abortController = new AbortController();

    const systemPrompt = config
      ? this.buildSystemPrompt(
          {
            isPremium: config.isPremium,
            enhancedPromptsContent: config.enhancedPromptsContent,
            pluginPaths: config.pluginPaths,
            systemPrompt: config.systemPrompt,
          } as AgentSessionStartConfig,
          providerId,
        )
      : DEFAULT_INSTRUCTIONS;

    const skillPaths = this.resolveSkillPaths(config?.pluginPaths);
    const memoryPaths = this.resolveMemoryPaths(config);

    const agent = createDeepAgent({
      model: llm,
      tools: tools as never,
      systemPrompt: systemPrompt ?? DEFAULT_INSTRUCTIONS,
      checkpointer: this.checkpointer,
      skills: skillPaths.length > 0 ? skillPaths : undefined,
      memory: memoryPaths.length > 0 ? memoryPaths : undefined,
      name: 'ptah-deep-agent',
    });

    const trackingId = sessionId;
    const promptProvided = !!config?.prompt;
    const session: DeepAgentSession = {
      tabId: config?.tabId ?? threadId,
      sessionId: trackingId,
      threadId,
      graph: agent,
      abortController,
      startedAt: Date.now(),
      providerId,
      model: modelId,
      streamCompleted: false,
      // When a prompt is included in the resume stream, sendMessageToSession()
      // must skip the duplicate send to prevent the response being silently dropped.
      resumeConsumedPrompt: promptProvided,
    };
    this.sessionRegistry.register(session);

    if (this.sessionIdResolvedCallback) {
      try {
        this.sessionIdResolvedCallback(session.tabId, threadId);
      } catch (err) {
        this.sentryService.captureException(
          err instanceof Error ? err : new Error(String(err)),
          {
            errorSource:
              'DeepAgentAdapter.resumeSession.sessionIdResolvedCallback',
          },
        );
      }
    }

    // Stream with existing thread_id to resume from checkpoint.
    // Include the new user prompt in messages so LangGraph processes the new
    // turn — without it, the model would re-generate based on the checkpoint
    // state alone, ignoring the user's actual new message.
    const streamable = agent as unknown as StreamableGraph;
    const resumeMessages = config?.prompt
      ? [new HumanMessage(config.prompt)]
      : [];
    const rawStream = await streamable.stream(
      { messages: resumeMessages },
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
        tabId: session.tabId,
        abortSignal: abortController.signal,
        model: modelId,
      },
      (payload) => {
        const completedSession = this.sessionRegistry.get(trackingId);
        if (completedSession) {
          completedSession.streamCompleted = true;
        }

        if (this.resultStatsCallback) {
          try {
            this.resultStatsCallback({
              sessionId: payload.sessionId,
              cost: 0,
              tokens: { input: 0, output: 0 },
              duration: payload.durationMs,
            });
          } catch (err) {
            this.sentryService.captureException(
              err instanceof Error ? err : new Error(String(err)),
              {
                errorSource:
                  'DeepAgentAdapter.resumeSession.resultStatsCallback',
              },
            );
          }
        }
      },
    );
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
      const error = err instanceof Error ? err : new Error(String(err));
      this.sentryService.captureException(error, {
        errorSource: 'DeepAgentAdapter.interruptCurrentTurn',
      });
      this.logger.warn('[DeepAgentAdapter] interruptCurrentTurn failed', error);
      return false;
    }
  }

  async interruptSession(sessionId: SessionId): Promise<void> {
    this.endSession(sessionId);
  }

  async setSessionPermissionLevel(
    _sessionId: SessionId,
    level: AgentPermissionLevel,
  ): Promise<void> {
    this.currentPermissionLevel = level;
    this.logger.info(
      `[DeepAgentAdapter] Permission level set to '${level}' (applied to new sessions)`,
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

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Build the full system prompt using the same assembleSystemPrompt()
   * function that the Claude SDK adapter uses. The deep agent receives
   * the assembled content directly as its systemPrompt parameter
   * (no SDK preset — deepagents has its own base prompt).
   */
  private buildSystemPrompt(
    config: Partial<AgentSessionStartConfig>,
    providerId: AnthropicProviderId,
  ): string | null {
    const result = assembleSystemPrompt({
      providerId,
      authEnv: this.authEnv,
      userSystemPrompt: config.systemPrompt,
      isPremium: config.isPremium ?? false,
      mcpServerRunning: config.mcpServerRunning ?? false,
      enhancedPromptsContent: config.enhancedPromptsContent,
    });

    if (!result.content) return null;

    // Prepend discovered skill info so the model knows what's available
    const pluginPaths = config.pluginPaths ?? [];
    if (pluginPaths.length > 0) {
      const skills = discoverPluginSkills(pluginPaths);
      if (skills.length > 0) {
        const skillList = skills
          .map(
            (s) =>
              `- **${s.skillName}** (plugin: ${s.pluginId}): ${s.description}`,
          )
          .join('\n');
        return `${result.content}\n\n## Available Skills\n\n${skillList}`;
      }
    }

    return result.content;
  }

  /**
   * Resolve plugin paths to skill directory paths for deepagents.
   * Each plugin's skills/ directory is passed so deepagents can
   * discover and load SKILL.md files via its native skill system.
   */
  /**
   * Discover subagents from `.claude/agents/*.md` (project + user scope),
   * mapped to deepagents' SubAgent shape. Falls back to the built-in
   * `PTAH_SUBAGENTS` list if the workspace has no agent files so the
   * `task` tool always has specialists to delegate to.
   *
   * Built-in AgentDiscovery entries are Claude-Code-specific (Explore,
   * Plan, etc.) and are filtered out — deepagents doesn't share those
   * internal tools.
   */
  private async resolveSubagents(): Promise<
    Array<{ name: string; description: string; systemPrompt: string }>
  > {
    try {
      const result = await this.agentDiscovery.discoverAgents();
      const discovered = (result.agents ?? []).filter(
        (a: AgentInfo) => a.scope !== 'builtin' && a.prompt.trim().length > 0,
      );

      if (discovered.length === 0) {
        this.logger.info(
          '[DeepAgentAdapter] No .claude/agents/*.md found — using built-in PTAH_SUBAGENTS',
          { builtinCount: PTAH_SUBAGENTS.length },
        );
        return [...PTAH_SUBAGENTS];
      }

      this.logger.info(
        '[DeepAgentAdapter] Loaded subagents from .claude/agents',
        {
          projectCount: discovered.filter((a) => a.scope === 'project').length,
          userCount: discovered.filter((a) => a.scope === 'user').length,
        },
      );

      return discovered.map((a) => ({
        name: a.name,
        description: a.description,
        systemPrompt: a.prompt,
      }));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.sentryService.captureException(error, {
        errorSource: 'DeepAgentAdapter.resolveSubagents',
      });
      this.logger.warn(
        '[DeepAgentAdapter] Agent discovery failed — falling back to PTAH_SUBAGENTS',
        error,
      );
      return [...PTAH_SUBAGENTS];
    }
  }

  private resolveSkillPaths(pluginPaths?: string[]): string[] {
    const paths = pluginPaths ?? [];
    if (paths.length === 0) {
      try {
        const resolved = this.pluginLoader.resolveCurrentPluginPaths();
        return resolved.map((p) => join(p, 'skills'));
      } catch {
        return [];
      }
    }
    return paths.map((p) => join(p, 'skills')).filter((p) => existsSync(p));
  }

  /**
   * Resolve memory file paths (CLAUDE.md, AGENTS.md) for deepagents.
   * These are loaded at agent startup and injected into the system prompt.
   */
  private resolveMemoryPaths(
    config?: Partial<AgentSessionStartConfig | AgentSessionResumeConfig>,
  ): string[] {
    const paths: string[] = [];
    const projectPath = config?.projectPath;

    if (projectPath) {
      const claudeMd = join(projectPath, 'CLAUDE.md');
      if (existsSync(claudeMd)) paths.push(claudeMd);

      const agentsMd = join(projectPath, '.deepagents', 'AGENTS.md');
      if (existsSync(agentsMd)) paths.push(agentsMd);

      const ptahAgentsMd = join(projectPath, '.ptah', 'AGENTS.md');
      if (existsSync(ptahAgentsMd)) paths.push(ptahAgentsMd);
    }

    // Global agents memory
    const homeDir = process.env['USERPROFILE'] || process.env['HOME'] || '';
    if (homeDir) {
      const globalAgents = join(homeDir, '.deepagents', 'AGENTS.md');
      if (existsSync(globalAgents)) paths.push(globalAgents);

      const ptahGlobalAgents = join(homeDir, '.ptah', 'AGENTS.md');
      if (existsSync(ptahGlobalAgents)) paths.push(ptahGlobalAgents);
    }

    return paths;
  }

  /**
   * Create a FilesystemBackend rooted at the workspace path.
   * Gives deepagents native file read/write/edit/grep/glob capabilities.
   */
  private createBackend(
    config: Partial<AgentSessionStartConfig>,
  ): FilesystemBackend | null {
    const projectPath = config.projectPath;
    if (!projectPath) {
      this.logger.warn(
        '[DeepAgentAdapter] No projectPath — FilesystemBackend disabled',
      );
      return null;
    }
    return new FilesystemBackend({ rootDir: projectPath });
  }

  /**
   * Get or create a persistent checkpointer for the workspace.
   * Stores session state as JSON files in {workspace}/.ptah/deep-agent-sessions/
   */
  private getOrCreateCheckpointer(
    config: Partial<AgentSessionStartConfig>,
  ): JsonFileCheckpointer | null {
    const projectPath = config.projectPath;
    if (!projectPath) {
      this.logger.warn(
        '[DeepAgentAdapter] No projectPath — using in-memory checkpointing only',
      );
      return null;
    }

    if (!this.checkpointer) {
      const checkpointDir = join(projectPath, CHECKPOINTER_DIR_NAME);
      this.checkpointer = new JsonFileCheckpointer(checkpointDir);
      this.logger.info('[DeepAgentAdapter] Created JsonFileCheckpointer', {
        dir: checkpointDir,
      });
    }
    return this.checkpointer;
  }

  /**
   * Map the current permission level to deepagents' interruptOn config.
   *
   * - 'ask' (default): interrupt on all tool calls for user approval
   * - 'auto-edit': interrupt only on destructive operations
   * - 'yolo'/'bypassPermissions': no interrupts
   */
  private mapPermissionToInterrupt(): Record<string, boolean> {
    switch (this.currentPermissionLevel) {
      case 'ask':
      case 'plan':
      case 'default':
        return {
          write_file: true,
          edit_file: true,
          execute: true,
          bash: true,
        };
      case 'auto-edit':
      case 'acceptEdits':
        return {
          execute: true,
          bash: true,
        };
      case 'yolo':
      case 'bypassPermissions':
        return {};
      default:
        return {};
    }
  }

  private async resolveModelForProvider(
    rawModel: string,
    providerId: AnthropicProviderId,
  ): Promise<string> {
    // Strip Claude SDK context-window suffixes (e.g. 'sonnet[1m]' → 'sonnet').
    // ModelResolver only recognises bare tier names; the bracket suffix causes
    // it to fall through to the "unknown model" pass-through branch, sending an
    // invalid model name to Ollama/third-party providers.
    const baseTier = rawModel.replace(/\[.*\]$/, '');
    const resolved = this.modelResolver.resolve(baseTier);

    if (!resolved.startsWith('claude-')) {
      return resolved;
    }

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

  private resolveActiveProvider(): AnthropicProviderId {
    const providerId =
      this.config.get<string>('anthropicProviderId') ?? 'ollama';

    this.logger.info(`[DeepAgentAdapter] Resolved provider: ${providerId}`);

    return providerId as AnthropicProviderId;
  }
}
