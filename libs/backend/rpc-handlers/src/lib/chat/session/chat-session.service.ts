/**
 * Chat session service (Wave C7e cleanup pass 2).
 *
 * SDK-adapter orchestration for the six chat RPC methods (`chat:start`,
 * `chat:continue` with auto-resume + slash-command intercept, `chat:resume`,
 * `chat:abort`, `chat:running-agents`, `agent:backgroundList`).
 *
 * Every prompt string, log message, error message, and Sentry `errorSource`
 * tag is byte-identical to the pre-extraction handler. The
 * `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prefix lives on
 * `ChatSubagentContextInjectorService` and the follow-up slash-command
 * routing on `ChatSlashCommandRouterService`.
 *
 * All collaborators are injected via constructor `@inject()` — no
 * callback-setter wiring from the handler.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  ConfigManager,
  SubagentRegistryService,
  LicenseService,
  isPremiumTier,
  type SentryService,
} from '@ptah-extension/vscode-core';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  SessionHistoryReaderService,
  SessionMetadataStore,
  SDK_TOKENS,
  SlashCommandInterceptor,
  DEFAULT_FALLBACK_MODEL_ID,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  IAgentAdapter,
  SessionId,
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
  CliSessionReference,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatPremiumContextService } from './chat-premium-context.service';
import type { ChatPtahCliService } from '../ptah-cli/chat-ptah-cli.service';
import type {
  ChatStreamBroadcaster,
  WebviewManager,
} from '../streaming/chat-stream-broadcaster.service';
import type { ChatSubagentContextInjectorService } from './chat-subagent-context-injector.service';
import type { ChatSlashCommandRouterService } from './chat-slash-command-router.service';
import { hasStopIntent } from './chat-stop-intent';
import { isAuthorizedWorkspace } from '../../utils/workspace-authorization';

@injectable()
export class ChatSessionService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.CONFIG_MANAGER)
    private readonly configManager: ConfigManager,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(SDK_TOKENS.SDK_SESSION_HISTORY_READER)
    private readonly historyReader: SessionHistoryReaderService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR)
    private readonly slashCommandInterceptor: SlashCommandInterceptor,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(CHAT_TOKENS.PREMIUM_CONTEXT)
    private readonly premiumContext: ChatPremiumContextService,
    @inject(CHAT_TOKENS.PTAH_CLI)
    private readonly ptahCli: ChatPtahCliService,
    @inject(CHAT_TOKENS.STREAM_BROADCASTER)
    private readonly streamBroadcaster: ChatStreamBroadcaster,
    @inject(CHAT_TOKENS.SUBAGENT_CONTEXT_INJECTOR)
    private readonly subagentContextInjector: ChatSubagentContextInjectorService,
    @inject(CHAT_TOKENS.SLASH_COMMAND_ROUTER)
    private readonly slashCommandRouter: ChatSlashCommandRouterService,
  ) {}

  /**
   * chat:start - Start new SDK session. Uses tabId for frontend correlation;
   * SDK generates the real session UUID in the system init message.
   */
  async startSession(params: ChatStartParams): Promise<ChatStartResult> {
    try {
      const { prompt, tabId, options, name } = params;
      // Workspace path: frontend-provided value, then IWorkspaceProvider.
      // Never process.cwd() — that returns the app installation directory.
      const workspacePath =
        params.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!workspacePath) {
        return {
          success: false,
          error:
            'No workspace folder open. Please open a folder before starting a chat session.',
        };
      }
      if (
        params.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        return {
          success: false,
          error: 'Access denied: workspace path is not an open folder.',
        };
      }
      this.logger.debug('RPC: chat:start called', {
        tabId,
        workspacePath,
        sessionName: name,
        ptahCliId: params.ptahCliId,
      });

      // TASK_2025_167: Ptah CLI dispatch
      if (params.ptahCliId) {
        const dispatch = await this.ptahCli.handleStart(params);
        if (dispatch.stream && dispatch.tabId) {
          this.streamBroadcaster.streamEventsToWebview(
            dispatch.tabId as SessionId,
            dispatch.stream as AsyncIterable<
              import('@ptah-extension/shared').FlatStreamEventUnion
            >,
            dispatch.tabId,
          );
        }
        return dispatch.result;
      }

      // TASK_2025_184: Intercept native slash commands on initial message
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

      // TASK_2025_108: License + MCP gating; TASK_2025_151/153: enhanced prompts + plugin paths
      const licenseStatus = await this.licenseService.verifyLicense();
      const isPremium = isPremiumTier(licenseStatus);
      const mcpServerRunning = this.premiumContext.isMcpServerRunning();

      this.logger.info('[ptah.main] chat:start - session config', {
        tier: licenseStatus.tier,
        isPremium,
        mcpServerRunning,
        mcpPort: this.codeExecutionMcp.getPort(),
      });

      if (isPremium && mcpServerRunning) {
        this.codeExecutionMcp.ensureRegisteredForSubagents();
      }

      const enhancedPromptsContent =
        await this.premiumContext.resolveEnhancedPromptsContent(
          workspacePath,
          isPremium,
        );
      const pluginPaths = this.premiumContext.resolvePluginPaths(isPremium);

      this.logger.info('[ptah.main] chat:start - prompt config', {
        hasEnhancedPrompts: !!enhancedPromptsContent,
        enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
        pluginCount: pluginPaths?.length ?? 0,
      });

      const currentModel =
        options?.model ||
        this.configManager.get<string>('model.selected') ||
        DEFAULT_FALLBACK_MODEL_ID;

      // TASK_2025_093: tabId is the primary tracking key; SDK generates real UUID
      const files = options?.files ?? [];
      if (files.length > 0) {
        this.logger.debug('RPC: chat:start received files', {
          tabId,
          fileCount: files.length,
          files,
        });
      }

      // TASK_2025_181: SDK handles slash commands natively when receiving string prompts
      const images = options?.images ?? [];
      const stream = await this.sdkAdapter.startChatSession({
        tabId,
        workspaceId: workspacePath,
        model: currentModel,
        systemPrompt: options?.systemPrompt,
        projectPath: workspacePath,
        name,
        prompt,
        files,
        images, // TASK_2025_176: inline pasted/dropped images
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        thinking: options?.thinking, // TASK_2025_184
        effort: options?.effort, // TASK_2025_184
        // Opt-in passthrough for SDK partial-message stream events. When
        // omitted, the SDK plumbing defaults to ON (preserves historical
        // Ptah behavior — StreamTransformer already consumes stream_event).
        includePartialMessages: options?.includePartialMessages,
        // TASK_2026_108 T2: Caller-supplied MCP HTTP server overrides
        // (populated by the Anthropic-compatible HTTP proxy via the
        // X-Ptah-Mcp-Servers header). Identity-preserved when undefined or
        // empty — see SdkQueryOptionsBuilder.mergeMcpOverride.
        mcpServersOverride: params.mcpServersOverride,
      });

      // Stream ExecutionNodes to webview (background — don't await)
      this.streamBroadcaster.streamEventsToWebview(
        tabId as SessionId,
        stream,
        tabId,
      );

      return { success: true };
    } catch (error) {
      this.logger.error(
        'RPC: chat:start failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.captureSentry(error, 'ChatRpcHandlers.registerChatStart');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * chat:continue - Send message to existing session with auto-resume +
   * slash-command intercept + interrupted-subagent context injection.
   */
  async continueSession(
    params: ChatContinueParams,
  ): Promise<ChatContinueResult> {
    try {
      const { prompt, sessionId, tabId, name } = params;
      // Workspace path mirrors chat:start resolution.
      const workspacePath =
        params.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!workspacePath) {
        return {
          success: false,
          error:
            'No workspace folder open. Please open a folder before continuing a chat session.',
        };
      }
      if (
        params.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        return {
          success: false,
          error: 'Access denied: workspace path is not an open folder.',
        };
      }
      this.logger.debug('RPC: chat:continue called', {
        sessionId,
        tabId,
        sessionName: name,
      });

      // TASK_2025_167: Check if this is a Ptah CLI session
      const ptahCliResult = await this.ptahCli.handleContinue(params);
      if (ptahCliResult.error !== '__NOT_PTAH_CLI__') {
        return ptahCliResult;
      }

      // Ensure MCP server is registered in .mcp.json for subagent discovery (premium only)
      // Must run outside the resume block — active sessions also spawn subagents
      if (this.premiumContext.isMcpServerRunning()) {
        const licenseCheck = await this.licenseService.verifyLicense();
        if (isPremiumTier(licenseCheck)) {
          this.codeExecutionMcp.ensureRegisteredForSubagents();
        }
      }

      // Auto-resume if inactive — caller proceeds with sendMessageToSession on
      // success; bails with the structured error on failure.
      const resumeOutcome = await this.autoResumeIfInactive(
        sessionId,
        tabId,
        workspacePath,
        prompt,
        params,
      );
      if ('error' in resumeOutcome) return resumeOutcome.error;
      const justResumed = resumeOutcome.justResumed;

      const files = params.files ?? [];
      if (files.length > 0) {
        this.logger.debug('RPC: chat:continue received files', {
          sessionId,
          tabId,
          fileCount: files.length,
          files,
        });
      }

      // TASK_2025_184: Intercept slash commands BEFORE subagent context injection.
      // Subagent injection mutates the registry; running it for a slash command
      // (whose enhanced prompt is discarded) would lose interrupted-agent state.
      const slashResult =
        await this.slashCommandRouter.routeFollowUpSlashCommand(
          prompt,
          sessionId,
          tabId,
          workspacePath,
          params,
        );
      if (slashResult) {
        return slashResult;
      }

      // TASK_2025_109: Inject interrupted-subagent context so Claude auto-resumes.
      const { prompt: enhancedPrompt } =
        await this.subagentContextInjector.injectInterruptedAgentsContext(
          prompt,
          sessionId,
          workspacePath,
        );

      // Autopilot stop-intent: yolo/auto-edit auto-approves tool calls, so a
      // "stop"/"cancel" message must explicitly interrupt the current turn.
      // Skip when we just resumed (no active turn to stop).
      if (!justResumed && hasStopIntent(prompt)) {
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

      // Even after an interrupt, send the message: the new turn lets the agent
      // acknowledge the user's "stop" instead of leaving the session ambiguous.
      const images = params.images ?? [];
      await this.sdkAdapter.sendMessageToSession(sessionId, enhancedPrompt, {
        files,
        images,
      });

      return { success: true, sessionId };
    } catch (error) {
      this.logger.error(
        'RPC: chat:continue failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.captureSentry(error, 'ChatRpcHandlers.registerChatContinue');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * chat:resume - Load session history from JSONL files. Returns full
   * `events` (FlatStreamEventUnion[]) for tree reconstruction plus `messages`
   * (deprecated, backward compat), aggregated usage stats, resumable
   * subagents, and any CLI session references.
   */
  async resumeSession(params: ChatResumeParams): Promise<ChatResumeResult> {
    try {
      const { sessionId } = params;
      const resolvedWorkspacePath =
        params.workspacePath || this.workspaceProvider.getWorkspaceRoot();
      if (!resolvedWorkspacePath) {
        return {
          success: false,
          error:
            'No workspace folder open. Please open a folder before resuming a chat session.',
        };
      }
      if (
        params.workspacePath &&
        !isAuthorizedWorkspace(params.workspacePath, this.workspaceProvider)
      ) {
        return {
          success: false,
          error: 'Access denied: workspace path is not an open folder.',
        };
      }
      this.logger.info('RPC: chat:resume called', {
        sessionId,
        workspacePath: params.workspacePath || '(empty)',
        resolvedWorkspacePath,
        usedFallback: !params.workspacePath,
        ptahCliId: params.ptahCliId,
      });

      // TASK_2025_167: Track Ptah CLI session for subsequent chat:continue/abort
      if (params.ptahCliId) {
        this.ptahCli.registerResumedSession(
          sessionId as string,
          params.ptahCliId,
          params.tabId,
        );
      }

      // TASK_2025_092: Full FlatStreamEventUnion[] for tree reconstruction
      const result = await this.historyReader.readSessionHistory(
        sessionId,
        resolvedWorkspacePath,
      );
      const events = result.events;
      const stats = result.stats;

      const messages = await this.historyReader.readHistoryAsMessages(
        sessionId,
        resolvedWorkspacePath,
      );

      // TASK_2025_109: Register interrupted agents from history so context
      // injection can fire on cold-loaded sessions (live SDK hooks haven't run).
      const registeredFromHistory =
        this.subagentRegistry.registerFromHistoryEvents(events, sessionId);

      if (registeredFromHistory > 0) {
        this.logger.info('[RPC] Registered interrupted agents from history', {
          sessionId,
          registeredCount: registeredFromHistory,
        });
      }

      // TASK_2025_103 + TASK_2025_109: Frontend marks resumable agent nodes
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
      this.captureSentry(error, 'ChatRpcHandlers.registerChatResume');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** chat:abort - Interrupt session (TASK_2025_175). */
  async abortSession(params: ChatAbortParams): Promise<ChatAbortResult> {
    try {
      const { sessionId } = params;
      this.logger.debug('RPC: chat:abort called', { sessionId });

      // TASK_2025_167: Ptah CLI sessions take a separate abort path
      const customAbortResult = await this.ptahCli.handleAbort(params);
      if (customAbortResult.error !== '__NOT_PTAH_CLI__') {
        return customAbortResult;
      }

      await this.sdkAdapter.interruptSession(sessionId);

      return { success: true };
    } catch (error) {
      this.logger.error(
        'RPC: chat:abort failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.captureSentry(error, 'ChatRpcHandlers.registerChatAbort');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * chat:running-agents - Query running (non-background) subagents
   * (TASK_2025_185: frontend abort-confirmation hook).
   */
  async getRunningAgents(
    params: ChatRunningAgentsParams,
  ): Promise<ChatRunningAgentsResult> {
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
      this.captureSentry(error, 'ChatRpcHandlers.registerChatRunningAgents');
      return { agents: [] };
    }
  }

  /** agent:backgroundList - Return all background agents for a session. */
  async listBackgroundAgents(params: { sessionId?: string }): Promise<{
    agents: Array<{
      toolCallId: string;
      agentId: string;
      agentType: string;
      status: string;
      startedAt: number;
    }>;
  }> {
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
      this.captureSentry(
        error,
        'ChatRpcHandlers.registerBackgroundAgentHandlers',
      );
      return { agents: [] };
    }
  }

  /**
   * Auto-resume an inactive SDK session before continuing. Returns
   * `{ justResumed: false }` when already active; otherwise resumes via
   * premium-gated config and streams to the webview. `{ error }` carries a
   * structured `ChatContinueResult` on failure. Log messages + payloads are
   * byte-identical to the pre-extraction inline block.
   */
  private async autoResumeIfInactive(
    sessionId: SessionId,
    tabId: string,
    workspacePath: string,
    prompt: string,
    params: ChatContinueParams,
  ): Promise<{ justResumed: boolean } | { error: ChatContinueResult }> {
    if (this.sdkAdapter.isSessionActive(sessionId)) {
      return { justResumed: false };
    }

    this.logger.info(
      `[RPC] Session ${sessionId} not active, attempting resume...`,
    );

    const licenseStatus = await this.licenseService.verifyLicense();
    const isPremium = isPremiumTier(licenseStatus);
    const mcpServerRunning = this.premiumContext.isMcpServerRunning();

    this.logger.info('[ptah.main] chat:continue resume - session config', {
      tier: licenseStatus.tier,
      isPremium,
      mcpServerRunning,
      mcpPort: this.codeExecutionMcp.getPort(),
      sessionId,
    });

    const enhancedPromptsContent =
      await this.premiumContext.resolveEnhancedPromptsContent(
        workspacePath,
        isPremium,
      );
    const pluginPaths = this.premiumContext.resolvePluginPaths(isPremium);

    this.logger.info('[ptah.main] chat:continue resume - prompt config', {
      hasEnhancedPrompts: !!enhancedPromptsContent,
      enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
      pluginCount: pluginPaths?.length ?? 0,
    });

    const currentModel =
      params.model ||
      this.configManager.getWithDefault<string>(
        'model.selected',
        DEFAULT_FALLBACK_MODEL_ID,
      );

    try {
      const stream = await this.sdkAdapter.resumeSession(sessionId, {
        projectPath: workspacePath,
        model: currentModel,
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        tabId,
        thinking: params.thinking, // TASK_2025_184
        effort: params.effort, // TASK_2025_184
        prompt,
      });
      this.streamBroadcaster.streamEventsToWebview(sessionId, stream, tabId);
      this.logger.info(`[RPC] Session ${sessionId} resumed successfully`);
      return { justResumed: true };
    } catch (resumeError) {
      const message =
        resumeError instanceof Error
          ? resumeError.message
          : String(resumeError);
      this.logger.warn('[RPC] chat:continue - resumeSession failed', {
        sessionId,
        error: message,
      });
      return {
        error: {
          success: false,
          sessionId: sessionId as SessionId,
          error: message,
        },
      };
    }
  }

  /** Per-method Sentry capture (each method result-shapes its failures, so the handler's `runRpc` won't see them). */
  private captureSentry(error: unknown, errorSource: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.sentryService.captureException(err, { errorSource });
  }
}
