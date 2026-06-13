/**
 * Chat session service.
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
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  SmitheryRegistrySource,
  SmitheryConnectionResolver,
  SmitheryInstalledManifestStore,
  SmitheryOverrideResolver,
  createSmitheryConfigSecretStore,
} from '@ptah-extension/cli-agent-runtime';
import { SMITHERY_API_KEY_SECRET_ID } from '../../handlers/mcp-directory-rpc.schema';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  SessionHistoryReaderService,
  SessionMetadataStore,
  SDK_TOKENS,
  SlashCommandInterceptor,
  AuthRequiredError,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
  type IPlatformInfo,
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
  McpHttpServerOverride,
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

/**
 * Minimal shape consumed by {@link ChatSessionService.autoResumeIfInactive}.
 *
 * `chat:continue` passes the full {@link ChatContinueParams}; the rewind and
 * `chat:resume activate:true` callsites synthesize a literal with only the
 * fields the resume body actually reads (`model`, `thinking`, `effort` are all
 * optional pass-throughs to `sdkAdapter.resumeSession`). Replacing the prior
 * `as ChatContinueParams` cast with this honest internal type keeps the
 * compiler honest if a future change reads `params.prompt` (the auto-resume
 * path uses the separate `prompt` positional arg, not this field).
 */
interface AutoResumePreflight {
  sessionId: SessionId;
  tabId: string;
  workspacePath?: string;
  model?: ChatContinueParams['model'];
  thinking?: ChatContinueParams['thinking'];
  effort?: ChatContinueParams['effort'];
  surfaceMode?: ChatContinueParams['surfaceMode'];
}

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
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
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
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecretsService: IAuthSecretsService,
  ) {}

  /**
   * Lazily-built resolver that rebuilds session-time Smithery MCP overrides
   * from the encrypted install manifest. Built once and reused; reads the
   * manifest on each `buildOverrides()` so installs/uninstalls take effect on
   * the next session start without restarting.
   */
  private smitheryOverrideResolver?: SmitheryOverrideResolver;

  private getSmitheryOverrideResolver(): SmitheryOverrideResolver {
    if (!this.smitheryOverrideResolver) {
      const getApiKey = async (): Promise<string | null> =>
        (await this.authSecretsService.getProviderKey(
          SMITHERY_API_KEY_SECRET_ID,
        )) ?? null;

      const registry = new SmitheryRegistrySource({
        getApiKey,
        logger: this.logger,
      });
      const connectionResolver = new SmitheryConnectionResolver(
        getApiKey,
        registry,
      );
      const manifest = new SmitheryInstalledManifestStore(
        createSmitheryConfigSecretStore({
          getProviderKey: (id) => this.authSecretsService.getProviderKey(id),
          setProviderKey: (id, value) =>
            this.authSecretsService.setProviderKey(id, value),
          deleteProviderKey: (id) =>
            this.authSecretsService.deleteProviderKey(id),
        }),
      );
      this.smitheryOverrideResolver = new SmitheryOverrideResolver({
        manifest,
        resolver: connectionResolver,
        logger: this.logger,
      });
    }
    return this.smitheryOverrideResolver;
  }

  /**
   * Merge manifest-resolved Smithery overrides UNDER any caller-supplied
   * overrides (caller wins on key collision, matching the builder's
   * `mergeMcpOverride` contract). Never throws — Smithery contributes nothing on
   * empty manifest / missing key / resolution failure.
   */
  private async buildMcpServersOverride(
    callerOverride: Record<string, McpHttpServerOverride> | undefined,
  ): Promise<Record<string, McpHttpServerOverride> | undefined> {
    let smithery: Record<string, McpHttpServerOverride> = {};
    try {
      smithery = await this.getSmitheryOverrideResolver().buildOverrides();
    } catch (error: unknown) {
      this.logger.warn('[RPC] chat:start - Smithery override build failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const hasSmithery = Object.keys(smithery).length > 0;
    const hasCaller =
      !!callerOverride && Object.keys(callerOverride).length > 0;
    if (!hasSmithery && !hasCaller) {
      return callerOverride;
    }
    return { ...smithery, ...(callerOverride ?? {}) };
  }

  /**
   * chat:start - Start new SDK session. Uses tabId for frontend correlation;
   * SDK generates the real session UUID in the system init message.
   */
  /**
   * Map an error to the structured `{ errorCode, providerId }` fields when it is
   * an `AuthRequiredError`, so the chat UI can render a re-auth banner instead
   * of treating an expired/missing token as a generic failure.
   */
  private authErrorFields(error: unknown): {
    errorCode?: 'AUTH_REQUIRED';
    providerId?: string;
  } {
    if (error instanceof AuthRequiredError) {
      return {
        errorCode: 'AUTH_REQUIRED',
        ...(error.providerId ? { providerId: error.providerId } : {}),
      };
    }
    return {};
  }

  /**
   * Refuse to spawn an SDK session when the resolved workspace path is
   * unsafe (filesystem root, the Ptah install dir, app storage). This
   * backstops the warm-query bug where a stale subprocess would otherwise
   * run rooted at `process.cwd()` of the Electron main process (typically
   * the install dir in production).
   */
  private rejectIfUnsafeWorkspace(
    workspacePath: string,
    rpcName: string,
  ): { success: false; error: string } | null {
    const safety = isUnsafeWorkspacePath(workspacePath, this.platformInfo);
    if (safety.ok) return null;
    this.logger.warn(
      `[RPC] ${rpcName} - refused: resolved workspace path is unsafe — ${safety.reason}`,
      { workspacePath },
    );
    return {
      success: false,
      error: `Cannot start a session in this folder: ${safety.reason}. Please open a real project folder.`,
    };
  }

  async startSession(params: ChatStartParams): Promise<ChatStartResult> {
    try {
      const { prompt, tabId, options, name } = params;
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
      const unsafeStart = this.rejectIfUnsafeWorkspace(
        workspacePath,
        'chat:start',
      );
      if (unsafeStart) return unsafeStart;
      this.logger.debug('RPC: chat:start called', {
        tabId,
        workspacePath,
        sessionName: name,
        ptahCliId: params.ptahCliId,
      });
      if (params.ptahCliId) {
        const dispatch = await this.ptahCli.handleStart({
          ...params,
          workspacePath,
        });
        if (dispatch.stream && dispatch.tabId) {
          this.streamBroadcaster.streamEventsToWebview(
            dispatch.tabId as SessionId,
            dispatch.stream as AsyncIterable<
              import('@ptah-extension/shared').FlatStreamEventUnion
            >,
            dispatch.tabId,
            params.surfaceMode,
          );
        }
        return dispatch.result;
      }
      const interceptResult = prompt
        ? this.slashCommandInterceptor.intercept(prompt)
        : { action: 'passthrough' as const };

      if (interceptResult.action === 'native') {
        this.logger.info('[RPC] chat:start - native command intercepted', {
          command: interceptResult.commandName,
        });

        if (interceptResult.commandName === 'clear') {
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
        this.logger.warn('[RPC] chat:start - unrecognized native command', {
          command: interceptResult.commandName,
        });
        return { success: true };
      }
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
        options?.model || this.modelSettings.selectedModel.get() || 'default';
      const files = options?.files ?? [];
      if (files.length > 0) {
        this.logger.debug('RPC: chat:start received files', {
          tabId,
          fileCount: files.length,
          files,
        });
      }
      const images = options?.images ?? [];
      const mcpServersOverride = await this.buildMcpServersOverride(
        params.mcpServersOverride,
      );
      const stream = await this.sdkAdapter.startChatSession({
        tabId,
        workspaceId: workspacePath,
        model: currentModel,
        systemPrompt: options?.systemPrompt,
        projectPath: workspacePath,
        name,
        prompt,
        files,
        images, // inline pasted/dropped images
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        thinking: options?.thinking,
        effort: options?.effort,
        includePartialMessages: options?.includePartialMessages,
        mcpServersOverride,
      });
      this.streamBroadcaster.streamEventsToWebview(
        tabId as SessionId,
        stream,
        tabId,
        params.surfaceMode,
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
        ...this.authErrorFields(error),
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
      const unsafeContinue = this.rejectIfUnsafeWorkspace(
        workspacePath,
        'chat:continue',
      );
      if (unsafeContinue) return unsafeContinue;
      this.logger.debug('RPC: chat:continue called', {
        sessionId,
        tabId,
        sessionName: name,
      });
      const ptahCliResult = await this.ptahCli.handleContinue(params);
      if (ptahCliResult.error !== '__NOT_PTAH_CLI__') {
        return ptahCliResult;
      }
      if (this.premiumContext.isMcpServerRunning()) {
        const licenseCheck = await this.licenseService.verifyLicense();
        if (isPremiumTier(licenseCheck)) {
          this.codeExecutionMcp.ensureRegisteredForSubagents();
        }
      }
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
      const { prompt: enhancedPrompt } =
        await this.subagentContextInjector.injectInterruptedAgentsContext(
          prompt,
          sessionId,
          workspacePath,
        );
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
        ...this.authErrorFields(error),
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
      const unsafeResume = this.rejectIfUnsafeWorkspace(
        resolvedWorkspacePath,
        'chat:resume',
      );
      if (unsafeResume) return unsafeResume;
      this.logger.info('RPC: chat:resume called', {
        sessionId,
        workspacePath: params.workspacePath || '(empty)',
        resolvedWorkspacePath,
        usedFallback: !params.workspacePath,
        ptahCliId: params.ptahCliId,
      });
      if (params.ptahCliId) {
        this.ptahCli.registerResumedSession(
          sessionId as string,
          params.ptahCliId,
          params.tabId,
        );
      }
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
      const registeredFromHistory =
        this.subagentRegistry.registerFromHistoryEvents(events, sessionId);

      if (registeredFromHistory > 0) {
        this.logger.info('[RPC] Registered interrupted agents from history', {
          sessionId,
          registeredCount: registeredFromHistory,
        });
      }
      const resumableSubagents =
        this.subagentRegistry.getResumableBySession(sessionId);
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
      let activated = false;
      let activationError: string | undefined;
      let activationErrorCode: ChatResumeResult['activationErrorCode'];
      if (params.activate === true && params.tabId) {
        if (!this.sdkAdapter.isSessionActive(sessionId)) {
          const activateResult = await this.autoResumeIfInactive(
            sessionId,
            params.tabId,
            resolvedWorkspacePath,
            '',
            {
              sessionId,
              tabId: params.tabId,
              workspacePath: resolvedWorkspacePath,
            },
          );
          if ('justResumed' in activateResult) {
            activated =
              activateResult.justResumed ||
              this.sdkAdapter.isSessionActive(sessionId);
          } else {
            activationError =
              activateResult.error.error ?? 'Auto-resume failed';
            activationErrorCode = activateResult.error.errorCode;
            this.logger.warn(
              '[RPC] chat:resume activate:true — auto-resume failed',
              {
                sessionId,
                tabId: params.tabId,
                activationError,
                activationErrorCode,
              },
            );
          }
        } else {
          activated = true;
        }
      }

      return {
        success: true,
        messages,
        events,
        stats,
        resumableSubagents,
        cliSessions,
        activated,
        ...(activationError ? { activationError } : {}),
        ...(activationErrorCode ? { activationErrorCode } : {}),
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
        ...this.authErrorFields(error),
      };
    }
  }

  /** chat:abort - Interrupt session. */
  async abortSession(params: ChatAbortParams): Promise<ChatAbortResult> {
    try {
      const { sessionId } = params;
      this.logger.debug('RPC: chat:abort called', { sessionId });
      const customAbortResult = await this.ptahCli.handleAbort(params);
      if (customAbortResult.error !== '__NOT_PTAH_CLI__') {
        return customAbortResult;
      }

      await this.sdkAdapter.interruptSession(sessionId);

      const resumableSubagents = this.subagentRegistry.getResumableBySession(
        sessionId as string,
      );
      if (resumableSubagents.length > 0) {
        this.logger.info('RPC: chat:abort - interrupted subagents resumable', {
          sessionId,
          count: resumableSubagents.length,
          agents: resumableSubagents.map((s) => ({
            agentId: s.agentId,
            agentType: s.agentType,
          })),
        });
      }

      return {
        success: true,
        ...(resumableSubagents.length > 0 && { resumableSubagents }),
      };
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
   * (frontend abort-confirmation hook).
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
   * Best-effort auto-resume for an inactive SDK session before a downstream
   * operation (currently: `session:rewindFiles`) that requires a live Query
   * handle. Idempotent: returns `{ alreadyActive: true }` when the session is
   * already active. On a successful resume returns `{ resumed: true }`; on
   * failure returns `{ resumed: false, error }` so the caller can surface a
   * clean error and avoid an infinite resume-retry loop. Reuses the same
   * premium-gated config + streaming code path as `chat:continue` auto-resume.
   *
   * Public entry point — wraps the private `autoResumeIfInactive` helper.
   */
  async ensureSessionActiveForRewind(
    sessionId: SessionId,
    tabId: string,
    workspacePath: string,
  ): Promise<
    | { alreadyActive: true }
    | { resumed: true }
    | { resumed: false; error: string }
  > {
    if (this.sdkAdapter.isSessionActive(sessionId)) {
      return { alreadyActive: true };
    }

    const outcome = await this.autoResumeIfInactive(
      sessionId,
      tabId,
      workspacePath,
      '',
      {
        sessionId,
        tabId,
        workspacePath,
      },
    );

    if ('error' in outcome) {
      return {
        resumed: false,
        error: outcome.error.error ?? 'Auto-resume failed',
      };
    }
    // outcome.justResumed is `boolean`; when `autoResumeIfInactive` returned
    // `{ justResumed: false }` it meant "already active", which we already
    // short-circuited above via `isSessionActive`. Coerce to `true`.
    return { resumed: true };
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
    params: AutoResumePreflight,
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
      params.model || this.modelSettings.selectedModel.get() || 'default';

    try {
      const stream = await this.sdkAdapter.resumeSession(sessionId, {
        projectPath: workspacePath,
        model: currentModel,
        isPremium,
        mcpServerRunning,
        enhancedPromptsContent,
        pluginPaths,
        tabId,
        thinking: params.thinking,
        effort: params.effort,
        prompt,
      });
      this.streamBroadcaster.streamEventsToWebview(
        sessionId,
        stream,
        tabId,
        params.surfaceMode,
      );
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
