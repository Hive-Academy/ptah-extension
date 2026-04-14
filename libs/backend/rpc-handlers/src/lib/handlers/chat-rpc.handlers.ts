/**
 * Chat RPC Handlers
 *
 * Handles chat-related RPC methods: chat:start, chat:continue, chat:abort
 * Manages SDK session lifecycle and streaming ExecutionNodes to webview.
 *
 * TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService
 * TASK_2025_203: Moved to @ptah-extension/rpc-handlers (replaced vscode.workspace.workspaceFolders with IWorkspaceProvider)
 */

import { injectable, inject } from 'tsyringe';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  Logger,
  RpcHandler,
  TOKENS,
  ConfigManager,
  SubagentRegistryService,
  LicenseService,
  AgentSessionWatcherService,
  isPremiumTier,
} from '@ptah-extension/vscode-core';
import {
  SdkAgentAdapter,
  SessionHistoryReaderService,
  SessionMetadataStore,
  SDK_TOKENS,
  PluginLoaderService,
  PtahCliRegistry,
  SlashCommandInterceptor,
  DEFAULT_FALLBACK_MODEL_ID,
  type EnhancedPromptsService,
} from '@ptah-extension/agent-sdk';

import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  SessionId,
  FlatStreamEventUnion,
  BackgroundAgentCompletedEvent,
  BackgroundAgentStartedEvent,
  AISessionConfig,
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatAbortParams,
  ChatAbortResult,
  ChatRunningAgentsParams,
  ChatRunningAgentsResult,
  ChatResumeParams,
  ChatResumeResult,
  MESSAGE_TYPES,
  AgentId,
  type CliSessionReference,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';

interface WebviewManager {
  sendMessage(viewType: string, type: string, payload: unknown): Promise<void>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

/**
 * RPC handlers for chat operations (SDK-based)
 */
@injectable()
export class ChatRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(SDK_TOKENS.SDK_ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(TOKENS.AGENT_SESSION_WATCHER_SERVICE)
    private readonly agentSessionWatcher: AgentSessionWatcherService,
    @inject(SDK_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR)
    private readonly slashCommandInterceptor: SlashCommandInterceptor,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Checks if the MCP server is currently running (TASK_2025_108)
   * Uses CodeExecutionMCP.getPort() - non-null means server is running
   *
   * @returns true if MCP server is available
   */
  private isMcpServerRunning(): boolean {
    return this.codeExecutionMcp.getPort() !== null;
  }

  /**
   * Detect clear stop/cancel intent in a user message.
   *
   * Used in autopilot mode to decide whether to interrupt the current turn.
   * Conservative matching — only triggers on unambiguous stop phrases to avoid
   * false positives on steering messages like "stop using semicolons" or
   * "cancel the old approach and try X instead".
   *
   * Patterns matched:
   * - Standalone commands: "stop", "cancel", "abort", "halt", "quit"
   * - Polite variants: "please stop", "stop please", "stop now"
   * - Targeted: "stop it", "stop this", "stop that", "stop execution"
   * - Descriptive: "stop what you're doing", "don't continue"
   */
  static hasStopIntent(message: string): boolean {
    const trimmed = message.trim().toLowerCase();

    // Standalone stop words (entire message is just a stop command)
    // [.!]* allows multiple punctuation: "stop!!!", "cancel!!", "abort."
    if (
      /^(stop|cancel|abort|halt|quit|enough|nevermind|nvm)[.!]*$/.test(trimmed)
    ) {
      return true;
    }

    // Short messages (≤60 chars) with clear stop phrases.
    // Length gate avoids false positives in longer steering messages like
    // "stop using semicolons and switch to the new API pattern".
    if (trimmed.length <= 60) {
      const stopPhrases = [
        // "stop", "please stop", "stop now", "stop it", etc. — must be at end of message
        /\b(please\s+)?(stop|cancel|abort|halt)\s*(please|now|it|this|that|execution|running|everything|immediately)?[.!]*$/,
        // "stop what you're doing"
        /\bstop\s+what\s+you'?re?\s+(doing|running)/,
        // "don't continue" — must be at end to avoid "don't continue with X, do Y instead"
        /\bdon'?t\s+continue[.!]*$/,
        // "stop the execution/agent/process"
        /\bstop\s+the\s+(execution|agent|process|task)/,
      ];
      return stopPhrases.some((pattern) => pattern.test(trimmed));
    }

    return false;
  }

  /**
   * Check if a subagent's transcript file exists on disk.
   * Without a transcript, the SDK cannot resume the subagent.
   *
   * Looks in: {projectDir}/{parentSessionId}/subagents/agent-{agentId}.jsonl
   */
  private async hasSubagentTranscript(
    workspacePath: string,
    parentSessionId: string,
    agentId: string,
  ): Promise<boolean> {
    try {
      const homeDir = os.homedir();
      const projectsDir = path.join(homeDir, '.claude', 'projects');
      const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

      // Try exact match, lowercase match, and normalized match for project dir.
      // Claude CLI may normalize path separators differently (e.g., replacing _ with -)
      // so "d--projects-brand_force" should match "d--projects-brand-force" on disk.
      // Must match the same logic as JsonlReaderService.findSessionsDirectory().
      const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
      const dirs = await fs.readdir(projectsDir);
      const projectDir =
        dirs.find((d) => d === escapedPath) ??
        dirs.find((d) => d.toLowerCase() === escapedPath.toLowerCase()) ??
        dirs.find((d) => normalize(d) === normalize(escapedPath));

      if (!projectDir) return false;

      const transcriptPath = path.join(
        projectsDir,
        projectDir,
        parentSessionId,
        'subagents',
        `agent-${agentId}.jsonl`,
      );

      await fs.access(transcriptPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve enhanced prompt content for premium users (TASK_2025_151)
   *
   * Returns the AI-generated enhanced prompt content if available and enabled,
   * or undefined to fall back to default behavior.
   *
   * @param workspacePath - Workspace path to resolve prompt for
   * @param isPremium - Whether the user has premium features
   * @returns Enhanced prompt content string, or undefined on error/disabled/non-premium
   */
  private async resolveEnhancedPromptsContent(
    workspacePath: string | undefined,
    isPremium: boolean,
  ): Promise<string | undefined> {
    if (!isPremium || !workspacePath) {
      return undefined;
    }

    try {
      const content =
        await this.enhancedPromptsService.getEnhancedPromptContent(
          workspacePath,
        );
      return content ?? undefined;
    } catch (error) {
      this.logger.debug(
        'Failed to resolve enhanced prompts content, using fallback',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }

  /**
   * Resolve plugin paths for premium users (TASK_2025_153)
   *
   * Reads workspace plugin configuration and resolves to absolute paths.
   * Only returns paths for premium users. Non-premium users get no plugins.
   *
   * @param isPremium - Whether the user has premium features
   * @returns Resolved plugin directory paths, or undefined if none
   */
  private resolvePluginPaths(isPremium: boolean): string[] | undefined {
    if (!isPremium) {
      return undefined;
    }

    try {
      const config = this.pluginLoader.getWorkspacePluginConfig();
      if (!config.enabledPluginIds || config.enabledPluginIds.length === 0) {
        return undefined;
      }
      const paths = this.pluginLoader.resolvePluginPaths(
        config.enabledPluginIds,
      );
      if (paths.length === 0) {
        return undefined;
      }
      this.logger.debug('Resolved plugin paths for session', {
        enabledCount: config.enabledPluginIds.length,
        resolvedCount: paths.length,
      });
      return paths;
    } catch (error) {
      this.logger.debug('Failed to resolve plugin paths', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Track which sessions are owned by Ptah CLI adapters.
   * Maps sessionId (or tabId used as sessionId) -> ptahCliId.
   * Used by chat:continue and chat:abort to delegate to the correct adapter.
   */
  private ptahCliSessions = new Map<string, string>();

  /**
   * Maps tabId -> real SDK session UUID for Ptah CLI sessions.
   * Populated in streamExecutionNodesToWebview when the SDK UUID is resolved.
   * Used to set sdkSessionId on CliSessionReference for cross-referencing
   * in SessionImporterService.
   */
  private ptahCliSdkSessionIds = new Map<string, string>();

  // ============================================================================
  // PTAH CLI DISPATCH METHODS (TASK_2025_167)
  // ============================================================================

  /**
   * Handle chat:start for Ptah CLI sessions.
   *
   * Gets the adapter from PtahCliRegistry, starts a chat session,
   * and streams events to the webview using the same streaming mechanism
   * as the main SdkAgentAdapter.
   */
  private async handlePtahCliStart(
    params: ChatStartParams,
  ): Promise<ChatStartResult> {
    const { prompt, tabId, workspacePath, options, name } = params;
    const agentId = params.ptahCliId as string; // Guaranteed non-null by caller

    this.logger.info('[RPC] chat:start - Ptah CLI dispatch', {
      tabId,
      ptahCliId: agentId,
      workspacePath,
    });

    // Get the adapter from the registry
    const adapter = await this.ptahCliRegistry.getAdapter(agentId);
    if (!adapter) {
      this.logger.error(`[RPC] Ptah CLI adapter not found: ${agentId}`);
      return {
        success: false,
        error: `Ptah CLI agent not found or not configured: ${agentId}`,
      };
    }

    // Resolve premium capabilities (same as main SDK adapter path)
    const licenseStatus = await this.licenseService.verifyLicense();
    const isPremium = isPremiumTier(licenseStatus);
    const mcpServerRunning = this.isMcpServerRunning();

    this.logger.info('[RPC] chat:start - Ptah CLI premium config', {
      tabId,
      ptahCliId: agentId,
      isPremium,
      mcpServerRunning,
    });

    // Register MCP server for subagent discovery (premium only)
    if (isPremium && mcpServerRunning) {
      this.codeExecutionMcp.ensureRegisteredForSubagents();
    }

    // Resolve enhanced prompts and plugins for premium users
    const enhancedPromptsContent = await this.resolveEnhancedPromptsContent(
      workspacePath,
      isPremium,
    );
    const pluginPaths = this.resolvePluginPaths(isPremium);

    // Start the Ptah CLI session with full premium capabilities
    // NOTE: Don't pass options.model here — it comes from the main Claude model
    // selector (e.g. "claude-sonnet-4-5-20250929") which is irrelevant for custom
    // agents. The adapter's resolveModel() will use its own config:
    // selectedModel → tierMappings → provider defaults.
    const stream = await adapter.startChatSession({
      tabId,
      workspaceId: workspacePath,
      systemPrompt: options?.systemPrompt,
      projectPath: workspacePath,
      name,
      prompt,
      files: options?.files,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      pluginPaths,
      thinking: options?.thinking, // TASK_2025_184: Reasoning configuration
      effort: options?.effort, // TASK_2025_184: Effort level
    });

    // Track this session as belonging to the Ptah CLI agent
    // Use tabId as the initial session key (real sessionId comes later via stream events)
    this.ptahCliSessions.set(tabId, agentId);

    // Stream events to webview using the same mechanism as the main adapter
    this.streamExecutionNodesToWebview(tabId as SessionId, stream, tabId);

    this.logger.info('[RPC] chat:start - Ptah CLI session started', {
      tabId,
      ptahCliId: agentId,
      agentName: adapter.info.name,
    });

    return { success: true };
  }

  /**
   * Handle chat:continue for Ptah CLI sessions.
   *
   * Checks if the session belongs to a Ptah CLI agent and delegates
   * message sending to the correct adapter.
   */
  private async handlePtahCliContinue(
    params: ChatContinueParams,
  ): Promise<ChatContinueResult> {
    const { prompt, sessionId, tabId } = params;
    const ptahCliAgentId =
      this.ptahCliSessions.get(sessionId as string) ||
      this.ptahCliSessions.get(tabId);

    if (!ptahCliAgentId) {
      // Not a Ptah CLI session - caller should fall through to main adapter
      return { success: false, error: '__NOT_PTAH_CLI__' };
    }

    this.logger.info('[RPC] chat:continue - Ptah CLI dispatch', {
      sessionId,
      tabId,
      ptahCliAgentId,
    });

    const adapter = await this.ptahCliRegistry.getAdapter(ptahCliAgentId);
    if (!adapter) {
      this.logger.error(
        `[RPC] Ptah CLI adapter not found for continue: ${ptahCliAgentId}`,
      );
      return {
        success: false,
        error: `Ptah CLI agent not found: ${ptahCliAgentId}`,
      };
    }

    // Ensure MCP server is registered for subagent discovery (premium only)
    if (this.isMcpServerRunning()) {
      const licenseCheck = await this.licenseService.verifyLicense();
      if (isPremiumTier(licenseCheck)) {
        this.codeExecutionMcp.ensureRegisteredForSubagents();
      }
    }

    // Check if the session needs to be resumed first
    const health = adapter.getHealth();
    if (health.status !== 'available') {
      this.logger.warn(
        `[RPC] Ptah CLI adapter not available for continue: ${ptahCliAgentId}`,
        { status: health.status },
      );
      return {
        success: false,
        error: `Ptah CLI agent not available: ${
          health.errorMessage || health.status
        }`,
      };
    }

    // Send message to the existing session
    const files = params.files ?? [];
    await adapter.sendMessageToSession(sessionId, prompt, { files });

    return { success: true, sessionId };
  }

  /**
   * Handle chat:abort for Ptah CLI sessions.
   */
  private async handlePtahCliAbort(
    params: ChatAbortParams,
  ): Promise<ChatAbortResult> {
    const { sessionId } = params;
    const ptahCliAgentId = this.ptahCliSessions.get(sessionId as string);

    if (!ptahCliAgentId) {
      // Not a Ptah CLI session
      return { success: false, error: '__NOT_PTAH_CLI__' };
    }

    this.logger.info('[RPC] chat:abort - Ptah CLI dispatch', {
      sessionId,
      ptahCliAgentId,
    });

    const adapter = await this.ptahCliRegistry.getAdapter(ptahCliAgentId);
    if (adapter) {
      adapter.endSession(sessionId);
    }

    // TASK_2025_175: Stop all agent session watchers for Ptah CLI sessions too
    this.agentSessionWatcher.stopAllForSession(sessionId as string);

    // Clean up tracking
    this.ptahCliSessions.delete(sessionId as string);

    return { success: true };
  }

  /**
   * Get the resolved SDK session UUID for a Ptah CLI session.
   * Used by persistCliSessionReference to set sdkSessionId on CliSessionReference.
   */
  getPtahCliSdkSessionId(tabId: string): string | undefined {
    return this.ptahCliSdkSessionIds.get(tabId);
  }

  /**
   * Track a Ptah CLI session by its real session ID.
   * Called when SESSION_ID_RESOLVED is received for a Ptah CLI session.
   */
  trackPtahCliSession(tabId: string, realSessionId: string): void {
    const ptahCliAgentId = this.ptahCliSessions.get(tabId);
    if (ptahCliAgentId) {
      // Also map the real session ID to the Ptah CLI agent
      this.ptahCliSessions.set(realSessionId, ptahCliAgentId);
      this.logger.debug('[RPC] Ptah CLI session ID tracked', {
        tabId,
        realSessionId,
        ptahCliAgentId,
      });
    }
  }

  /**
   * Register all chat RPC methods
   */
  register(): void {
    this.registerChatStart();
    this.registerChatContinue();
    this.registerChatResume();
    this.registerChatAbort();
    this.registerChatRunningAgents();
    this.registerBackgroundAgentHandlers();
    this.subscribeToBackgroundAgentEvents();

    this.logger.debug('Chat RPC handlers registered', {
      methods: [
        'chat:start',
        'chat:continue',
        'chat:resume',
        'chat:abort',
        'chat:running-agents',
        'agent:backgroundList',
        'agent:backgroundStop',
      ],
    });
  }

  /**
   * chat:start - Start new SDK session
   * Now uses tabId for frontend correlation instead of placeholder sessionId
   */
  private registerChatStart(): void {
    this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
      'chat:start',
      async (params) => {
        try {
          const { prompt, tabId, options, name } = params;
          // Resolve workspace path: prefer frontend-provided value, fall back to
          // IWorkspaceProvider (platform-aware). Never rely on process.cwd() which
          // returns the app installation directory in VS Code/Electron.
          const workspacePath =
            params.workspacePath ||
            this.workspaceProvider.getWorkspaceRoot() ||
            '';
          this.logger.debug('RPC: chat:start called', {
            tabId,
            workspacePath,
            sessionName: name,
            ptahCliId: params.ptahCliId,
          });

          // TASK_2025_167: Ptah CLI dispatch
          // If ptahCliId is set, delegate to the Ptah CLI adapter
          if (params.ptahCliId) {
            return await this.handlePtahCliStart(params);
          }

          // TASK_2025_184: Intercept native slash commands on initial message
          // For 'new-query' and 'passthrough', the existing flow handles them
          // (SDK parses slash commands natively from string prompts in query())
          const interceptResult = prompt
            ? this.slashCommandInterceptor.intercept(prompt)
            : { action: 'passthrough' as const };

          if (interceptResult.action === 'native') {
            this.logger.info('[RPC] chat:start - native command intercepted', {
              command: interceptResult.commandName,
            });

            if (interceptResult.commandName === 'clear') {
              // /clear as first message = no-op (fresh session anyway)
              await this.webviewManager.broadcastMessage(
                MESSAGE_TYPES.CHAT_COMPLETE,
                {
                  tabId,
                  command: 'clear',
                  message: 'Starting fresh conversation.',
                },
              );
              return { success: true };
            }

            // Other native commands — no-op on fresh session
            this.logger.warn('[RPC] chat:start - unrecognized native command', {
              command: interceptResult.commandName,
            });
            return { success: true };
          }

          // TASK_2025_108: Get license status for premium feature gating
          const licenseStatus = await this.licenseService.verifyLicense();
          const isPremium = isPremiumTier(licenseStatus);
          const mcpServerRunning = this.isMcpServerRunning();

          this.logger.info('[ptah.main] chat:start - session config', {
            tier: licenseStatus.tier,
            isPremium,
            mcpServerRunning,
            mcpPort: this.codeExecutionMcp.getPort(),
          });

          // Register MCP server in .mcp.json for subagent discovery (premium only)
          if (isPremium && mcpServerRunning) {
            this.codeExecutionMcp.ensureRegisteredForSubagents();
          }

          // TASK_2025_151: Resolve enhanced prompt content for premium users
          const enhancedPromptsContent =
            await this.resolveEnhancedPromptsContent(workspacePath, isPremium);

          // TASK_2025_153: Resolve plugin paths for premium users
          const pluginPaths = this.resolvePluginPaths(isPremium);

          this.logger.info('[ptah.main] chat:start - prompt config', {
            hasEnhancedPrompts: !!enhancedPromptsContent,
            enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
            pluginCount: pluginPaths?.length ?? 0,
          });

          // Get current model: prefer frontend-provided model, then config, then hardcoded fallback
          const currentModel =
            options?.model ||
            this.configManager.get<string>('model.selected') ||
            'default';

          // TASK_2025_093: tabId is now the primary tracking key
          // SDK generates real UUID in system init message
          const files = options?.files ?? [];

          // Log files received for debugging (Phase 2)
          if (files.length > 0) {
            this.logger.debug('RPC: chat:start received files', {
              tabId,
              fileCount: files.length,
              files,
            });
          }

          // TASK_2025_181: SDK handles slash commands natively when receiving string prompts.
          // No need to expand plugin commands manually — SDK resolves them via pluginPaths.

          // Start SDK session with streaming ExecutionNode output
          // TASK_2025_093: Single config argument with tabId as primary tracking key
          // Prompt and files are now passed in config, not via separate sendMessageToSession
          // TASK_2025_108: Pass isPremium and mcpServerRunning for premium feature gating (MCP + system prompt)
          const images = options?.images ?? [];
          const stream = await this.sdkAdapter.startChatSession({
            tabId, // REQUIRED: Primary tracking key for multi-tab isolation
            workspaceId: workspacePath,
            model: options?.model || currentModel,
            systemPrompt: options?.systemPrompt,
            projectPath: workspacePath,
            name,
            prompt, // TASK_2025_181: Pass raw prompt — SDK handles slash commands natively
            files,
            images, // TASK_2025_176: Inline pasted/dropped images
            isPremium, // TASK_2025_108: Enable premium features for licensed users
            mcpServerRunning, // TASK_2025_108: MCP server availability check
            enhancedPromptsContent, // TASK_2025_151: AI-generated system prompt for premium users
            pluginPaths, // TASK_2025_153: Plugin directory paths for SDK
            thinking: options?.thinking, // TASK_2025_184: Reasoning configuration
            effort: options?.effort, // TASK_2025_184: Effort level
          });

          // Stream ExecutionNodes to webview (background - don't await)
          // Pass tabId so events can be routed to correct frontend tab
          this.streamExecutionNodesToWebview(tabId as SessionId, stream, tabId);

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: chat:start failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * chat:continue - Send message to existing session (with auto-resume)
   * Now includes tabId for event routing
   */
  private registerChatContinue(): void {
    this.rpcHandler.registerMethod<ChatContinueParams, ChatContinueResult>(
      'chat:continue',
      async (params) => {
        try {
          const { prompt, sessionId, tabId, name } = params;
          // Resolve workspace path: prefer frontend-provided value, fall back to
          // IWorkspaceProvider (platform-aware). Mirrors chat:start resolution.
          const workspacePath =
            params.workspacePath ||
            this.workspaceProvider.getWorkspaceRoot() ||
            '';
          this.logger.debug('RPC: chat:continue called', {
            sessionId,
            tabId,
            sessionName: name,
          });

          // TASK_2025_167: Check if this is a Ptah CLI session
          const ptahCliResult = await this.handlePtahCliContinue(params);
          if (ptahCliResult.error !== '__NOT_PTAH_CLI__') {
            return ptahCliResult;
          }

          // Ensure MCP server is registered in .mcp.json for subagent discovery (premium only)
          // Must run outside the resume block — active sessions also spawn subagents
          if (this.isMcpServerRunning()) {
            const licenseCheck = await this.licenseService.verifyLicense();
            if (isPremiumTier(licenseCheck)) {
              this.codeExecutionMcp.ensureRegisteredForSubagents();
            }
          }

          // Track whether we just resumed — if so, there's no active turn to interrupt
          let justResumed = false;

          // Check if session is active in memory
          if (!this.sdkAdapter.isSessionActive(sessionId)) {
            this.logger.info(
              `[RPC] Session ${sessionId} not active, attempting resume...`,
            );

            // TASK_2025_108: Get license status for premium feature gating in resumed sessions
            const licenseStatus = await this.licenseService.verifyLicense();
            const isPremium = isPremiumTier(licenseStatus);
            const mcpServerRunning = this.isMcpServerRunning();

            this.logger.info(
              '[ptah.main] chat:continue resume - session config',
              {
                tier: licenseStatus.tier,
                isPremium,
                mcpServerRunning,
                mcpPort: this.codeExecutionMcp.getPort(),
                sessionId,
              },
            );

            // TASK_2025_151: Resolve enhanced prompt content for premium users
            const enhancedPromptsContent =
              await this.resolveEnhancedPromptsContent(
                workspacePath,
                isPremium,
              );

            // TASK_2025_153: Resolve plugin paths for premium users
            const pluginPaths = this.resolvePluginPaths(isPremium);

            this.logger.info(
              '[ptah.main] chat:continue resume - prompt config',
              {
                hasEnhancedPrompts: !!enhancedPromptsContent,
                enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
                pluginCount: pluginPaths?.length ?? 0,
              },
            );

            // Get current model: prefer frontend-provided model, then config, then hardcoded fallback
            const currentModel =
              params.model ||
              this.configManager.getWithDefault<string>(
                'model.selected',
                DEFAULT_FALLBACK_MODEL_ID,
              );

            // Resume the session to reconnect to Claude's conversation context
            // TASK_2025_108: Pass isPremium and mcpServerRunning to maintain premium features in resumed sessions
            // TASK_2025_151: Pass enhancedPromptsContent for AI-generated system prompt
            // TASK_2025_153: Pass pluginPaths for session plugin loading
            const stream = await this.sdkAdapter.resumeSession(sessionId, {
              projectPath: workspacePath,
              model: currentModel,
              isPremium,
              mcpServerRunning,
              enhancedPromptsContent,
              pluginPaths,
              tabId,
              thinking: params.thinking, // TASK_2025_184: Reasoning configuration
              effort: params.effort, // TASK_2025_184: Effort level
            });

            // Start streaming responses to webview (background - don't await)
            // Pass tabId for event routing
            this.streamExecutionNodesToWebview(sessionId, stream, tabId);

            this.logger.info(`[RPC] Session ${sessionId} resumed successfully`);
            justResumed = true;
          }

          // Extract files from params for debugging (Phase 2)
          const files = params.files ?? [];
          if (files.length > 0) {
            this.logger.debug('RPC: chat:continue received files', {
              sessionId,
              tabId,
              fileCount: files.length,
              files,
            });
          }

          // TASK_2025_181: SDK handles slash commands natively when receiving string prompts.
          // No need to expand plugin commands manually — SDK resolves them via pluginPaths.

          // TASK_2025_184: Intercept slash commands BEFORE subagent context injection.
          // Slash commands (native + new-query) don't need subagent context, and running
          // subagent logic first causes data loss — agents get removed from the registry
          // even though the enhanced prompt is discarded by the command handler.
          const slashResult = await this.handleFollowUpSlashCommand(
            prompt,
            sessionId,
            tabId,
            workspacePath,
            params,
          );
          if (slashResult) {
            return slashResult;
          }

          // TASK_2025_109: Inject interrupted subagent context into prompt
          // This enables Claude to automatically resume interrupted agents
          // instead of requiring user to know agent IDs or click Resume buttons.
          // NOTE: Slash commands are already handled above (early return via handleFollowUpSlashCommand),
          // so this block only runs for regular messages — no need for isSlashCommand guard.
          let enhancedPrompt = prompt;
          const allResumable =
            this.subagentRegistry.getResumableBySession(sessionId);

          // DIAGNOSTIC: Log registry state for debugging context injection
          this.logger.info(
            'RPC: chat:continue - subagent context injection check',
            {
              sessionId,
              registrySize: this.subagentRegistry.size,
              allResumableCount: allResumable.length,
              allResumableAgents: allResumable.map((s) => ({
                toolCallId: s.toolCallId,
                agentId: s.agentId,
                agentType: s.agentType,
                status: s.status,
                parentSessionId: s.parentSessionId,
              })),
              workspacePath,
            },
          );

          // Filter to only agents whose transcript files exist on disk.
          // Without a transcript, the SDK can't resume — it reports "transcript was lost".
          const resumableSubagents: typeof allResumable = [];
          for (const s of allResumable) {
            const hasTranscript = workspacePath
              ? await this.hasSubagentTranscript(
                  workspacePath,
                  sessionId,
                  s.agentId,
                )
              : false;
            if (hasTranscript) {
              resumableSubagents.push(s);
            } else {
              this.logger.warn(
                'RPC: chat:continue - skipping agent without transcript on disk',
                { agentId: s.agentId, agentType: s.agentType, sessionId },
              );
              // Remove from registry — can't resume without transcript
              this.subagentRegistry.remove(s.toolCallId);
            }
          }

          // Proactively start file watchers for resumable subagents.
          // Without this, only subagents newly spawned by the SDK get watchers
          // via SubagentStart hooks. Resumed subagents may start writing before
          // a hook fires, so we set up watchers preemptively.
          if (resumableSubagents.length > 0 && workspacePath) {
            for (const subagent of resumableSubagents) {
              try {
                await this.agentSessionWatcher.startWatching(
                  subagent.agentId,
                  sessionId,
                  workspacePath,
                  subagent.agentType,
                  subagent.toolCallId,
                );
              } catch (err) {
                this.logger.warn(
                  'Failed to start proactive watcher for resumable subagent',
                  {
                    agentId: subagent.agentId,
                    error: err instanceof Error ? err.message : String(err),
                  },
                );
              }
            }
          }

          if (resumableSubagents.length > 0) {
            // Build detailed agent context with actionable instructions
            const agentDetails = resumableSubagents
              .map((s) => {
                const interruptedAgo = s.interruptedAt
                  ? Math.round((Date.now() - s.interruptedAt) / 1000 / 60)
                  : 0;
                return `  - ${s.agentType} agent (agentId: ${s.agentId})${
                  interruptedAgo > 0
                    ? ` - interrupted ${interruptedAgo} min ago`
                    : ''
                }`;
              })
              .join('\n');

            // Instructive context that tells Claude WHAT to do, not just what exists
            // Uses agentId (short hex) which the SDK uses to identify the subagent for resumption
            const contextPrefix = `[SYSTEM CONTEXT - INTERRUPTED AGENTS]
The following subagent(s) were interrupted and did not complete their work:
${agentDetails}

IMPORTANT INSTRUCTIONS:
1. Your FIRST action should be to resume these interrupted agents using the Task tool with the "resume" parameter set to the agentId shown above (e.g., resume: "${resumableSubagents[0].agentId}").
2. Resume agents in the order they were interrupted (continue their previous work).
3. After resuming completes, address the user's current message if it requires additional work.
4. If the user explicitly asks to start fresh or work on something completely unrelated, you may skip resumption and acknowledge the interrupted work was abandoned.

[END SYSTEM CONTEXT]

`;
            enhancedPrompt = contextPrefix + prompt;

            this.logger.info('RPC: chat:continue - injected subagent context', {
              sessionId,
              resumableCount: resumableSubagents.length,
              agents: resumableSubagents.map((s) => ({
                agentId: s.agentId,
                agentType: s.agentType,
                parentSessionId: s.parentSessionId,
              })),
            });

            // TASK_2025_109 FIX: Remove injected subagents from registry to prevent
            // re-injection on subsequent messages. The context is a one-shot injection;
            // once Claude receives the resumption instructions, we don't need to send them again.
            // TASK_2025_213 FIX: Mark as injected BEFORE removing so that
            // registerFromHistoryEvents() skips these on session reload.
            for (const s of resumableSubagents) {
              this.subagentRegistry.markAsInjected(s.toolCallId);
              this.subagentRegistry.remove(s.toolCallId);
            }
          }

          // AUTOPILOT STOP-INTENT INTERRUPT: In yolo/auto-edit mode, tool calls are
          // auto-approved so the user has no checkpoint to stop the agent via tool denial.
          // When the user sends a message with clear stop intent (e.g., "stop", "cancel"),
          // interrupt the current turn so the SDK actually stops.
          // Regular steering messages ("also update tests") pass through normally via
          // streamInput() without interrupting — preserving the steering workflow.
          // Skip if we just resumed — there's no active turn to interrupt.
          if (!justResumed && ChatRpcHandlers.hasStopIntent(prompt)) {
            const autopilotEnabled = this.configManager.getWithDefault<boolean>(
              'autopilot.enabled',
              false,
            );
            const permissionLevel = this.configManager.getWithDefault<string>(
              'autopilot.permissionLevel',
              'ask',
            );
            if (
              autopilotEnabled &&
              (permissionLevel === 'yolo' || permissionLevel === 'auto-edit')
            ) {
              this.logger.info(
                'RPC: chat:continue - stop intent detected, interrupting current turn',
                { sessionId, permissionLevel, prompt: prompt.substring(0, 80) },
              );
              await this.sdkAdapter.interruptCurrentTurn(sessionId);
            }
          }

          // Send the message to the session (existing flow).
          // Even after an interrupt, we still send the message: the interrupt stops the
          // current assistant turn, and this message starts a new turn. The agent sees
          // the user's "stop" message and can respond acknowledging it, rather than
          // leaving the session in an ambiguous state with no user context.
          const images = params.images ?? [];
          await this.sdkAdapter.sendMessageToSession(
            sessionId,
            enhancedPrompt,
            {
              files,
              images,
            },
          );

          return { success: true, sessionId };
        } catch (error) {
          this.logger.error(
            'RPC: chat:continue failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Handle follow-up slash commands by intercepting and routing them.
   * Returns a result if the command was handled, or null for passthrough.
   *
   * Extracted from registerChatContinue to reduce method complexity and
   * ensure slash commands are intercepted BEFORE subagent context injection.
   * @see TASK_2025_184
   */
  private async handleFollowUpSlashCommand(
    prompt: string,
    sessionId: SessionId,
    tabId: string,
    workspacePath: string | undefined,
    params: ChatContinueParams,
  ): Promise<ChatContinueResult | null> {
    const interceptResult = this.slashCommandInterceptor.intercept(prompt);

    if (interceptResult.action === 'passthrough') {
      return null; // Not a slash command, caller continues with normal flow
    }

    if (interceptResult.action === 'native') {
      this.logger.info('[RPC] chat:continue - native command intercepted', {
        command: interceptResult.commandName,
        sessionId,
      });

      if (interceptResult.commandName === 'clear') {
        // End the current session, frontend handles reset
        await this.sdkAdapter.interruptSession(sessionId);
        // Stop all agent session watchers (same as chat:abort)
        this.agentSessionWatcher.stopAllForSession(sessionId as string);

        await this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            tabId,
            sessionId,
            command: 'clear',
            message:
              'Conversation cleared. Start a new message to begin fresh.',
          },
        );
        return { success: true, sessionId };
      }

      // Other native commands — not yet implemented
      this.logger.warn('[RPC] chat:continue - unrecognized native command', {
        command: interceptResult.commandName,
        sessionId,
      });
      return { success: true, sessionId };
    }

    if (interceptResult.action === 'new-query') {
      this.logger.info(
        '[RPC] chat:continue - SDK slash command intercepted, starting new query',
        {
          command: interceptResult.rawCommand,
          sessionId,
        },
      );

      // Resolve premium config for the new query
      const licenseStatus = await this.licenseService.verifyLicense();
      const isPremium = isPremiumTier(licenseStatus);
      const mcpServerRunning = this.isMcpServerRunning();
      const enhancedPromptsContent = await this.resolveEnhancedPromptsContent(
        workspacePath,
        isPremium,
      );
      const pluginPaths = this.resolvePluginPaths(isPremium);

      // TASK_2025_184: Use rawCommand with fallback — safe regardless of whether
      // SlashCommandResult uses discriminated union or optional rawCommand
      const command = interceptResult.rawCommand ?? prompt;

      // Execute the slash command as a new query with resume
      const stream = await this.sdkAdapter.executeSlashCommand(
        sessionId,
        command,
        {
          sessionConfig: {
            model:
              params.model ||
              this.configManager.getWithDefault<string>(
                'model.selected',
                DEFAULT_FALLBACK_MODEL_ID,
              ),
            projectPath: workspacePath,
          } as AISessionConfig,
          isPremium,
          mcpServerRunning,
          enhancedPromptsContent,
          pluginPaths,
          tabId,
        },
      );

      // Reconnect streaming to the frontend
      this.streamExecutionNodesToWebview(sessionId, stream, tabId);

      return { success: true, sessionId };
    }

    return null;
  }

  /**
   * chat:resume - Load session history from JSONL files
   *
   * Used when user clicks a session from sidebar to load conversation history.
   * Returns full streaming events for building ExecutionNode tree with tool calls.
   *
   * TASK_2025_092 FIX: Now returns `events` array with FlatStreamEventUnion
   * including tool_start, tool_result, thinking, agent_start events.
   * Frontend processes these through StreamingHandler to build execution tree.
   *
   * Also returns `messages` for backward compatibility (deprecated).
   */
  private registerChatResume(): void {
    this.rpcHandler.registerMethod<ChatResumeParams, ChatResumeResult>(
      'chat:resume',
      async (params) => {
        try {
          const { sessionId } = params;
          // Resolve workspace path: prefer frontend-provided, fall back to
          // IWorkspaceProvider (platform-aware). Mirrors chat:start/continue.
          const resolvedWorkspacePath =
            params.workspacePath ||
            this.workspaceProvider.getWorkspaceRoot() ||
            '';
          this.logger.info('RPC: chat:resume called', {
            sessionId,
            workspacePath: params.workspacePath || '(empty)',
            resolvedWorkspacePath,
            usedFallback: !params.workspacePath,
            ptahCliId: params.ptahCliId,
          });

          // TASK_2025_167: Track Ptah CLI session for subsequent chat:continue/abort
          if (params.ptahCliId) {
            this.ptahCliSessions.set(sessionId as string, params.ptahCliId);
            if (params.tabId) {
              this.ptahCliSessions.set(params.tabId, params.ptahCliId);
            }
          }

          // TASK_2025_092 FIX: Read full session history as FlatStreamEventUnion[]
          // This includes tool calls, thinking blocks, agent spawns, etc.
          // Also includes aggregated usage stats from JSONL
          const { events, stats } = await this.historyReader.readSessionHistory(
            sessionId,
            resolvedWorkspacePath,
          );

          // Also read simple messages for backward compatibility
          const messages = await this.historyReader.readHistoryAsMessages(
            sessionId,
            resolvedWorkspacePath,
          );

          // TASK_2025_109: Register interrupted agents from history into SubagentRegistryService
          // This enables context injection in chat:continue for cold-loaded sessions.
          // When a session is loaded from JSONL (not via live SDK hooks), the registry
          // is empty. This populates it with agents that started but never completed.
          const registeredFromHistory =
            this.subagentRegistry.registerFromHistoryEvents(events, sessionId);

          if (registeredFromHistory > 0) {
            this.logger.info(
              '[RPC] Registered interrupted agents from history',
              {
                sessionId,
                registeredCount: registeredFromHistory,
              },
            );
          }

          // TASK_2025_103 FIX: Query resumable subagents for this session
          // Frontend uses this to mark agent nodes as resumable when loading from history
          // TASK_2025_109: Now includes agents registered from history above
          const resumableSubagents =
            this.subagentRegistry.getResumableBySession(sessionId);

          // TASK_2025_168: Query CLI sessions from session metadata
          let cliSessions: CliSessionReference[] | undefined;
          try {
            const metadata = await this.sessionMetadataStore.get(sessionId);
            if (metadata?.cliSessions && metadata.cliSessions.length > 0) {
              cliSessions = [...metadata.cliSessions];
              this.logger.info('[RPC] CLI sessions found for session', {
                sessionId,
                cliSessionCount: cliSessions.length,
              });
            }
          } catch (error) {
            // SessionMetadataStore may not have data for this session
            this.logger.debug('[RPC] Could not query CLI sessions', {
              sessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }

          this.logger.info('[RPC] Session history loaded from JSONL', {
            sessionId,
            messageCount: messages.length,
            eventCount: events.length,
            hasStats: !!stats,
            totalCost: stats?.totalCost,
            resumableSubagentCount: resumableSubagents.length,
            cliSessionCount: cliSessions?.length ?? 0,
          });

          return {
            success: true,
            messages,
            events,
            stats,
            resumableSubagents,
            cliSessions,
          };
        } catch (error) {
          this.logger.error(
            'RPC: chat:resume failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * chat:abort - Interrupt session
   */
  private registerChatAbort(): void {
    this.rpcHandler.registerMethod<ChatAbortParams, ChatAbortResult>(
      'chat:abort',
      async (params) => {
        try {
          const { sessionId } = params;
          this.logger.debug('RPC: chat:abort called', { sessionId });

          // TASK_2025_167: Check if this is a Ptah CLI session
          const customAbortResult = await this.handlePtahCliAbort(params);
          if (customAbortResult.error !== '__NOT_PTAH_CLI__') {
            return customAbortResult;
          }

          await this.sdkAdapter.interruptSession(sessionId);

          // TASK_2025_175: Stop all agent session watchers for this session.
          // This ensures background agent watchers don't continue emitting
          // events to a dead session after abort.
          this.agentSessionWatcher.stopAllForSession(sessionId as string);

          return { success: true };
        } catch (error) {
          this.logger.error(
            'RPC: chat:abort failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * chat:running-agents - Query running (non-background) subagents for a session.
   *
   * TASK_2025_185: Used by frontend to show confirmation before aborting
   * when agents are still running.
   */
  private registerChatRunningAgents(): void {
    this.rpcHandler.registerMethod<
      ChatRunningAgentsParams,
      ChatRunningAgentsResult
    >('chat:running-agents', async (params) => {
      try {
        const { sessionId } = params;
        this.logger.debug('RPC: chat:running-agents called', { sessionId });

        const running = this.subagentRegistry.getRunningBySession(
          sessionId as string,
        );

        return {
          agents: running.map((r) => ({
            agentId: r.agentId,
            agentType: r.agentType,
          })),
        };
      } catch (error) {
        this.logger.error(
          'RPC: chat:running-agents failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { agents: [] };
      }
    });
  }

  // ============================================================================
  // BACKGROUND AGENT RPC METHODS & EVENT SUBSCRIPTION
  // ============================================================================

  /**
   * Subscribe to background agent events from AgentSessionWatcherService.
   *
   * Background agent events flow through a separate delivery path because
   * they outlive the main agent's streaming loop (streamExecutionNodesToWebview).
   * When a background agent completes, the watcher emits 'background-agent-completed'
   * and we broadcast it directly to the webview.
   */
  private subscribeToBackgroundAgentEvents(): void {
    this.agentSessionWatcher.on(
      'background-agent-completed',
      (data: {
        agentId: string;
        toolCallId: string;
        agentType: string;
        duration?: number;
        summaryContent?: string;
        sessionId?: string;
      }) => {
        this.logger.info('[RPC] Background agent completed event received', {
          agentId: data.agentId,
          toolCallId: data.toolCallId,
          agentType: data.agentType,
        });

        const event: BackgroundAgentCompletedEvent = {
          id: `evt_bg_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 9)}`,
          eventType: 'background_agent_completed',
          timestamp: Date.now(),
          sessionId: data.sessionId || '',
          messageId: `bg-complete-${data.agentId}`,
          toolCallId: data.toolCallId,
          agentId: data.agentId,
          agentType: data.agentType,
          result: data.summaryContent,
          duration: data.duration,
        };

        // Broadcast to all webview tabs - frontend filters by toolCallId
        this.webviewManager
          .broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, { event })
          .catch((err) => {
            this.logger.error(
              '[RPC] Failed to broadcast background agent completed event',
              err instanceof Error ? err : new Error(String(err)),
            );
          });
      },
    );
  }

  /**
   * Register RPC methods for background agent management.
   *
   * - agent:backgroundList - Returns all background agents for a session
   */
  private registerBackgroundAgentHandlers(): void {
    this.rpcHandler.registerMethod<
      { sessionId?: string },
      {
        agents: Array<{
          toolCallId: string;
          agentId: string;
          agentType: string;
          status: string;
          startedAt: number;
        }>;
      }
    >('agent:backgroundList', async (params) => {
      try {
        const agents = this.subagentRegistry
          .getBackgroundAgents(params.sessionId)
          .map((record) => ({
            toolCallId: record.toolCallId,
            agentId: record.agentId,
            agentType: record.agentType,
            status: record.status,
            startedAt: record.startedAt,
          }));

        return { agents };
      } catch (error) {
        this.logger.error(
          'RPC: agent:backgroundList failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        return { agents: [] };
      }
    });
  }

  /**
   * Stream flat events to webview
   * Handles SDK AsyncIterable<FlatStreamEventUnion> → webview messages
   *
   * TASK_2025_082: Migrated from ExecutionNode to FlatStreamEventUnion
   * TASK_2025_092: Added tabId for frontend event routing
   * TASK_2025_092: CRITICAL FIX - Added message_complete handling for turn completion
   *   (This fix was previously only in dead-code SdkRpcHandlers, not here!)
   *
   * The webview rebuilds ExecutionNode trees at render time from these flat events.
   * Events include tabId for routing and sessionId (real SDK UUID) for storage.
   *
   * IMPORTANT: With streaming input mode, the for-await-of loop may never complete
   * because SDK keeps the session open for multi-turn. We must send chat:complete
   * on message_complete event for proper turn-level completion.
   */
  private async streamExecutionNodesToWebview(
    sessionId: SessionId,
    stream: AsyncIterable<FlatStreamEventUnion>,
    tabId: string,
  ): Promise<void> {
    this.logger.info(
      `[RPC] streamExecutionNodesToWebview STARTED for session ${sessionId}, tabId ${tabId}`,
    );
    let eventCount = 0;

    // TASK_2025_092: Track if we've sent chat:complete for this turn
    // This prevents duplicate completion signals when multiple message_complete events arrive
    // (e.g., OpenRouter sends duplicate assistant messages with same messageId)
    let turnCompleteSent = false;

    // Track whether we've saved child session metadata for Ptah CLI sessions.
    // When the real SDK session ID appears (different from tabId), we save
    // metadata with isChildSession=true so it doesn't appear in the sidebar.
    let childMetadataSaved = false;
    const isPtahCliSession = this.ptahCliSessions.has(tabId);

    try {
      for await (const event of stream) {
        eventCount++;
        this.logger.debug(
          `[RPC] Streaming event #${eventCount} type=${event.eventType} to webview`,
          {
            sessionId,
            tabId,
            eventType: event.eventType,
            messageId: event.messageId,
          },
        );

        // Save child session metadata for Ptah CLI sessions once the real
        // SDK session ID is resolved. This prevents SessionImporterService
        // from importing the session as a top-level sidebar entry.
        // Awaited (not fire-and-forget) to ensure metadata is persisted
        // before extension shutdown could interrupt.
        if (
          isPtahCliSession &&
          !childMetadataSaved &&
          event.sessionId &&
          event.sessionId !== tabId
        ) {
          childMetadataSaved = true;
          const workspacePath = this.workspaceProvider.getWorkspaceRoot() ?? '';
          const ptahCliAgentId = this.ptahCliSessions.get(tabId);
          const sessionName = ptahCliAgentId
            ? `CLI Agent: ${ptahCliAgentId}`
            : 'CLI Agent Session';
          try {
            await this.sessionMetadataStore.createChild(
              event.sessionId,
              workspacePath,
              sessionName,
            );
            // Track SDK UUID for cross-referencing in CliSessionReference.
            // Store by both tabId and agentId so persistCliSessionReference
            // can look up by ptahCliId (which is the agentId).
            this.ptahCliSdkSessionIds.set(tabId, event.sessionId);
            if (ptahCliAgentId) {
              this.ptahCliSdkSessionIds.set(ptahCliAgentId, event.sessionId);
            }
            this.logger.info(
              '[RPC] Child session metadata saved for Ptah CLI session',
              { sessionId: event.sessionId, tabId, agentId: ptahCliAgentId },
            );
          } catch (err: unknown) {
            this.logger.warn(
              '[RPC] Failed to save child session metadata — session may appear in sidebar',
              { error: err instanceof Error ? err.message : String(err) },
            );
          }
        }

        // Include tabId for frontend routing
        // sessionId in event is the real SDK UUID
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
          tabId, // For frontend tab routing
          sessionId: event.sessionId, // Real SDK UUID from the event
          event,
        });

        // TASK_2025_092: Reset turnCompleteSent when new turn starts (message_start)
        // This ensures multi-turn conversations properly signal completion for each turn
        if (event.eventType === 'message_start') {
          turnCompleteSent = false;
        }

        // When a background_agent_started event arrives, mark the agent in registry
        if (event.eventType === 'background_agent_started') {
          const bgEvent = event as BackgroundAgentStartedEvent;
          if (bgEvent.toolCallId) {
            this.subagentRegistry.update(bgEvent.toolCallId, {
              status: 'background',
              isBackground: true,
              outputFilePath: bgEvent.outputFilePath,
              backgroundStartedAt: Date.now(),
            });
            // Also mark the watcher so it doesn't get stopped prematurely
            if (bgEvent.agentId) {
              this.agentSessionWatcher.markAsBackground(bgEvent.agentId);
            }
            this.logger.info(
              '[RPC] Background agent registered from stream event',
              {
                toolCallId: bgEvent.toolCallId,
                agentId: bgEvent.agentId,
              },
            );
          }
        }

        if (event.eventType === 'message_complete' && !turnCompleteSent) {
          turnCompleteSent = true;
          this.logger.info(
            `[RPC] Turn complete - sending chat:complete for session ${sessionId}, tabId ${tabId}`,
            { eventCount },
          );
          await this.webviewManager.broadcastMessage(
            MESSAGE_TYPES.CHAT_COMPLETE,
            {
              tabId,
              sessionId,
              code: 0,
            },
          );
        }
      }

      if (!turnCompleteSent) {
        await this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.CHAT_COMPLETE,
          {
            tabId,
            sessionId,
            code: 0,
          },
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const lowerMessage = errorMessage.toLowerCase();

      // Check if this is a user-initiated abort (not a real error)
      const isUserAbort =
        lowerMessage.includes('aborted by user') ||
        lowerMessage.includes('abort') ||
        lowerMessage.includes('cancelled') ||
        lowerMessage.includes('canceled');

      if (isUserAbort) {
        // User aborts are expected behavior, log at INFO level
        this.logger.info(
          `[RPC] Session ${sessionId} aborted by user after ${eventCount} events`,
        );
      } else {
        // Real errors should be logged at ERROR level
        this.logger.error(
          `[RPC] Error streaming flat events for session ${sessionId}, tabId ${tabId} after ${eventCount} events`,
          error instanceof Error ? error : new Error(String(error)),
        );
      }

      // If the stream errored with 0 events, the session resume failed entirely
      // (e.g., corrupted JSONL from a previous crash). Clean up the dead session
      // so the user isn't stuck trying to resume a broken session.
      const isCorruptedResume = eventCount === 0 && !isUserAbort;
      if (isCorruptedResume) {
        this.logger.warn(
          `[RPC] Session ${sessionId} failed during resume (0 events), cleaning up dead session. Original error: ${errorMessage}`,
        );
        try {
          await this.sdkAdapter.endSession(sessionId);
        } catch (cleanupErr) {
          this.logger.warn(
            `[RPC] Failed to clean up corrupted session ${sessionId}`,
            cleanupErr instanceof Error
              ? cleanupErr
              : new Error(String(cleanupErr)),
          );
        }
      }

      // Only send error to webview for real errors, not user-initiated aborts.
      // User aborts include: stop button, /clear command, slash command re-query.
      // These are handled by their own completion signals (CHAT_COMPLETE).
      if (!isUserAbort) {
        await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_ERROR, {
          tabId,
          sessionId,
          error: isCorruptedResume
            ? 'Session could not be resumed. The conversation data may be corrupted. Please start a new session.'
            : errorMessage,
        });
      }
    } finally {
      // Clean up Ptah CLI session tracking on stream completion (natural or error)
      this.ptahCliSessions.delete(sessionId as string);
      this.ptahCliSessions.delete(tabId);
      // Note: ptahCliSdkSessionIds is NOT cleaned up here — it must persist
      // until persistCliSessionReference reads it (agent may exit later).

      // TASK_2025_COMPACT_FIX: Clean up the session from activeSessions when the
      // stream ends naturally (e.g., slash commands with maxTurns: 1). Without this,
      // chat:continue sees the session as "active" and calls sendMessage on a dead
      // query instead of resuming properly. For multi-turn sessions (with streamInput),
      // the loop only exits on abort, which already calls endSession.
      if (this.sdkAdapter.isSessionActive(sessionId)) {
        try {
          await this.sdkAdapter.endSession(sessionId);
          this.logger.info(
            `[RPC] Session ${sessionId} cleaned up after stream completion`,
          );
        } catch {
          // Best-effort cleanup — session may have already been ended
        }
      }
    }
  }
}
