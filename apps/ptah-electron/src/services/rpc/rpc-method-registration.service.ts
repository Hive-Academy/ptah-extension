/**
 * Electron RPC Method Registration Service
 *
 * Class-based orchestrator that mirrors the VS Code RpcMethodRegistrationService pattern.
 * Delegates to domain-specific handler classes: shared handlers from @ptah-extension/rpc-handlers
 * and Electron-specific handlers from ./handlers/.
 *
 * TASK_2025_203 Batch 5: Rewritten from ~2300-line procedural file to ~200-line class orchestrator.
 * TASK_2025_209: Unified LlmRpcHandlers, ChatRpcHandlers (chat:send-message, chat:stop).
 * Re-added ElectronAgentRpcHandlers, ElectronSkillsShRpcHandlers, ElectronLayoutRpcHandlers
 * with proper Electron-specific implementations using platform-agnostic services.
 *
 * Handler registration order:
 * 1. Shared handlers (17 handlers from @ptah-extension/rpc-handlers)
 *    - Session, Chat, Config, Auth, Context, Setup, License, WizardGeneration,
 *      Autocomplete, Subagent, Plugin, PtahCli, EnhancedPrompts, Quality, Provider, LLM, WebSearch
 * 2. Electron-specific handlers (10 handlers from ./handlers/)
 *    - Workspace, Editor, File, ConfigExtended, Command, AuthExtended, Settings,
 *      Agent, SkillsSh, Layout
 */

import { injectable, inject, container } from 'tsyringe';
import { TOKENS, verifyRpcRegistration } from '@ptah-extension/vscode-core';
import type {
  Logger,
  RpcHandler,
  AgentSummaryChunk,
  AgentStartEvent,
} from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES, retryWithBackoff } from '@ptah-extension/shared';
import type {
  AgentProcessInfo,
  AgentOutputDelta,
  CliSessionReference,
  CliOutputSegment,
  FlatStreamEventUnion,
  AgentPermissionRequest,
} from '@ptah-extension/shared';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import type { AgentProcessManager } from '@ptah-extension/llm-abstraction';
import type { CopilotPermissionBridge } from '@ptah-extension/llm-abstraction';

// Shared handler classes (all 17)
import {
  SessionRpcHandlers,
  ChatRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  ContextRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  WizardGenerationRpcHandlers,
  AutocompleteRpcHandlers,
  SubagentRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  ProviderRpcHandlers,
  LlmRpcHandlers,
  WebSearchRpcHandlers,
} from '@ptah-extension/rpc-handlers';

// Electron-specific handler classes
import {
  ElectronWorkspaceRpcHandlers,
  ElectronEditorRpcHandlers,
  ElectronFileRpcHandlers,
  ElectronConfigExtendedRpcHandlers,
  ElectronCommandRpcHandlers,
  ElectronAuthExtendedRpcHandlers,
  ElectronSettingsRpcHandlers,
  ElectronAgentRpcHandlers,
  ElectronSkillsShRpcHandlers,
  ElectronLayoutRpcHandlers,
  ElectronGitRpcHandlers,
  ElectronTerminalRpcHandlers,
} from './handlers';
import { ELECTRON_TOKENS } from '../../di/electron-tokens';
import type { GitInfoService } from '../git-info.service';

/**
 * Orchestrates RPC method registration across all domain handlers.
 *
 * TASK_2025_203 Batch 5: Reduced from ~2300 lines (two procedural files)
 * to a class-based orchestrator matching the VS Code pattern.
 * TASK_2025_209: Unified LLM/Chat handlers into shared.
 */
@injectable()
export class ElectronRpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    // Shared handlers (all 17)
    @inject(SessionRpcHandlers)
    private readonly sessionHandlers: SessionRpcHandlers,
    @inject(ChatRpcHandlers) private readonly chatHandlers: ChatRpcHandlers,
    @inject(ConfigRpcHandlers)
    private readonly configHandlers: ConfigRpcHandlers,
    @inject(AuthRpcHandlers) private readonly authHandlers: AuthRpcHandlers,
    @inject(ContextRpcHandlers)
    private readonly contextHandlers: ContextRpcHandlers,
    @inject(SetupRpcHandlers) private readonly setupHandlers: SetupRpcHandlers,
    @inject(LicenseRpcHandlers)
    private readonly licenseHandlers: LicenseRpcHandlers,
    @inject(WizardGenerationRpcHandlers)
    private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers,
    @inject(AutocompleteRpcHandlers)
    private readonly autocompleteHandlers: AutocompleteRpcHandlers,
    @inject(SubagentRpcHandlers)
    private readonly subagentHandlers: SubagentRpcHandlers,
    @inject(PluginRpcHandlers)
    private readonly pluginHandlers: PluginRpcHandlers,
    @inject(PtahCliRpcHandlers)
    private readonly ptahCliHandlers: PtahCliRpcHandlers,
    @inject(EnhancedPromptsRpcHandlers)
    private readonly enhancedPromptsHandlers: EnhancedPromptsRpcHandlers,
    @inject(QualityRpcHandlers)
    private readonly qualityHandlers: QualityRpcHandlers,
    @inject(ProviderRpcHandlers)
    private readonly providerHandlers: ProviderRpcHandlers,
    @inject(LlmRpcHandlers) private readonly llmHandlers: LlmRpcHandlers,
    @inject(WebSearchRpcHandlers)
    private readonly webSearchHandlers: WebSearchRpcHandlers,
    // Electron-specific handlers
    @inject(ElectronWorkspaceRpcHandlers)
    private readonly workspaceHandlers: ElectronWorkspaceRpcHandlers,
    @inject(ElectronEditorRpcHandlers)
    private readonly editorHandlers: ElectronEditorRpcHandlers,
    @inject(ElectronFileRpcHandlers)
    private readonly fileHandlers: ElectronFileRpcHandlers,
    @inject(ElectronConfigExtendedRpcHandlers)
    private readonly configExtendedHandlers: ElectronConfigExtendedRpcHandlers,
    @inject(ElectronCommandRpcHandlers)
    private readonly commandHandlers: ElectronCommandRpcHandlers,
    @inject(ElectronAuthExtendedRpcHandlers)
    private readonly authExtendedHandlers: ElectronAuthExtendedRpcHandlers,
    @inject(ElectronSettingsRpcHandlers)
    private readonly settingsHandlers: ElectronSettingsRpcHandlers,
    @inject(ElectronAgentRpcHandlers)
    private readonly agentHandlers: ElectronAgentRpcHandlers,
    @inject(ElectronSkillsShRpcHandlers)
    private readonly skillsShHandlers: ElectronSkillsShRpcHandlers,
    @inject(ElectronLayoutRpcHandlers)
    private readonly layoutHandlers: ElectronLayoutRpcHandlers,
    @inject(ElectronGitRpcHandlers)
    private readonly gitHandlers: ElectronGitRpcHandlers,
    @inject(ElectronTerminalRpcHandlers)
    private readonly terminalHandlers: ElectronTerminalRpcHandlers,
  ) {}

  /**
   * Register all RPC methods by delegating to domain-specific handlers.
   *
   * Shared handlers register first (platform-agnostic implementations),
   * then Electron-specific handlers register supplementary/override methods.
   */
  registerAll(): void {
    // Phase 1: Shared handlers from @ptah-extension/rpc-handlers
    this.registerSharedHandlers();

    // Phase 2: Electron-specific handlers
    this.registerElectronHandlers();

    // Phase 3: Wire SDK callbacks (SESSION_STATS, SESSION_ID_RESOLVED, etc.)
    // TASK_2025_241: Without these, the frontend hangs after chat:complete
    // because SESSION_STATS never arrives to finalize streaming state.
    this.setupSdkCallbacks();

    // Phase 3.1: Wire agent watcher listeners (summary chunks, agent-start events)
    // TASK_2025_243: Port from VS Code for real-time subagent summary streaming
    this.setupAgentWatcherListeners();

    // Phase 3.2: Wire agent monitor listeners (spawned, output, exited)
    // TASK_2025_243: Port from VS Code for real-time agent monitor sidebar
    this.setupAgentMonitorListeners();

    // Phase 4: Verify all expected RPC methods are registered
    verifyRpcRegistration(this.rpcHandler, this.logger);

    this.logger.info('[Electron RPC] All RPC methods registered', {
      methods: this.rpcHandler.getRegisteredMethods(),
    } as unknown as Error);
  }

  private registerSharedHandlers(): void {
    const sharedHandlers: Array<{
      name: string;
      handler: { register(): void };
    }> = [
      { name: 'SessionRpcHandlers', handler: this.sessionHandlers },
      { name: 'ChatRpcHandlers', handler: this.chatHandlers },
      { name: 'ConfigRpcHandlers', handler: this.configHandlers },
      { name: 'AuthRpcHandlers', handler: this.authHandlers },
      { name: 'ContextRpcHandlers', handler: this.contextHandlers },
      { name: 'SetupRpcHandlers', handler: this.setupHandlers },
      { name: 'LicenseRpcHandlers', handler: this.licenseHandlers },
      {
        name: 'WizardGenerationRpcHandlers',
        handler: this.wizardGenerationHandlers,
      },
      { name: 'AutocompleteRpcHandlers', handler: this.autocompleteHandlers },
      { name: 'SubagentRpcHandlers', handler: this.subagentHandlers },
      { name: 'PluginRpcHandlers', handler: this.pluginHandlers },
      { name: 'PtahCliRpcHandlers', handler: this.ptahCliHandlers },
      {
        name: 'EnhancedPromptsRpcHandlers',
        handler: this.enhancedPromptsHandlers,
      },
      { name: 'QualityRpcHandlers', handler: this.qualityHandlers },
      { name: 'ProviderRpcHandlers', handler: this.providerHandlers },
      { name: 'LlmRpcHandlers', handler: this.llmHandlers },
      { name: 'WebSearchRpcHandlers', handler: this.webSearchHandlers },
    ];

    for (const { name, handler } of sharedHandlers) {
      try {
        handler.register();
        this.logger.info(`[Electron RPC] ${name} registered (shared)`);
      } catch (error) {
        this.logger.error(
          `[Electron RPC] Failed to register ${name} (shared)`,
          {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error,
        );
      }
    }
  }

  /**
   * Wire SDK adapter callbacks so the backend can push events to the frontend.
   * TASK_2025_241: These were missing in Electron, causing the frontend to hang
   * after chat:complete because SESSION_STATS never arrived.
   *
   * Resolved lazily because SdkAgentAdapter and WebviewManager may not be
   * registered at DI construction time (Electron phases register them later).
   */
  private setupSdkCallbacks(): void {
    // Lazy-resolve SdkAgentAdapter (may fail if SDK auth not configured)
    if (!container.isRegistered(SDK_TOKENS.SDK_AGENT_ADAPTER)) {
      this.logger.warn(
        '[Electron RPC] SdkAgentAdapter not registered — SDK callbacks skipped',
      );
      return;
    }

    // Lazy-resolve WebviewManager (registered in Phase 4, before this runs)
    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[Electron RPC] WebviewManager not registered — SDK callbacks skipped',
      );
      return;
    }

    try {
      const sdkAdapter = container.resolve<SdkAgentAdapter>(
        SDK_TOKENS.SDK_AGENT_ADAPTER,
      );
      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);

      // 1. SESSION_STATS — authoritative streaming completion signal
      // TASK_2025_243: Uses sendStatsWithRetry for resilient delivery
      sdkAdapter.setResultStatsCallback(async (stats) => {
        this.logger.info(
          `[Electron RPC] Session stats received: ${stats.sessionId}`,
        );
        await this.sendStatsWithRetry(webviewManager, stats);
      });

      // 2. SESSION_ID_RESOLVED — temporary tab ID → real SDK UUID
      // Mirrors VS Code: resolves parent session IDs in AgentProcessManager
      // and SubagentRegistryService, re-persists exited agents, then notifies frontend.
      sdkAdapter.setSessionIdResolvedCallback(
        (tabId: string | undefined, realSessionId: string) => {
          this.logger.info(
            `[Electron RPC] Session ID resolved: tabId=${tabId} -> real=${realSessionId}`,
          );

          // Update CLI agents spawned with tab ID as parentSessionId
          // so CLI session persistence uses the correct real session UUID.
          if (tabId) {
            try {
              if (container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
                const agentProcessManager =
                  container.resolve<AgentProcessManager>(
                    TOKENS.AGENT_PROCESS_MANAGER,
                  );
                agentProcessManager.resolveParentSessionId(
                  tabId,
                  realSessionId,
                );

                // Also resolve parent session ID in SubagentRegistryService
                // so that markParentSubagentsAsCliAgent() can find subagent records.
                try {
                  if (
                    container.isRegistered(TOKENS.SUBAGENT_REGISTRY_SERVICE)
                  ) {
                    const subagentRegistry = container.resolve<{
                      resolveParentSessionId(
                        tabId: string,
                        realSessionId: string,
                      ): void;
                    }>(TOKENS.SUBAGENT_REGISTRY_SERVICE);
                    subagentRegistry.resolveParentSessionId(
                      tabId,
                      realSessionId,
                    );
                  }
                } catch {
                  // SubagentRegistryService may not be registered yet
                }

                // Re-persist any already-exited agents whose CLI sessions couldn't be
                // persisted earlier (because parentSessionId was still a tab ID).
                const allAgents =
                  agentProcessManager.getStatus() as AgentProcessInfo[];
                const exitedWithParent = allAgents.filter(
                  (a) =>
                    a.parentSessionId === realSessionId &&
                    a.status !== 'running',
                );
                if (exitedWithParent.length > 0) {
                  this.logger.info(
                    `[Electron RPC] Re-persisting ${exitedWithParent.length} exited CLI agent(s) with resolved session ID ${realSessionId}`,
                  );
                }
                for (const exitedInfo of exitedWithParent) {
                  this.persistCliSessionReference(exitedInfo);
                }
              }
            } catch {
              // AgentProcessManager may not be registered yet
            }
          }

          webviewManager
            .broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, {
              tabId,
              realSessionId,
            })
            .catch((error) => {
              this.logger.error(
                '[Electron RPC] Failed to send session:id-resolved',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      // 3. COMPACTION_START — context window compaction notification
      sdkAdapter.setCompactionStartCallback((data) => {
        this.logger.info(
          `[Electron RPC] Compaction started: sessionId=${data.sessionId}`,
        );
        const compactionEvent = {
          id: `compaction_${data.sessionId}_${data.timestamp}`,
          eventType: 'compaction_start' as const,
          timestamp: data.timestamp,
          sessionId: data.sessionId,
          messageId: `compaction_msg_${data.timestamp}`,
          trigger: data.trigger,
          source: 'stream' as const,
        };
        webviewManager
          .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
            sessionId: data.sessionId,
            event: compactionEvent,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send compaction event',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      // 4. WORKTREE callbacks — git worktree create/remove notifications
      // Resolve GitInfoService lazily to query git for the actual worktree path
      // (the SDK hook only provides branch name + session cwd, not the worktree path)
      sdkAdapter.setWorktreeCreatedCallback(async (data) => {
        this.logger.info(`[Electron RPC] Worktree created: name=${data.name}`);

        // Find the actual worktree path by listing worktrees and matching by branch name
        let worktreePath: string | undefined;
        try {
          if (container.isRegistered(ELECTRON_TOKENS.GIT_INFO_SERVICE)) {
            const gitInfo = container.resolve<GitInfoService>(
              ELECTRON_TOKENS.GIT_INFO_SERVICE,
            );
            const worktrees = await gitInfo.getWorktrees(data.cwd);
            // parseWorktreeList() already strips refs/heads/ prefix,
            // so exact match on branch name is sufficient
            const match = worktrees.find((w) => w.branch === data.name);
            worktreePath = match?.path;
          }
        } catch (err) {
          this.logger.warn(
            '[Electron RPC] Failed to resolve worktree path, falling back to name-based path',
            { error: err instanceof Error ? err.message : String(err) },
          );
        }

        webviewManager
          .broadcastMessage('git:worktreeChanged', {
            action: 'created',
            name: data.name,
            path: worktreePath,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send git:worktreeChanged (created)',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      sdkAdapter.setWorktreeRemovedCallback((data) => {
        this.logger.info(
          `[Electron RPC] Worktree removed: path=${data.worktreePath}`,
        );
        webviewManager
          .broadcastMessage('git:worktreeChanged', {
            action: 'removed',
            path: data.worktreePath,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send git:worktreeChanged (removed)',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      this.logger.info(
        '[Electron RPC] SDK callbacks wired (stats, sessionId, compaction, worktree)',
      );
    } catch (error) {
      this.logger.warn(
        '[Electron RPC] Failed to setup SDK callbacks (non-fatal):',
        {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error,
      );
    }
  }

  /**
   * Send session stats to webview with retry logic.
   * TASK_2025_243: Ported from VS Code for resilient stats delivery.
   * Retries on channel/disposed/closed/timeout errors (3 retries, 1s initial delay).
   */
  private async sendStatsWithRetry(
    webviewManager: {
      broadcastMessage(type: string, payload: unknown): Promise<void>;
    },
    stats: {
      sessionId: string;
      cost: number;
      tokens: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheCreation?: number;
      };
      duration: number;
      modelUsage?: Array<{
        model: string;
        inputTokens: number;
        outputTokens: number;
        contextWindow: number;
        costUSD: number;
        cacheReadInputTokens?: number;
        lastTurnContextTokens?: number;
      }>;
    },
  ): Promise<void> {
    try {
      await retryWithBackoff(
        () =>
          webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
            sessionId: stats.sessionId,
            cost: stats.cost,
            tokens: stats.tokens,
            duration: stats.duration,
            modelUsage: stats.modelUsage,
          }),
        {
          retries: 3,
          initialDelay: 1000,
          shouldRetry: (error: unknown): boolean => {
            const message =
              error instanceof Error ? error.message.toLowerCase() : '';
            return (
              message.includes('channel') ||
              message.includes('disposed') ||
              message.includes('closed') ||
              message.includes('timeout')
            );
          },
        },
      );
    } catch (error) {
      this.logger.error(
        '[Electron RPC] Failed to send session:stats after all retries',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Setup listeners for agent session watcher events (summary chunks, agent-start).
   * TASK_2025_243: Ported from VS Code for real-time subagent summary streaming.
   *
   * Listens for:
   * - 'summary-chunk': Forwards summary content to webview via AGENT_SUMMARY_CHUNK
   * - 'agent-start': Creates agent_start streaming event via CHAT_CHUNK
   */
  private setupAgentWatcherListeners(): void {
    if (!container.isRegistered(TOKENS.AGENT_SESSION_WATCHER_SERVICE)) {
      this.logger.warn(
        '[Electron RPC] AgentSessionWatcherService not registered — watcher listeners skipped',
      );
      return;
    }

    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[Electron RPC] WebviewManager not registered — watcher listeners skipped',
      );
      return;
    }

    try {
      const agentWatcher = container.resolve<{
        on(
          event: 'summary-chunk',
          callback: (chunk: AgentSummaryChunk) => void,
        ): void;
        on(
          event: 'agent-start',
          callback: (event: AgentStartEvent) => void,
        ): void;
      }>(TOKENS.AGENT_SESSION_WATCHER_SERVICE);

      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);

      // Listen for summary chunks and forward to webview
      agentWatcher.on('summary-chunk', (chunk: AgentSummaryChunk) => {
        this.logger.info(
          '[Electron RPC] Received summary-chunk, forwarding to webview',
          {
            toolUseId: chunk.toolUseId,
            agentId: chunk.agentId,
            deltaLength: chunk.summaryDelta.length,
          } as unknown as Error,
        );

        webviewManager
          .broadcastMessage(MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)
          .then(() => {
            this.logger.info(
              '[Electron RPC] Summary-chunk sent to webview successfully',
              { toolUseId: chunk.toolUseId } as unknown as Error,
            );
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send agent summary chunk to webview',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      // Listen for agent-start events and send as agent_start streaming event
      // This creates the agent node in the frontend BEFORE summary chunks arrive
      agentWatcher.on('agent-start', (agentStartEvent: AgentStartEvent) => {
        this.logger.info('[Electron RPC] Received agent-start event', {
          toolUseId: agentStartEvent.toolUseId,
          agentId: agentStartEvent.agentId,
          agentType: agentStartEvent.agentType,
          sessionId: agentStartEvent.sessionId,
        } as unknown as Error);

        // Send as a CHAT_CHUNK with agent_start event type
        // Matches the format expected by streaming-handler.service.ts
        const streamingEvent = {
          id: `agent-start-${agentStartEvent.toolUseId}`,
          eventType: 'agent_start' as const,
          sessionId: agentStartEvent.sessionId,
          messageId: '',
          toolCallId: agentStartEvent.toolUseId,
          parentToolUseId: agentStartEvent.toolUseId,
          agentType: agentStartEvent.agentType,
          agentDescription: agentStartEvent.agentDescription,
          timestamp: agentStartEvent.timestamp,
          source: 'hook' as const,
          agentId: agentStartEvent.agentId,
        };

        webviewManager
          .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
            sessionId: agentStartEvent.sessionId,
            event: streamingEvent,
          })
          .catch((error) => {
            this.logger.error(
              '[Electron RPC] Failed to send agent-start event to webview',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      });

      this.logger.info(
        '[Electron RPC] Agent watcher listeners registered (summary-chunk, agent-start)',
      );
    } catch (error) {
      this.logger.warn(
        '[Electron RPC] Failed to setup agent watcher listeners (non-fatal):',
        {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error,
      );
    }
  }

  /**
   * Setup listeners for agent process manager events (spawned, output, exited).
   * TASK_2025_243: Ported from VS Code for real-time agent monitoring sidebar.
   *
   * Forwards agent lifecycle events to the webview and persists CLI session
   * references for session resume on reload.
   */
  private setupAgentMonitorListeners(): void {
    if (!container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
      this.logger.warn(
        '[Electron RPC] AgentProcessManager not registered — monitor listeners skipped',
      );
      return;
    }

    if (!container.isRegistered(TOKENS.WEBVIEW_MANAGER)) {
      this.logger.warn(
        '[Electron RPC] WebviewManager not registered — monitor listeners skipped',
      );
      return;
    }

    try {
      const agentProcessManager = container.resolve<AgentProcessManager>(
        TOKENS.AGENT_PROCESS_MANAGER,
      );

      const webviewManager = container.resolve<{
        broadcastMessage(type: string, payload: unknown): Promise<void>;
      }>(TOKENS.WEBVIEW_MANAGER);

      agentProcessManager.events.on(
        'agent:spawned',
        (info: AgentProcessInfo) => {
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_SPAWNED, info)
            .catch((error) => {
              this.logger.error(
                '[Electron RPC] Failed to send agent-monitor:spawned to webview',
                error instanceof Error ? error : new Error(String(error)),
              );
            });

          // Persist CLI session reference at spawn time
          if (info.parentSessionId && info.cliSessionId) {
            this.persistCliSessionReference(info);
          }
        },
      );

      agentProcessManager.events.on(
        'agent:output',
        (delta: AgentOutputDelta) => {
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_OUTPUT, delta)
            .catch((error) => {
              this.logger.error(
                '[Electron RPC] Failed to send agent-monitor:output to webview',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      agentProcessManager.events.on(
        'agent:exited',
        (info: AgentProcessInfo) => {
          webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_EXITED, info)
            .catch((error) => {
              this.logger.error(
                '[Electron RPC] Failed to send agent-monitor:exited to webview',
                error instanceof Error ? error : new Error(String(error)),
              );
            });

          // Persist CLI session reference on exit
          if (info.parentSessionId) {
            this.persistCliSessionReference(info);
          }
        },
      );

      this.logger.info(
        '[Electron RPC] Agent monitor listeners registered (spawned, output, exited)',
      );

      // Wire Copilot SDK permission bridge events
      this.setupCopilotPermissionForwarding(webviewManager);
    } catch (error) {
      this.logger.warn(
        '[Electron RPC] Could not setup agent monitor listeners (non-fatal)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Persist a CLI session reference to the parent session's metadata.
   * TASK_2025_243: Ported from VS Code for session resume on reload.
   *
   * Enables session resume when loading saved sessions.
   * Fire-and-forget: errors are caught and logged, never block exit event forwarding.
   */
  private persistCliSessionReference(info: AgentProcessInfo): void {
    const { parentSessionId } = info;
    if (!parentSessionId) return;

    // Use cliSessionId if available, otherwise fall back to agentId.
    // PtahCli agents (headless SDK queries) don't have native CLI sessions,
    // but we still persist their references for the agent monitor panel.
    const effectiveCliSessionId = info.cliSessionId || info.agentId;

    try {
      if (!container.isRegistered(SDK_TOKENS.SDK_SESSION_METADATA_STORE)) {
        this.logger.warn(
          '[Electron RPC] SessionMetadataStore not registered — CLI session persist skipped',
        );
        return;
      }

      const metadataStore = container.resolve<{
        addCliSession(
          sessionId: string,
          ref: CliSessionReference,
        ): Promise<void>;
      }>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);

      // Capture accumulated output for persistence (if agent is still tracked)
      let persistedOutput:
        | {
            stdout?: string;
            segments?: readonly CliOutputSegment[];
            streamEvents?: readonly FlatStreamEventUnion[];
          }
        | undefined;

      if (container.isRegistered(TOKENS.AGENT_PROCESS_MANAGER)) {
        const agentProcessManager = container.resolve<AgentProcessManager>(
          TOKENS.AGENT_PROCESS_MANAGER,
        );
        persistedOutput = agentProcessManager.readOutputForPersistence(
          info.agentId,
        ) as typeof persistedOutput;
      }

      if (!persistedOutput && info.status !== 'running') {
        this.logger.warn(
          `[Electron RPC] Agent ${info.agentId} output unavailable for persistence (already cleaned up?)`,
          { cli: info.cli, status: info.status } as unknown as Error,
        );
      }

      // For ptah-cli sessions, retrieve the resolved SDK UUID for cross-referencing.
      const sdkSessionId = info.ptahCliId
        ? this.chatHandlers.getPtahCliSdkSessionId(info.ptahCliId)
        : undefined;

      const ref: CliSessionReference = {
        cliSessionId: effectiveCliSessionId,
        cli: info.cli,
        agentId: info.agentId,
        task: info.task,
        startedAt: info.startedAt,
        status: info.status,
        ...(persistedOutput?.stdout ? { stdout: persistedOutput.stdout } : {}),
        ...(persistedOutput?.segments?.length
          ? { segments: persistedOutput.segments }
          : {}),
        ...(persistedOutput?.streamEvents?.length
          ? { streamEvents: persistedOutput.streamEvents }
          : {}),
        ...(info.ptahCliId ? { ptahCliId: info.ptahCliId } : {}),
        ...(sdkSessionId ? { sdkSessionId } : {}),
      };

      retryWithBackoff(
        () => metadataStore.addCliSession(parentSessionId, ref),
        {
          retries: 3,
          initialDelay: 1000,
          shouldRetry: (error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            return !msg.includes('Parent session not found');
          },
        },
      )
        .then(() => {
          this.logger.info(
            `[Electron RPC] CLI session reference persisted: ${effectiveCliSessionId} -> parent ${parentSessionId}`,
          );
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('Parent session not found')) {
            this.logger.info(
              `[Electron RPC] CLI session persist deferred (parent not yet resolved): ${parentSessionId}`,
            );
          } else {
            this.logger.error(
              '[Electron RPC] Failed to persist CLI session reference after retries',
              error instanceof Error ? error : new Error(msg),
            );
          }
        });
    } catch (error) {
      this.logger.warn(
        '[Electron RPC] Could not persist CLI session reference',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Wire Copilot SDK permission bridge events to webview.
   * TASK_2025_243: Ported from VS Code for Copilot permission forwarding.
   *
   * Resolves CliDetectionService lazily, gets the Copilot adapter's permission bridge,
   * and forwards permission-request events to the webview.
   */
  private setupCopilotPermissionForwarding(webviewManager: {
    broadcastMessage(type: string, payload: unknown): Promise<void>;
  }): void {
    try {
      if (!container.isRegistered(TOKENS.CLI_DETECTION_SERVICE)) {
        this.logger.info(
          '[Electron RPC] CliDetectionService not registered — Copilot permission forwarding skipped',
        );
        return;
      }

      const cliDetection = container.resolve<{
        getAdapter(
          cli: string,
        ): { permissionBridge?: CopilotPermissionBridge } | undefined;
      }>(TOKENS.CLI_DETECTION_SERVICE);

      const copilotAdapter = cliDetection.getAdapter('copilot');

      if (copilotAdapter && copilotAdapter.permissionBridge) {
        const bridge = copilotAdapter.permissionBridge;

        bridge.events.on(
          'permission-request',
          (request: AgentPermissionRequest) => {
            webviewManager
              .broadcastMessage(
                MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
                request,
              )
              .catch((error) => {
                this.logger.error(
                  '[Electron RPC] Failed to send agent permission request to webview',
                  error instanceof Error ? error : new Error(String(error)),
                );
              });
          },
        );

        this.logger.info(
          '[Electron RPC] Copilot SDK permission forwarding registered',
        );
      }
    } catch (error) {
      this.logger.info(
        '[Electron RPC] Copilot SDK permission forwarding not available (non-fatal)',
        {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error,
      );
    }
  }

  private registerElectronHandlers(): void {
    const electronHandlers: Array<{
      name: string;
      handler: { register(): void };
    }> = [
      { name: 'ElectronWorkspaceRpcHandlers', handler: this.workspaceHandlers },
      { name: 'ElectronEditorRpcHandlers', handler: this.editorHandlers },
      { name: 'ElectronFileRpcHandlers', handler: this.fileHandlers },
      {
        name: 'ElectronConfigExtendedRpcHandlers',
        handler: this.configExtendedHandlers,
      },
      { name: 'ElectronCommandRpcHandlers', handler: this.commandHandlers },
      {
        name: 'ElectronAuthExtendedRpcHandlers',
        handler: this.authExtendedHandlers,
      },
      {
        name: 'ElectronSettingsRpcHandlers',
        handler: this.settingsHandlers,
      },
      {
        name: 'ElectronAgentRpcHandlers',
        handler: this.agentHandlers,
      },
      {
        name: 'ElectronSkillsShRpcHandlers',
        handler: this.skillsShHandlers,
      },
      {
        name: 'ElectronLayoutRpcHandlers',
        handler: this.layoutHandlers,
      },
      {
        name: 'ElectronGitRpcHandlers',
        handler: this.gitHandlers,
      },
      {
        name: 'ElectronTerminalRpcHandlers',
        handler: this.terminalHandlers,
      },
    ];

    for (const { name, handler } of electronHandlers) {
      try {
        handler.register();
        this.logger.info(`[Electron RPC] ${name} registered (Electron)`);
      } catch (error) {
        this.logger.warn(
          `[Electron RPC] Failed to register ${name} (Electron)`,
          {
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error,
        );
      }
    }
  }
}
