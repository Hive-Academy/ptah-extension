/**
 * RPC Method Registration Service
 *
 * Orchestrates RPC handler registration by delegating to domain-specific handler classes.
 * Responsible for:
 * - Initializing SDK callbacks (session ID resolution, stats)
 * - Setting up agent watcher listeners
 * - Registering VS Code commands
 * - Delegating to domain-specific handler classes
 * - Verifying all expected methods are registered
 *
 * TASK_2025_051: SDK-only migration
 * TASK_2025_074: Refactored from ~1500 lines to ~150 lines orchestrator
 */

import { injectable, inject, DependencyContainer, container } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  AgentSessionWatcherService,
  AgentSummaryChunk,
  AgentStartEvent,
  TOKENS,
  CommandManager,
  SubagentRegistryService,
  verifyRpcRegistration,
  assertRpcRegistration,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  AgentProcessManager,
  CliDetectionService,
  CopilotPermissionBridge,
} from '@ptah-extension/llm-abstraction';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IAgentAdapter, ResultStatsPayload } from '@ptah-extension/shared';
import {
  retryWithBackoff,
  MESSAGE_TYPES,
  AgentProcessInfo,
  AgentOutputDelta,
  CliSessionReference,
  parseWorktreeList,
} from '@ptah-extension/shared';
import type {
  AgentPermissionRequest,
  AnalysisStreamPayload,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { AGENT_GENERATION_TOKENS } from '@ptah-extension/agent-generation';
import * as vscode from 'vscode';

// All handlers imported from barrel (TASK_2025_203 Batch 5: unified imports)
// Shared handlers come from @ptah-extension/rpc-handlers via the barrel.
// Tier 3 handlers (File, Command, Agent) are local VS Code-specific files.
import {
  // Shared handlers (17 total from @ptah-extension/rpc-handlers)
  ChatRpcHandlers,
  SessionRpcHandlers,
  ContextRpcHandlers,
  AutocompleteRpcHandlers,
  ConfigRpcHandlers,
  AuthRpcHandlers,
  SetupRpcHandlers,
  LicenseRpcHandlers,
  LlmRpcHandlers,
  ProviderRpcHandlers,
  SubagentRpcHandlers,
  EnhancedPromptsRpcHandlers,
  QualityRpcHandlers,
  WizardGenerationRpcHandlers,
  PluginRpcHandlers,
  PtahCliRpcHandlers,
  WebSearchRpcHandlers,
  HarnessRpcHandlers,
  // Tier 3 handlers (local, VS Code-specific)
  FileRpcHandlers,
  CommandRpcHandlers,
  AgentRpcHandlers,
  SkillsShRpcHandlers,
  McpDirectoryRpcHandlers,
} from './handlers';

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/**
 * Orchestrates RPC method registration across all domain handlers.
 *
 * TASK_2025_074: Reduced from ~1500 lines to ~150 lines by extracting
 * domain-specific handlers into separate classes.
 */
@injectable()
export class RpcMethodRegistrationService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentWatcher: AgentSessionWatcherService,
    @inject(TOKENS.COMMAND_MANAGER)
    private readonly commandManager: CommandManager,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    // Domain-specific handlers
    @inject(ChatRpcHandlers) private readonly chatHandlers: ChatRpcHandlers,
    @inject(SessionRpcHandlers)
    private readonly sessionHandlers: SessionRpcHandlers,
    @inject(ContextRpcHandlers)
    private readonly contextHandlers: ContextRpcHandlers,
    @inject(AutocompleteRpcHandlers)
    private readonly autocompleteHandlers: AutocompleteRpcHandlers,
    @inject(FileRpcHandlers) private readonly fileHandlers: FileRpcHandlers,
    @inject(ConfigRpcHandlers)
    private readonly configHandlers: ConfigRpcHandlers,
    @inject(AuthRpcHandlers) private readonly authHandlers: AuthRpcHandlers,
    @inject(SetupRpcHandlers) private readonly setupHandlers: SetupRpcHandlers,
    @inject(LicenseRpcHandlers)
    private readonly licenseHandlers: LicenseRpcHandlers,
    @inject(LlmRpcHandlers) private readonly llmHandlers: LlmRpcHandlers,
    @inject(ProviderRpcHandlers)
    private readonly providerHandlers: ProviderRpcHandlers,
    @inject(SubagentRpcHandlers)
    private readonly subagentHandlers: SubagentRpcHandlers,
    @inject(CommandRpcHandlers)
    private readonly commandHandlers: CommandRpcHandlers, // TASK_2025_126
    @inject(EnhancedPromptsRpcHandlers)
    private readonly enhancedPromptsHandlers: EnhancedPromptsRpcHandlers, // TASK_2025_137
    @inject(QualityRpcHandlers)
    private readonly qualityHandlers: QualityRpcHandlers, // TASK_2025_144
    @inject(WizardGenerationRpcHandlers)
    private readonly wizardGenerationHandlers: WizardGenerationRpcHandlers, // TASK_2025_148
    @inject(PluginRpcHandlers)
    private readonly pluginHandlers: PluginRpcHandlers, // TASK_2025_153
    @inject(AgentRpcHandlers) private readonly agentHandlers: AgentRpcHandlers, // TASK_2025_157
    @inject(PtahCliRpcHandlers)
    private readonly ptahCliHandlers: PtahCliRpcHandlers, // TASK_2025_167
    @inject(SkillsShRpcHandlers)
    private readonly skillsShHandlers: SkillsShRpcHandlers, // TASK_2025_204
    @inject(McpDirectoryRpcHandlers)
    private readonly mcpDirectoryHandlers: McpDirectoryRpcHandlers,
    @inject(WebSearchRpcHandlers)
    private readonly webSearchHandlers: WebSearchRpcHandlers, // TASK_2025_235
    @inject(HarnessRpcHandlers)
    private readonly harnessHandlers: HarnessRpcHandlers,
    @inject('DependencyContainer')
    private readonly container: DependencyContainer,
  ) {
    // Setup SDK callbacks and listeners
    this.setupAgentWatcherListeners();
    this.setupAgentMonitorListeners();
    this.setupSessionIdResolvedCallback();
    this.setupResultStatsCallback();
    this.setupCompactionStartCallback();
    this.setupWorktreeCallbacks(); // TASK_2025_236
    this.registerSetupAgentsCommand();
  }

  /**
   * Register all RPC methods by delegating to domain-specific handlers
   */
  registerAll(): void {
    // Delegate to domain-specific handlers
    this.chatHandlers.register();
    this.sessionHandlers.register();
    this.contextHandlers.register();
    this.autocompleteHandlers.register();
    this.fileHandlers.register();
    this.configHandlers.register();
    this.authHandlers.register();
    this.setupHandlers.register();
    this.licenseHandlers.register();
    this.llmHandlers.register();
    this.providerHandlers.register();
    this.subagentHandlers.register();
    this.commandHandlers.register(); // TASK_2025_126
    this.enhancedPromptsHandlers.register(); // TASK_2025_137
    this.qualityHandlers.register(); // TASK_2025_144
    this.wizardGenerationHandlers.register(); // TASK_2025_148
    this.pluginHandlers.register(); // TASK_2025_153
    this.agentHandlers.register(); // TASK_2025_157
    this.ptahCliHandlers.register(); // TASK_2025_167
    this.skillsShHandlers.register(); // TASK_2025_204
    this.mcpDirectoryHandlers.register(); // MCP Server Directory
    this.webSearchHandlers.register(); // TASK_2025_235
    this.harnessHandlers.register();

    this.logger.info('RPC methods registered (SDK-only mode)', {
      methods: this.rpcHandler.getRegisteredMethods(),
    });

    // Verify all expected RPC methods have handlers
    // Exclude Electron-only methods (workspace/layout/editor/file/config/auth/settings) that are not applicable in VS Code
    const ELECTRON_ONLY_METHODS = [
      'workspace:getInfo',
      'workspace:addFolder',
      'workspace:removeFolder',
      'workspace:switch',
      'layout:persist',
      'layout:restore',
      // Electron editor methods (Monaco-based)
      'editor:openFile',
      'editor:saveFile',
      'editor:getFileTree',
      'editor:getDirectoryChildren',
      // Electron file methods (IFileSystemProvider-based)
      'file:read',
      'file:exists',
      'file:save-dialog',
      // Electron config extended methods
      'config:model-set',
      // Electron auth extended methods
      'auth:setApiKey',
      'auth:getStatus',
      'auth:getApiKeyStatus',
      // Electron settings export/import
      'settings:export',
      'settings:import',
      // Electron git methods (TASK_2025_227)
      'git:info',
      'git:worktrees',
      'git:addWorktree',
      'git:removeWorktree',
      // Source control methods (TASK_2025_273)
      'git:stage',
      'git:unstage',
      'git:discard',
      'git:commit',
      'git:showFile',
      // Electron terminal methods (TASK_2025_227)
      'terminal:create',
      'terminal:kill',
      // Electron license extended
      'license:clearKey',
    ];
    const verificationResult = verifyRpcRegistration(
      this.rpcHandler,
      this.logger,
      ELECTRON_ONLY_METHODS,
    );

    if (!verificationResult.valid) {
      const driftError = new Error(
        `Missing: ${verificationResult.missingHandlers.join(', ')}. ` +
          `Add handlers or remove from RpcMethodRegistry.`,
      );
      this.logger.error(
        `RPC registration incomplete: ${verificationResult.missingHandlers.length} methods missing`,
        driftError,
      );
      // RPC hardening: surface production drift to Sentry so shipped builds
      // with missing handlers are caught immediately after rollout.
      this.reportDriftToSentry(driftError, verificationResult.missingHandlers);
    }

    // RPC hardening (Fix 3): fail fast when running as a development build.
    // In production we already logged the mismatch above and continue, so
    // a user-hostile crash is avoided — but during development this throws
    // immediately so registration drift is caught before the webview mounts.
    if (process.env['NODE_ENV'] === 'development') {
      assertRpcRegistration(
        this.rpcHandler,
        this.logger,
        ELECTRON_ONLY_METHODS,
      );
    }
  }

  /**
   * Report RPC registration drift to Sentry via lazy container resolution.
   * No-op when Sentry is not registered (tests) or not initialized (no DSN).
   */
  private reportDriftToSentry(error: Error, missing: string[]): void {
    try {
      if (!container.isRegistered(TOKENS.SENTRY_SERVICE)) return;
      const sentry = container.resolve<SentryService>(TOKENS.SENTRY_SERVICE);
      sentry.captureException(error, {
        errorSource: 'rpc-registration-drift',
        extra: { missingMethods: missing, platform: 'vscode' },
      });
    } catch {
      // Never let Sentry reporting break extension activation.
    }
  }

  /**
   * Setup listeners for agent process manager events (spawned, output, exited).
   * Forwards events to webview for the real-time agent monitoring sidebar.
   */
  private setupAgentMonitorListeners(): void {
    try {
      const agentProcessManager = this.container.resolve<AgentProcessManager>(
        TOKENS.AGENT_PROCESS_MANAGER,
      );

      agentProcessManager.events.on(
        'agent:spawned',
        (info: AgentProcessInfo) => {
          this.webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_SPAWNED, info)
            .catch((error) => {
              this.logger.error(
                'Failed to send agent-monitor:spawned to webview',
                error instanceof Error ? error : new Error(String(error)),
              );
            });

          // Persist CLI session reference at spawn time (not just exit).
          // For resumed agents, cliSessionId is pre-set from resumeSessionId,
          // so the link to the parent session is established immediately.
          // Without this, closing the session while the agent is still running
          // would lose the reference (it wouldn't appear on session reload).
          if (info.parentSessionId && info.cliSessionId) {
            this.persistCliSessionReference(info);
          }
        },
      );

      agentProcessManager.events.on(
        'agent:output',
        (delta: AgentOutputDelta) => {
          this.webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_OUTPUT, delta)
            .catch((error) => {
              this.logger.error(
                'Failed to send agent-monitor:output to webview',
                error instanceof Error ? error : new Error(String(error)),
              );
            });
        },
      );

      agentProcessManager.events.on(
        'agent:exited',
        (info: AgentProcessInfo) => {
          this.webviewManager
            .broadcastMessage(MESSAGE_TYPES.AGENT_MONITOR_EXITED, info)
            .catch((error) => {
              this.logger.error(
                'Failed to send agent-monitor:exited to webview',
                error instanceof Error ? error : new Error(String(error)),
              );
            });

          // Persist CLI session reference to parent session metadata (fire-and-forget).
          // cliSessionId is optional: PtahCli agents don't have native CLI sessions,
          // so we fall back to agentId as the reference key in persistCliSessionReference().
          if (info.parentSessionId) {
            this.persistCliSessionReference(info);
          }
        },
      );

      this.logger.info('[RPC] Agent monitor listeners registered');

      // Wire Copilot SDK permission bridge events (TASK_2025_162)
      this.setupCopilotPermissionForwarding();
    } catch (error) {
      // AgentProcessManager may not be registered yet in some configurations
      this.logger.warn(
        '[RPC] Could not setup agent monitor listeners',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Persist a CLI session reference to the parent session's metadata.
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
      const metadataStore = this.container.resolve<{
        addCliSession(
          sessionId: string,
          ref: CliSessionReference,
        ): Promise<void>;
      }>(SDK_TOKENS.SDK_SESSION_METADATA_STORE);

      // Capture accumulated output for persistence (if agent is still tracked)
      // MUST resolve by TOKEN — resolving by class creates a new empty instance
      // because AgentProcessManager is registered under TOKENS.AGENT_PROCESS_MANAGER
      const agentProcessManager = this.container.resolve<AgentProcessManager>(
        TOKENS.AGENT_PROCESS_MANAGER,
      );
      const persistedOutput = agentProcessManager.readOutputForPersistence(
        info.agentId,
      );

      if (!persistedOutput && info.status !== 'running') {
        this.logger.warn(
          `[RPC] Agent ${info.agentId} output unavailable for persistence (already cleaned up?)`,
          { cli: info.cli, status: info.status },
        );
      }

      // For ptah-cli sessions, retrieve the resolved SDK UUID for cross-referencing.
      // This enables SessionImporterService to detect child sessions on restart.
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
          // Don't retry "parent not found" errors — the parent session ID may
          // still be a tab ID (not yet resolved to real SDK UUID). The re-persist
          // logic in setupSessionIdResolvedCallback handles this timing race.
          shouldRetry: (error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            return !msg.includes('Parent session not found');
          },
        },
      )
        .then(() => {
          this.logger.info(
            `[RPC] CLI session reference persisted: ${effectiveCliSessionId} -> parent ${parentSessionId}`,
          );
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('Parent session not found')) {
            // Expected when agent exits before session ID resolves from tab ID
            // to real SDK UUID. The re-persist in setupSessionIdResolvedCallback
            // will handle this once the real session ID is available.
            this.logger.debug(
              `[RPC] CLI session persist deferred (parent not yet resolved): ${parentSessionId}`,
            );
          } else {
            this.logger.error(
              '[RPC] Failed to persist CLI session reference after retries',
              error instanceof Error ? error : new Error(msg),
            );
          }
        });
    } catch (error) {
      // SessionMetadataStore may not be available in all configurations
      this.logger.warn(
        '[RPC] Could not persist CLI session reference',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Wire Copilot SDK permission bridge events to webview.
   * Always active — the Copilot SDK adapter is the sole Copilot adapter.
   * Permission requests are forwarded as fire-and-forget broadcasts.
   * TASK_2025_162: Copilot SDK Integration
   */
  private setupCopilotPermissionForwarding(): void {
    try {
      const cliDetection = this.container.resolve<CliDetectionService>(
        TOKENS.CLI_DETECTION_SERVICE,
      );
      const copilotAdapter = cliDetection.getAdapter('copilot');

      if (copilotAdapter && 'permissionBridge' in copilotAdapter) {
        const bridge = (
          copilotAdapter as { permissionBridge: CopilotPermissionBridge }
        ).permissionBridge;

        bridge.events.on(
          'permission-request',
          (request: AgentPermissionRequest) => {
            this.webviewManager
              .broadcastMessage(
                MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
                request,
              )
              .catch((error) => {
                this.logger.error(
                  '[RPC] Failed to send agent permission request to webview',
                  error instanceof Error ? error : new Error(String(error)),
                );
              });
          },
        );

        this.logger.info('[RPC] Copilot SDK permission forwarding registered');
      }
    } catch (error) {
      // CliDetectionService may not be available in some configurations
      this.logger.debug(
        '[RPC] Copilot SDK permission forwarding not available',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Setup callback to notify frontend when real Claude session ID is resolved
   * TASK_2025_095: Now uses tabId for direct routing - no temp ID lookup needed.
   */
  private setupSessionIdResolvedCallback(): void {
    this.sdkAdapter.setSessionIdResolvedCallback(
      (tabId: string | undefined, realSessionId: string) => {
        this.logger.info(
          `[RPC] Session ID resolved from SDK: tabId=${tabId} -> real=${realSessionId}`,
        );

        // Update any CLI agents spawned with the tab ID as parentSessionId
        // so that CLI session persistence uses the correct real session UUID.
        if (tabId) {
          try {
            const agentProcessManager =
              this.container.resolve<AgentProcessManager>(
                TOKENS.AGENT_PROCESS_MANAGER,
              );
            agentProcessManager.resolveParentSessionId(tabId, realSessionId);

            // TASK_2025_186: Also resolve parent session ID in SubagentRegistryService
            // so that markParentSubagentsAsCliAgent() can find subagent records
            // (which were registered with the tab ID as parentSessionId).
            try {
              const subagentRegistry =
                this.container.resolve<SubagentRegistryService>(
                  TOKENS.SUBAGENT_REGISTRY_SERVICE,
                );
              subagentRegistry.resolveParentSessionId(tabId, realSessionId);
            } catch {
              // SubagentRegistryService may not be registered yet
            }

            // Re-persist any already-exited agents whose CLI sessions couldn't be
            // persisted earlier (because parentSessionId was still a tab ID).
            // This handles the timing race where agents exit before session ID resolves.
            const allAgents =
              agentProcessManager.getStatus() as AgentProcessInfo[];
            const exitedWithParent = allAgents.filter(
              (a) =>
                a.parentSessionId === realSessionId && a.status !== 'running',
            );
            if (exitedWithParent.length > 0) {
              this.logger.info(
                `[RPC] Re-persisting ${exitedWithParent.length} exited CLI agent(s) with resolved session ID ${realSessionId}`,
              );
            }
            for (const exitedInfo of exitedWithParent) {
              this.persistCliSessionReference(exitedInfo);
            }
          } catch {
            // AgentProcessManager may not be registered yet
          }
        }

        // Notify frontend with tabId for direct routing
        // tabId: used to find the tab directly (no temp ID lookup needed)
        // realSessionId: the actual SDK UUID to store on the tab
        this.webviewManager
          .broadcastMessage(MESSAGE_TYPES.SESSION_ID_RESOLVED, {
            tabId,
            realSessionId: realSessionId,
          })
          .catch((error) => {
            this.logger.error(
              'Failed to send session:id-resolved to webview',
              error instanceof Error ? error : new Error(String(error)),
            );
          });
      },
    );
  }

  /**
   * Setup callback to notify frontend when result message with stats is received
   */
  private setupResultStatsCallback(): void {
    this.sdkAdapter.setResultStatsCallback(async (stats) => {
      this.logger.info(`[RPC] Session stats received: ${stats.sessionId}`, {
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
        modelUsage: stats.modelUsage,
      });

      await this.sendStatsWithRetry(stats);
    });
  }

  /**
   * Setup callback to notify frontend when compaction starts
   * TASK_2025_098: SDK Session Compaction
   *
   * Unified flow: Routes compaction events through CHAT_CHUNK (same as streaming events)
   * instead of a separate SESSION_COMPACTING message type.
   * This ensures all streaming events flow through the same code path.
   */
  private setupCompactionStartCallback(): void {
    this.sdkAdapter.setCompactionStartCallback((data) => {
      this.logger.info(
        `[RPC] Compaction started: sessionId=${data.sessionId}, trigger=${data.trigger}`,
      );

      // Create a CompactionStartEvent to send through the unified streaming path
      const compactionEvent = {
        id: `compaction_${data.sessionId}_${data.timestamp}`,
        eventType: 'compaction_start' as const,
        timestamp: data.timestamp,
        sessionId: data.sessionId,
        messageId: `compaction_msg_${data.timestamp}`,
        trigger: data.trigger,
        source: 'stream' as const,
      };

      // Route through CHAT_CHUNK (same path as all other streaming events)
      // Frontend will process this through StreamingHandlerService
      this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          sessionId: data.sessionId,
          event: compactionEvent,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send compaction event to webview',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
  }

  /**
   * Setup callbacks to notify frontend when SDK creates or removes worktrees.
   * TASK_2025_236: Worktree Integration
   *
   * Posts `git:worktreeChanged` push notifications to the webview so the frontend
   * WorktreeService can refresh its worktree list and register new workspace folders.
   */
  private setupWorktreeCallbacks(): void {
    this.sdkAdapter.setWorktreeCreatedCallback(async (data) => {
      this.logger.info(
        `[RPC] Worktree created: name=${data.name}, sessionId=${data.sessionId}`,
      );

      // Resolve the actual worktree path by listing worktrees and matching by branch name.
      // The SDK hook only provides branch name + session cwd, not the worktree path.
      let worktreePath: string | undefined;
      try {
        const crossSpawn = await import('cross-spawn');
        const child = crossSpawn.default(
          'git',
          ['worktree', 'list', '--porcelain'],
          {
            cwd: data.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
        await new Promise<void>((resolve) =>
          child.on('close', () => resolve()),
        );
        const output = Buffer.concat(chunks).toString();
        const worktrees = parseWorktreeList(output);
        const match = worktrees.find((w) => w.branch === data.name);
        worktreePath = match?.path;
      } catch (err) {
        this.logger.warn(
          '[RPC] Failed to resolve worktree path for notification',
          err instanceof Error ? err : new Error(String(err)),
        );
      }

      this.webviewManager
        .broadcastMessage('git:worktreeChanged', {
          action: 'created',
          name: data.name,
          path: worktreePath,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send git:worktreeChanged (created) to webview',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });

    this.sdkAdapter.setWorktreeRemovedCallback((data) => {
      this.logger.info(
        `[RPC] Worktree removed: path=${data.worktreePath}, sessionId=${data.sessionId}`,
      );

      this.webviewManager
        .broadcastMessage('git:worktreeChanged', {
          action: 'removed',
          path: data.worktreePath,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send git:worktreeChanged (removed) to webview',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
  }

  /**
   * Send session stats to webview with retry logic
   */
  private async sendStatsWithRetry(stats: ResultStatsPayload): Promise<void> {
    try {
      await retryWithBackoff(
        () =>
          this.webviewManager.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
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
        '[RPC] Failed to send session:stats after all retries',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Setup listeners for agent session watcher events
   *
   * TASK_2025_100 FIX: Also listens for 'agent-start' events to send
   * agent_start streaming events BEFORE summary chunks arrive. This
   * fixes the race condition where summary chunks were buffered.
   */
  private setupAgentWatcherListeners(): void {
    // Type the agentWatcher for EventEmitter methods
    const watcher = this.agentWatcher as {
      on(
        event: 'summary-chunk',
        callback: (chunk: AgentSummaryChunk) => void,
      ): void;
      on(
        event: 'agent-start',
        callback: (event: AgentStartEvent) => void,
      ): void;
    };

    // Listen for summary chunks (existing behavior)
    watcher.on('summary-chunk', (chunk: AgentSummaryChunk) => {
      // DIAGNOSTIC: Log when we receive and forward summary chunks
      this.logger.info(
        '[RpcMethodRegistrationService] Received summary-chunk, forwarding to webview',
        {
          toolUseId: chunk.toolUseId,
          agentId: chunk.agentId, // TASK_2025_099: Stable key for summary lookup
          deltaLength: chunk.summaryDelta.length,
          deltaPreview: chunk.summaryDelta.slice(0, 50),
        },
      );

      // TASK_2025_099: Forward entire chunk including agentId for stable lookup
      this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.AGENT_SUMMARY_CHUNK, chunk)
        .then(() => {
          this.logger.info(
            '[RpcMethodRegistrationService] Summary-chunk sent to webview successfully',
            { toolUseId: chunk.toolUseId },
          );
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send agent summary chunk to webview',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });

    // TASK_2025_100 FIX: Listen for agent-start events and send as agent_start streaming event
    // This creates the agent node in the frontend BEFORE summary chunks arrive
    watcher.on('agent-start', (agentStartEvent: AgentStartEvent) => {
      this.logger.info(
        '[RpcMethodRegistrationService] Received agent-start event',
        {
          toolUseId: agentStartEvent.toolUseId,
          agentId: agentStartEvent.agentId, // TASK_2025_099: Stable key for summary lookup
          agentType: agentStartEvent.agentType,
          sessionId: agentStartEvent.sessionId,
        },
      );

      // Send as a CHAT_CHUNK with agent_start event type
      // This matches the format expected by streaming-handler.service.ts
      // Include sessionId for frontend to route to correct tab
      // TASK_2025_099: Include agentId for stable summary content lookup
      // TASK_2025_128 FIX: Include parentToolUseId for tree builder matching.
      // The toolUseId from the hook IS the parent Task tool's ID - this is what
      // the subagent hooks provide. Without parentToolUseId, collectTools() in
      // execution-tree-builder.service.ts can't find this agent_start event and
      // creates placeholder agents instead, causing duplicates.
      const streamingEvent = {
        id: `agent-start-${agentStartEvent.toolUseId}`,
        eventType: 'agent_start' as const,
        sessionId: agentStartEvent.sessionId, // Parent session for tab routing
        messageId: '',
        toolCallId: agentStartEvent.toolUseId,
        parentToolUseId: agentStartEvent.toolUseId, // TASK_2025_128: Link to parent Task tool
        agentType: agentStartEvent.agentType,
        agentDescription: agentStartEvent.agentDescription,
        timestamp: agentStartEvent.timestamp,
        source: 'hook' as const, // Mark as from hook (for duplicate detection)
        agentId: agentStartEvent.agentId, // Stable key for summary lookup
      };

      this.webviewManager
        .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          // TASK_2025_100: No tabId available from hook - frontend will resolve from sessionId
          sessionId: agentStartEvent.sessionId,
          event: streamingEvent,
        })
        .catch((error) => {
          this.logger.error(
            'Failed to send agent-start event to webview',
            error instanceof Error ? error : new Error(String(error)),
          );
        });

      // Also broadcast to setup wizard pipeline so the wizard's ExecutionTreeBuilder
      // can match agent_start events to Task tool nodes during analysis.
      // Without this, wizard sessions that spawn sub-agents show "No agent_start match"
      // because agent_start events were only sent through CHAT_CHUNK.
      const wizardStreamPayload: AnalysisStreamPayload = {
        kind: 'status',
        content: `Agent started: ${agentStartEvent.agentType ?? 'unknown'}`,
        timestamp: agentStartEvent.timestamp,
        flatEvent: streamingEvent as FlatStreamEventUnion,
      };

      this.webviewManager
        .broadcastMessage(
          MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM,
          wizardStreamPayload,
        )
        .catch((error) => {
          this.logger.debug(
            'Failed to send agent-start to wizard pipeline (wizard may not be active)',
            { error: error instanceof Error ? error.message : String(error) },
          );
        });
    });
  }

  /**
   * Register VS Code command for launching setup wizard
   */
  private registerSetupAgentsCommand(): void {
    try {
      this.commandManager.registerCommand({
        id: 'ptah.setupAgents',
        title: 'Setup Ptah Agents',
        category: 'Ptah',
        handler: async () => {
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

          if (!workspaceFolder) {
            vscode.window.showErrorMessage(
              'No workspace open. Please open a folder first.',
            );
            return;
          }

          try {
            const setupWizardService = this.container.resolve(
              AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE,
            ) as {
              launchWizard: (workspacePath: string) => Promise<{
                isErr?: () => boolean;
                error?: { message: string };
              }>;
            };

            const result = await setupWizardService.launchWizard(
              workspaceFolder.uri.fsPath,
            );

            if (result.isErr && result.isErr()) {
              vscode.window.showErrorMessage(
                `Failed to launch setup wizard: ${result.error?.message}`,
              );
            }
          } catch (error) {
            this.logger.error(
              'Failed to launch setup wizard',
              error instanceof Error ? error : new Error(String(error)),
            );
            vscode.window.showErrorMessage(
              `Failed to launch setup wizard: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
            );
          }
        },
      });

      this.logger.info('Setup agents command registered');
    } catch (error) {
      // Command may already be registered by another instance of the extension
      // (e.g., marketplace version running alongside dev build). Log and continue
      // instead of crashing activation.
      this.logger.warn(
        'Setup agents command registration skipped (likely already registered)',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }
}
