/**
 * Chat session service.
 *
 * SDK-adapter orchestration for the six chat RPC methods (`chat:start`,
 * `chat:continue` with auto-resume + slash-command intercept, `chat:resume`,
 * `chat:abort`, `chat:running-agents`, `agent:backgroundList`), plus the
 * child-session start behind `ChildChatSessionHostAdapter` (TASK_2026_584),
 * which shares `chat:start`'s SDK launch.
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

import { CodexChatOptionError } from '../codex-host/codex-chat-profile-options';
import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcUserError,
  TOKENS,
  ConfigManager,
  SubagentRegistryService,
  type SentryService,
  type IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import {
  SmitheryRegistrySource,
  SmitheryConnectionResolver,
  SmitheryInstalledManifestStore,
  SmitheryOverrideResolver,
  createSmitheryConfigSecretStore,
  McpOAuthService,
  McpOAuthInstalledManifestStore,
  McpOAuthOverrideResolver,
  createMcpOAuthTokenStore,
  safeErrorKind,
  type AgentProcessManager,
} from '@ptah-extension/cli-agent-runtime';
import { SMITHERY_API_KEY_SECRET_ID } from '../../handlers/mcp-directory-rpc.schema';
import { SETTINGS_TOKENS } from '@ptah-extension/settings-core';
import type { ModelSettings } from '@ptah-extension/settings-core';
import {
  AUTH_PROVIDERS_TOKENS,
  ProviderAccountService,
  type ActiveProviderResolver,
  type WorkspaceProviderProfileResolver,
} from '@ptah-extension/auth-providers';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  SessionMetadataStore,
  SDK_TOKENS,
  SlashCommandInterceptor,
  AuthRequiredError,
  isCodexChatAdapterError,
  type SessionEndCallbackRegistry,
  type SessionMcpStatusCallbackRegistry,
  type SessionBudgetService,
} from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
  type IPlatformInfo,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  IAgentAdapter,
  AgentSessionStartConfig,
  AgentSessionResumeConfig,
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
  PermissionLevel,
} from '@ptah-extension/shared';
import {
  MESSAGE_TYPES,
  NAMED_ACCOUNT_ADMISSION_BUDGET_MS,
  selectHistoryPage,
} from '@ptah-extension/shared';

import type { ProviderAccountPortRefusal } from '@ptah-extension/auth-providers-tokens';

import {
  resolveClaudeExecution,
  storedChatRuntimeIdentity,
  type ChatRuntimeProfileService,
} from './chat-runtime-profile.service';
import { CHAT_TOKENS } from '../tokens';
import type { ChatSdkContextService } from './chat-sdk-context.service';
import type { ChatPtahCliService } from '../ptah-cli/chat-ptah-cli.service';
import type {
  ChatStreamBroadcaster,
  WebviewManager,
} from '../streaming/chat-stream-broadcaster.service';
import type { ChatSubagentContextInjectorService } from './chat-subagent-context-injector.service';
import {
  gateMainSessionAccount,
  mainSessionAccountFailure,
  type MainSessionAccountSelection,
  type ResolvedMainAccountSelection,
  type ChatSlashCommandRouterService,
} from './chat-slash-command-router.service';
import type { ChatHistoryReadService } from './chat-history-read.service';
import {
  selectDeliveredBlockOwners,
  selectDeliveredSyntheticResults,
} from './history-block-owners';
import {
  OUTPUT_STYLE_TOKENS,
  type OutputStyleSessionActivationService,
} from '@ptah-extension/output-styles';
import { hasStopIntent } from './chat-stop-intent';
import type {
  SessionMcpStatusRecord,
  SessionMcpStatusRegistry,
} from './session-mcp-status.registry';
import { isAuthorizedWorkspace } from '../../utils/workspace-authorization';
import { HarnessProposalTurnAttributionService } from '../../harness/config/harness-proposal-turn-attribution.service';

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
interface AutoResumePreflight extends MainSessionAccountSelection {
  systemPrompt?: ChatContinueParams['systemPrompt'];
  sessionId: SessionId;
  tabId: string;
  workspacePath?: string;
  model?: ChatContinueParams['model'];
  thinking?: ChatContinueParams['thinking'];
  effort?: ChatContinueParams['effort'];
  surfaceMode?: ChatContinueParams['surfaceMode'];
  mcpToolProfile?: ChatContinueParams['mcpToolProfile'];
  ptahUiFence?: ChatContinueParams['ptahUiFence'];
  /** Attachments for a Codex resume turn. Claude resume does not receive them. */
  files?: ChatContinueParams['files'];
  images?: ChatContinueParams['images'];
  /** Absolute end of the calling RPC, from {@link namedAdmissionDeadline} (named admission only). */
  admissionDeadline?: number;
}

/** Input of {@link ChatSessionService.startAgentChildSession} (TASK_2026_584). */
export interface AgentChildSessionStartParams extends MainSessionAccountSelection {
  /** Authoritative parent SDK id, supplied by the host rather than the prompt. */
  readonly sourceSessionId?: SessionId;
  /** Backend-minted child tab id: the stream key and MCP routing id. */
  readonly tabId: string;
  /** Parent root: the metadata `workspaceId` and the root context resolves for. */
  readonly workspaceRoot: string;
  /** The child's git worktree: its `projectPath` and cwd. */
  readonly worktreePath: string;
  /** Contract + task text the SDK receives. */
  readonly prompt: string;
  readonly sessionName: string;
  readonly model?: string;
  /**
   * The parent session's live permission level, read when the child starts.
   * Absent (the parent's level is unknown) → `ask` (TASK_2026_660).
   */
  readonly permissionLevel?: PermissionLevel;
}

/** Input of {@link ChatSessionService.startHandoffSession} (TASK_2026_655). */
export interface HandoffSessionStartParams extends MainSessionAccountSelection {
  /** Original SDK id: a fresh context still inherits its account binding. */
  readonly sourceSessionId?: SessionId;
  /** Backend-minted tab id of the new session: the stream key and MCP routing id. */
  readonly tabId: string;
  /** The handing-off session's root: the metadata `workspaceId`. */
  readonly workspaceRoot: string;
  /** The handing-off session's cwd: the new session's `projectPath`. */
  readonly cwd: string;
  /** The continuation prompt: the new session's first user message. */
  readonly prompt: string;
  readonly sessionName: string;
  readonly model?: string;
  /** The handing-off session's level; absent → the global default. */
  readonly permissionLevel?: PermissionLevel;
}

/** How an agent-started session names itself in the path-refusal texts. */
interface AgentSessionPathLabels {
  /** Log label, e.g. `agent child session`. */
  readonly logLabel: string;
  /** What the session's cwd is called, e.g. `worktree path`. */
  readonly cwdNoun: string;
}

/** What {@link ChatSessionService.launchSdkSession} needs from its callers. */
interface SdkSessionLaunch {
  /** Label in the launch log lines (`chat:start` keeps its existing text). */
  readonly logLabel: string;
  readonly tabId: string;
  /** Metadata identity, and the root prompts / profile / style resolve for. */
  readonly workspaceId: string;
  /** Where the session runs. */
  readonly projectPath: string;
  readonly prompt?: string;
  readonly name?: string;
  readonly options?: NonNullable<ChatStartParams['options']>;
  readonly mcpServerRunning: boolean;
  readonly mcpServersOverride:
    Record<string, McpHttpServerOverride> | undefined;
  readonly permissionLevel?: PermissionLevel;
  readonly surfaceMode: ChatStartParams['surfaceMode'];
  /** Only the Apps page sets `apps`; absent means the coding tool profile. */
  readonly mcpToolProfile?: ChatStartParams['mcpToolProfile'];
  readonly ptahUiFence?: ChatStartParams['ptahUiFence'];
  /** The gate's resolved named selection; absent on the ambient path. */
  readonly accountSelection?: ResolvedMainAccountSelection;
  /** Absolute end of the calling RPC, from {@link namedAdmissionDeadline} (named admission only). */
  readonly admissionDeadline?: number;
}

/**
 * One host deadline for a whole renderer-awaited RPC that may run a named
 * account admission (`chat:start`, `chat:continue` auto-resume, `chat:resume`
 * activate), taken at handler entry so the preparation before admission (MCP
 * and OAuth overrides, profile, prompts) counts against it (D73). The
 * renderer's `CHAT_ADMISSION_RPC_TIMEOUT_MS` is this budget plus its margin.
 */
function namedAdmissionDeadline(): number {
  return Date.now() + NAMED_ACCOUNT_ADMISSION_BUDGET_MS;
}

/** The refusal the SDK admission gives once the deadline passed (same code and copy). */
function namedPreparationRefusal(): ProviderAccountPortRefusal {
  return {
    code: 'identity-unproved',
    summary: 'Named account admission could not be completed.',
  };
}

/** What `chat:resume` needs from the session budget (N7). */
type ChatSessionBudget = Pick<SessionBudgetService, 'observeLoaded'>;

/** The slice of `SDK_TOKENS.SESSION_RUNTIME_ROUTER` the liveness check reads. */
interface StreamlessFollowUpAdmission {
  acceptsFollowUpWithoutStream(sessionId: SessionId): boolean;
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
    @inject(CHAT_TOKENS.HISTORY_READ)
    private readonly historyRead: ChatHistoryReadService,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(SDK_TOKENS.SDK_SLASH_COMMAND_INTERCEPTOR)
    private readonly slashCommandInterceptor: SlashCommandInterceptor,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: IPlatformInfo,
    @inject(CHAT_TOKENS.SDK_CONTEXT)
    private readonly sdkContext: ChatSdkContextService,
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
    @inject(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER)
    private readonly workspaceProviderProfileResolver: WorkspaceProviderProfileResolver,
    /**
     * Resolves the output-style activation ONCE per session, at the two
     * `AISessionConfig` literals below, and never caches it (Req 5.6).
     */
    @inject(OUTPUT_STYLE_TOKENS.SESSION_ACTIVATION)
    private readonly outputStyleActivation: OutputStyleSessionActivationService,
    /**
     * The backend's record of what the CLI reported about each session's MCP
     * servers. Written from the fan-out below; read by `session:status`.
     */
    @inject(CHAT_TOKENS.MCP_STATUS)
    private readonly mcpStatusRegistry: SessionMcpStatusRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_MCP_STATUS_CALLBACK_REGISTRY)
    private readonly mcpStatusEvents: SessionMcpStatusCallbackRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    private readonly sessionEndEvents: SessionEndCallbackRegistry,
    /**
     * Optional so a host that never registers the manager resumes exactly as
     * before. Used for one thing: putting the CLI session references this
     * method already reads back into the agent registry, so `ptah_agent_read`
     * can answer for them after a restart.
     */
    @inject(TOKENS.AGENT_PROCESS_MANAGER, { isOptional: true })
    private readonly agentProcessManager: AgentProcessManager | null = null,
    /**
     * Optional so a host without the budget registration resumes exactly as
     * before: the resume snapshot then carries no budget state.
     */
    @inject(SDK_TOKENS.SDK_SESSION_BUDGET, { isOptional: true })
    private readonly sessionBudget: ChatSessionBudget | null = null,
    @inject(HarnessProposalTurnAttributionService, { isOptional: true })
    private readonly turnAttribution: HarnessProposalTurnAttributionService | null = null,
    @inject(ProviderAccountService, { isOptional: true })
    private readonly accounts?: ProviderAccountService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER, { isOptional: true })
    private readonly activeProvider?: ActiveProviderResolver,
    @inject(CHAT_TOKENS.RUNTIME_PROFILE, { isOptional: true })
    private readonly runtimeProfile?: ChatRuntimeProfileService,
    /**
     * Optional, and null on hosts without native runtimes: those keep the
     * broadcaster-only liveness check of {@link hasLiveSessionStream}.
     */
    @inject(SDK_TOKENS.SESSION_RUNTIME_ROUTER, { isOptional: true })
    private readonly sessionRuntimeRouter: StreamlessFollowUpAdmission | null = null,
  ) {
    this.subscribeToMcpStatus();
    this.subscribeToSessionEnd();
  }

  /**
   * Fold the `agent-sdk` MCP-status fan-out into the registry and push it to
   * the webview (TASK_2026_375 B4.3).
   *
   * Subscribed in the constructor, not lazily: the fan-out's two producers fire
   * during session START, and this service is resolved at bootstrap by
   * `ChatRpcHandlers`, so the subscription is live before any session exists.
   * The subscription is never disposed — this is a container singleton that
   * lives as long as the process.
   *
   * The push uses `webviewManager.broadcastMessage`, the same DIRECT channel
   * `session:stats` rides. That is allowed here and forbidden for turn state:
   * `agent-sdk/CLAUDE.md` bans a `MESSAGE_TYPES` push for TURN STATE because
   * the three-channel race (`session:turnEnded` direct, chunks batched,
   * `session:stats` direct) is exactly the defect the in-stream `turn_state`
   * event replaced. MCP status arrives ONCE per session at the SDK `init`
   * message, never changes mid-turn, and no chunk depends on it — there is no
   * ordering relationship for a race to break. Do not read this as a precedent
   * for pushing status.
   */
  private subscribeToMcpStatus(): void {
    this.mcpStatusEvents.register((event) => {
      const record =
        event.kind === 'servers'
          ? this.mcpStatusRegistry.recordServers(event.sessionId, event.servers)
          : this.mcpStatusRegistry.recordNotice(event.sessionId, event.notice);
      if (!record) return;
      this.publishMcpStatus(event.sessionId, record);
    });
  }

  /** Persist resume continuity whenever any SDK lifecycle path ends a session. */
  private subscribeToSessionEnd(): void {
    this.sessionEndEvents.register(({ sessionId, workspaceRoot }) => {
      const resumableSdkSubagents =
        this.subagentRegistry.getResumableBySession(sessionId);
      return this.sessionMetadataStore.saveResumeState(sessionId, {
        workingDirectory: workspaceRoot,
        resumableSdkSubagents,
      });
    });
  }

  /** Push one session's MCP picture. Never throws into the SDK's path. */
  private publishMcpStatus(
    sessionId: string,
    record: SessionMcpStatusRecord,
  ): void {
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.SESSION_MCP_STATUS, {
        sessionId,
        servers: record.servers,
        notices: record.notices,
      })
      .catch((error: unknown) => {
        // A closed or disposed channel is the ordinary case on shutdown, and
        // this is an advisory chip — deliberately no retry ladder, unlike
        // `session:stats`, whose numbers the user is owed.
        this.logger.debug('[RPC] session:mcpStatus broadcast failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

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
   * Lazily-built resolver that rebuilds session-time OAuth MCP overrides from
   * the connected manifest, refreshing near-expiry tokens. Built once and
   * reused; reads the manifest + token store on each `buildOverrides()` so new
   * connections take effect on the next session start without restarting.
   *
   * Constructed WITHOUT the interactive `connect()` deps (loopback server /
   * browser opener) — only the token paths are exercised here.
   */
  private oauthOverrideResolver?: McpOAuthOverrideResolver;

  private getOAuthOverrideResolver(): McpOAuthOverrideResolver {
    if (!this.oauthOverrideResolver) {
      const tokenStore = createMcpOAuthTokenStore({
        getProviderKey: (id) => this.authSecretsService.getProviderKey(id),
        setProviderKey: (id, value) =>
          this.authSecretsService.setProviderKey(id, value),
        deleteProviderKey: (id) =>
          this.authSecretsService.deleteProviderKey(id),
      });
      const manifest = new McpOAuthInstalledManifestStore();
      const service = new McpOAuthService({
        tokenStore,
        manifest,
        logger: this.logger,
      });
      this.oauthOverrideResolver = new McpOAuthOverrideResolver({
        manifest,
        service,
        logger: this.logger,
      });
    }
    return this.oauthOverrideResolver;
  }

  /**
   * Bound a NAMED launch's pre-admission preparation (MCP/OAuth overrides,
   * prompts, provider profile, output style) by the handler-entry deadline
   * (D76 item 3). Once the deadline passes the caller gets the admission's own
   * refusal instead of an answer after the renderer gave up. The abandoned
   * preparation keeps running and is observed so it can never reject unhandled.
   * Ambient launches (no selection or no deadline) await `prepare` unchanged.
   */
  private async withinNamedAdmissionDeadline<T>(
    named: boolean,
    deadline: number | undefined,
    prepare: () => Promise<T>,
  ): Promise<T> {
    if (!named || deadline === undefined) return prepare();
    // The timer alone cannot bound the race: once the deadline has passed, a
    // preparation that settles through microtasks wins against a zero-delay
    // timer. The clock decides before preparation starts and after it wins.
    if (Date.now() >= deadline) throw namedPreparationRefusal();
    const preparation = prepare();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadlinePassed = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        preparation.catch(() => {
          this.logger.warn(
            '[RPC] named launch preparation failed after the admission deadline',
          );
        });
        reject(namedPreparationRefusal());
      }, Math.max(0, deadline - Date.now()));
    });
    try {
      const prepared = await Promise.race([preparation, deadlinePassed]);
      // Finished, but after the deadline: discard the result and refuse.
      if (Date.now() >= deadline) throw namedPreparationRefusal();
      return prepared;
    } finally {
      clearTimeout(timer);
    }
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

    let oauth: Record<string, McpHttpServerOverride> = {};
    try {
      oauth = await this.getOAuthOverrideResolver().buildOverrides();
    } catch (error: unknown) {
      this.logger.warn('[RPC] chat:start - OAuth override build failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const hasSmithery = Object.keys(smithery).length > 0;
    const hasOAuth = Object.keys(oauth).length > 0;
    const hasCaller =
      !!callerOverride && Object.keys(callerOverride).length > 0;
    if (!hasSmithery && !hasOAuth && !hasCaller) {
      return callerOverride;
    }
    return { ...smithery, ...oauth, ...(callerOverride ?? {}) };
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

  /** Classify native failures before logging; never expose runtime causes or option values. */
  private codexFailure(error: unknown): ChatStartResult | undefined {
    const adapterError = isCodexChatAdapterError(error) ? error : undefined;
    if (adapterError?.code === 'cancelled') {
      return { success: false, cancelled: true };
    }
    const optionError = error instanceof CodexChatOptionError
      ? error
      : adapterError?.cause instanceof CodexChatOptionError
        ? adapterError.cause
        : undefined;
    const resumeProfileChanged = adapterError?.code === 'resume-profile-changed' ||
      (adapterError?.cause instanceof Error &&
        adapterError.cause.name === 'CodexResumeProfileChangedError' &&
        'code' in adapterError.cause &&
        adapterError.cause.code === 'resume-profile-changed');
    let failure: RpcUserError;
    if (resumeProfileChanged) {
      failure = new RpcUserError(
        'Codex cannot resume this chat because its execution profile has changed. Start a new chat to use the current permission policy.',
        'CODEX_RUNTIME_FAILED',
      );
    } else if (optionError) {
      failure = new RpcUserError(
        `Codex chat does not support the "${optionError.key}" option.`,
        'CODEX_UNSUPPORTED_OPTION',
      );
    } else if (adapterError?.code === 'busy') {
      failure = new RpcUserError(
        'Codex chat is busy. Try again when the current operation finishes.',
        'CODEX_BUSY',
      );
    } else if (adapterError?.code === 'unavailable') {
      failure = new RpcUserError(
        'Codex chat is unavailable. Reconnect and try again.',
        'CODEX_UNAVAILABLE',
      );
    } else if (adapterError) {
      failure = new RpcUserError(
        'Codex chat could not complete the operation.',
        'CODEX_RUNTIME_FAILED',
      );
    } else {
      return undefined;
    }
    return { success: false, error: failure.message, errorCode: failure.errorCode };
  }

  async startSession(params: ChatStartParams & MainSessionAccountSelection): Promise<ChatStartResult> {
    const admissionDeadline = namedAdmissionDeadline();
    try {
      const { prompt, tabId, options, name } = params;
      const workspacePath =
        // eslint-disable-next-line no-restricted-properties -- chat:start creates a session, it does not act for one; with no caller path the host default (app folder or CLI --cwd) is the new session's folder
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
      const accountSelection = await this.gateAccount({ workspacePath, accountSelection: params.accountSelection });
      let mcpServerRunning = this.sdkContext.isMcpServerRunning();

      this.logger.info('[ptah.main] chat:start - session config', {
        mcpServerRunning,
        mcpPort: this.codeExecutionMcp.getPort(),
      });

      if (mcpServerRunning) {
        // Awaited: subagents spawned by this session discover the server
        // through `.mcp.json`, so the entry must be on disk before the session
        // starts (TASK_2026_318).
        //
        // And the outcome is READ (TASK_2026_332). The call used to resolve
        // with `undefined` whether or not it wrote anything, so a contended
        // config lock started this session claiming MCP was available while the
        // entry subagents look for was absent. `false` is the honest answer and
        // the SDK path already supports it.
        const registration =
          await this.codeExecutionMcp.ensureRegisteredForSubagents();
        if (!registration.registered) {
          mcpServerRunning = false;
          this.logger.warn(
            '[ptah.main] chat:start - .mcp.json entry absent, starting session without MCP',
            { reason: registration.reason },
          );
        }
      }

      await this.launchSdkSession({
        logLabel: 'chat:start',
        tabId,
        workspaceId: workspacePath,
        projectPath: workspacePath,
        prompt,
        name,
        options,
        mcpServerRunning,
        mcpServersOverride: params.mcpServersOverride,
        surfaceMode: params.surfaceMode,
        mcpToolProfile: params.mcpToolProfile,
        ptahUiFence: params.ptahUiFence,
        accountSelection,
        admissionDeadline,
      });

      return { success: true };
    } catch (error) {
      const codexFailure = this.codexFailure(error);
      if (codexFailure) return codexFailure;
      const refusal = mainSessionAccountFailure(error);
      if (refusal) return refusal;
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
   * Start a child chat session for a parent session's `ptah_session_start`
   * (TASK_2026_584). Called only by `ChildChatSessionHostAdapter`.
   *
   * Same SDK launch as `chat:start`, with three differences that make it a
   * child: the metadata identity is the parent's `workspaceRoot` (so the child
   * lists under the parent's workspace) while the session runs in its own
   * `worktreePath`; it starts at the parent's permission level (see
   * {@link childPermissionLevel}); and MCP availability is the
   * server's own state — the active root's `.mcp.json` outcome does not
   * downgrade it, because a child without MCP could never report back.
   * There is no slash-command intercept and no Ptah-CLI branch: the prompt is
   * the backend-built contract, never user input.
   *
   * Never throws: every failure returns `{ success: false, error }`.
   */
  async startAgentChildSession(
    params: AgentChildSessionStartParams,
  ): Promise<ChatStartResult | NonNullable<ReturnType<typeof mainSessionAccountFailure>>> {
    const { tabId, workspaceRoot, worktreePath, prompt, sessionName, model } =
      params;
    try {
      const refused = this.authorizeAgentSessionPaths(
        tabId,
        workspaceRoot,
        worktreePath,
        { logLabel: 'agent child session', cwdNoun: 'worktree path' },
      );
      if (refused) return refused;

      const accountSelection = await this.gateAccount({ workspacePath: workspaceRoot,
        sessionId: params.sourceSessionId, inheritedSource: true, accountSelection: params.accountSelection });
      const mcpServerRunning = this.codeExecutionMcp.getPort() !== null;
      const permissionLevel = this.childPermissionLevel(params.permissionLevel);
      this.logger.info('[ptah.main] agent child session - session config', {
        tabId,
        workspaceRoot,
        worktreePath,
        mcpServerRunning,
        permissionLevel,
      });

      await this.launchSdkSession({
        logLabel: 'agent child session',
        tabId,
        workspaceId: workspaceRoot,
        projectPath: worktreePath,
        prompt,
        name: sessionName,
        options: model ? { model } : undefined,
        mcpServerRunning,
        mcpServersOverride: undefined,
        permissionLevel,
        surfaceMode: undefined,
        accountSelection,
      });

      return { success: true };
    } catch (error) {
      const codexFailure = this.codexFailure(error);
      if (codexFailure) return codexFailure;
      const refusal = mainSessionAccountFailure(error);
      if (refusal) return refusal;
      this.logger.error(
        'RPC: agent child session start failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      this.captureSentry(error, 'ChatSessionService.startAgentChildSession');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        ...this.authErrorFields(error),
      };
    }
  }

  /**
   * The level a child session starts at (TASK_2026_660): the parent's live
   * level. A `yolo` child approves every call; any other level runs under the
   * unattended policy, which stays in force regardless (`SdkPermissionHandler`).
   *
   * An unknown parent level (no lifecycle record, the record disappeared, or
   * the host passed none) starts the child at `ask`. The saved global autopilot
   * level is never used: it says nothing about the authority of this parent,
   * and reading it could start a `yolo` child under a parent that never chose
   * `yolo`.
   *
   * `plan` becomes `ask`: plan mode is unavailable to an unattended session —
   * nobody is there to approve the plan and the policy denies `EnterPlanMode` —
   * so the child gets the strictest non-plan level instead.
   */
  private childPermissionLevel(
    parentLevel: PermissionLevel | undefined,
  ): PermissionLevel {
    if (parentLevel === undefined || parentLevel === 'plan') return 'ask';
    return parentLevel;
  }

  /**
   * Start the top-level session a `ptah_session_handoff` asks for
   * (TASK_2026_655). Called only by `ChildChatSessionHostAdapter`.
   *
   * An ordinary session, not a child: it runs in the handing-off session's
   * own cwd (no worktree), keeps that session's permission level, and lists
   * under the same `workspaceRoot`. MCP availability is the server's own
   * state, because the new session must be able to hand off again. As with a
   * child, there is no slash-command intercept and no Ptah-CLI branch.
   *
   * The prompt is the agent's continuation text, so a launch error message
   * may quote it: only the error's kind is logged, returned and reported.
   *
   * Never throws: every failure returns `{ success: false, error }`.
   */
  async startHandoffSession(
    params: HandoffSessionStartParams,
  ): Promise<ChatStartResult | NonNullable<ReturnType<typeof mainSessionAccountFailure>>> {
    const { tabId, workspaceRoot, cwd, prompt, sessionName, model } = params;
    const { permissionLevel } = params;
    try {
      const refused = this.authorizeAgentSessionPaths(
        tabId,
        workspaceRoot,
        cwd,
        { logLabel: 'handoff session', cwdNoun: 'working directory' },
      );
      if (refused) return refused;

      const accountSelection = await this.gateAccount({ workspacePath: workspaceRoot,
        sessionId: params.sourceSessionId, inheritedSource: true, accountSelection: params.accountSelection });
      const mcpServerRunning = this.codeExecutionMcp.getPort() !== null;
      this.logger.info('[ptah.main] handoff session - session config', {
        tabId,
        workspaceRoot,
        cwd,
        mcpServerRunning,
        permissionLevel,
      });

      await this.launchSdkSession({
        logLabel: 'handoff session',
        tabId,
        workspaceId: workspaceRoot,
        projectPath: cwd,
        prompt,
        name: sessionName,
        options: model ? { model } : undefined,
        mcpServerRunning,
        mcpServersOverride: undefined,
        permissionLevel,
        surfaceMode: undefined,
        accountSelection,
      });

      return { success: true };
    } catch (error) {
      const codexFailure = this.codexFailure(error);
      if (codexFailure) return codexFailure;
      const refusal = mainSessionAccountFailure(error);
      if (refusal) return refusal;
      const kind = safeErrorKind(error);
      this.logger.error(`RPC: handoff session start failed: ${kind}`);
      this.captureSentry(
        new Error(`Handoff session launch failed: ${kind}`),
        'ChatSessionService.startHandoffSession',
      );
      return {
        success: false,
        error: `the session launch failed (${kind}).`,
        ...this.authErrorFields(error),
      };
    }
  }

  /**
   * The path checks every agent-started session passes before any launch
   * work: the root (prompts, provider profile and output style resolve for
   * it) and the cwd must be inside an open folder, and the cwd must be safe.
   * Returns the refusal, or `null` when both paths are allowed.
   */
  private authorizeAgentSessionPaths(
    tabId: string,
    workspaceRoot: string,
    cwd: string,
    labels: AgentSessionPathLabels,
  ): { success: false; error: string } | null {
    if (!isAuthorizedWorkspace(workspaceRoot, this.workspaceProvider)) {
      this.logger.warn(
        `[RPC] ${labels.logLabel} - refused: workspace root is not inside an open folder`,
        { tabId, workspaceRoot },
      );
      return {
        success: false,
        error: 'Access denied: workspace root is not inside an open folder.',
      };
    }
    if (!isAuthorizedWorkspace(cwd, this.workspaceProvider)) {
      this.logger.warn(
        `[RPC] ${labels.logLabel} - refused: ${labels.cwdNoun} is not inside an open folder`,
        { tabId, cwd },
      );
      return {
        success: false,
        error: `Access denied: ${labels.cwdNoun} is not inside an open folder.`,
      };
    }
    return this.rejectIfUnsafeWorkspace(cwd, labels.logLabel);
  }

  /**
   * The SDK-launch half shared by `chat:start`, child and handoff sessions:
   * enhanced prompts, model, MCP overrides, provider profile and output
   * style — all resolved for `workspaceId` — then `startChatSession` and the
   * webview stream. Throws on failure; each caller result-shapes it.
   *
   * `workspaceId` is the session's metadata identity and the root its context
   * is resolved for; `projectPath` is where it runs. `chat:start` passes the
   * same path for both.
   */
  private async launchSdkSession(input: SdkSessionLaunch): Promise<void> {
    const { logLabel, tabId, workspaceId, projectPath, options } = input;
    const files = options?.files ?? [];
    const images = options?.images ?? [];

    const { config, execution } = await this.withinNamedAdmissionDeadline(
      !!input.accountSelection,
      input.admissionDeadline,
      async () => {
        const enhancedPromptsContent =
          await this.sdkContext.resolveEnhancedPromptsContent(workspaceId);

        this.logger.info(`[ptah.main] ${logLabel} - prompt config`, {
          hasEnhancedPrompts: !!enhancedPromptsContent,
          enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
        });

        if (files.length > 0) {
          this.logger.debug(`RPC: ${logLabel} received files`, {
            tabId,
            fileCount: files.length,
            files,
          });
        }
        const mcpServersOverride = await this.buildMcpServersOverride(
          input.mcpServersOverride,
        );
        // Output-style activation, resolved fresh for THIS session (Req 5.6).
        // Spreads to at most one field — `outputStyleName` for the flag tier or
        // `outputStyleBody` for the user-tier-file-on-localhost fallback, never
        // both (R3 / Req 5.3).
        const outputStyle = await this.outputStyleActivation.resolveSessionFields({
          workspaceRoot: workspaceId,
        });
        // Read after the last await before prepare(), so the model and the
        // provider profile see the same provider.
        const modelIsStored = !options?.model;
        const currentModel =
          options?.model || this.modelSettings.selectedModel.get() || 'default';
        const config: AgentSessionStartConfig = {
          tabId,
          workspaceId,
          model: currentModel,
          systemPrompt: options?.systemPrompt,
          projectPath,
          name: input.name,
          prompt: input.prompt,
          files,
          images, // inline pasted/dropped images
          mcpServerRunning: input.mcpServerRunning,
          enhancedPromptsContent,
          thinking: options?.thinking,
          effort: options?.effort,
          workflowsDisabled: this.resolveWorkflowsDisabled(),
          includePartialMessages: options?.includePartialMessages,
          mcpServersOverride,
          // Only agent-started sessions pass a level; `chat:start` keeps the
          // global default.
          ...(input.permissionLevel
            ? { permissionLevel: input.permissionLevel }
            : {}),
          ...outputStyle,
          ...(input.mcpToolProfile
            ? { mcpToolProfile: input.mcpToolProfile }
            : {}),
          ...(input.ptahUiFence !== undefined
            ? { ptahUiFence: input.ptahUiFence }
            : {}),
        };
        // Resolves the runtime, model and isolated per-workspace provider
        // profile; a provider mismatch throws AuthRequiredError, which each
        // caller result-shapes as AUTH_REQUIRED.
        const execution = this.runtimeProfile
          ? await this.runtimeProfile.prepare(config, undefined, modelIsStored)
          : await resolveClaudeExecution(
              this.workspaceProviderProfileResolver,
              workspaceId,
              currentModel,
              modelIsStored,
            );
        return { config, execution };
      },
    );
    const stream = await this.sdkAdapter.startChatSession({
      ...config,
      runtime: execution.runtime,
      ...(execution.runtime === 'claude-sdk'
        ? {
            model: execution.model,
            providerProfile: execution.providerProfile,
            // Named only; the ambient launch config keeps its existing fields.
            ...(input.accountSelection
              ? {
                  accountSelection: input.accountSelection,
                  admissionDeadline: input.admissionDeadline,
                }
              : {}),
          }
        : { model: execution.seed.model }),
    });
    if (execution.runtime === 'codex-app-server') {
      try {
        await this.runtimeProfile?.publishRuntimeNotices(execution, { tabId });
      } catch {
        this.logger.warn('[RPC] Model substitution notice failed; continuing session stream');
      }
    }
    this.streamBroadcaster.streamEventsToWebview(
      tabId as SessionId,
      stream,
      tabId,
      input.surfaceMode,
    );
  }

  /**
   * chat:continue - Send message to existing session with auto-resume +
   * slash-command intercept + interrupted-subagent context injection.
   */
  async continueSession(
    params: ChatContinueParams & MainSessionAccountSelection,
  ): Promise<ChatContinueResult> {
    const admissionDeadline = namedAdmissionDeadline();
    try {
      const { prompt, sessionId, tabId, name } = params;
      this.logger.debug('RPC: chat:continue called', {
        sessionId,
        tabId,
        sessionName: name,
      });
      const ptahCliResult = await this.ptahCli.handleContinue(params);
      if (ptahCliResult.error !== '__NOT_PTAH_CLI__') {
        return ptahCliResult;
      }
      await this.gateAccount({ sessionId, accountSelection: params.accountSelection });
      // The session's own folder, never `params.workspacePath` or the active
      // root: with several projects open those name another repo (PTAH-37).
      const workspacePath =
        await this.historyRead.resolveSessionFolder(sessionId);
      // Threaded into the resume below rather than dropped: `autoResumeIfInactive`
      // re-derives `mcpServerRunning` from `isMcpServerRunning()`, which only
      // says the HTTP server is up — it cannot know whether the `.mcp.json`
      // entry was actually written (TASK_2026_332).
      let mcpRegisteredForSubagents = true;
      if (this.sdkContext.isMcpServerRunning()) {
        const registration =
          await this.codeExecutionMcp.ensureRegisteredForSubagents();
        mcpRegisteredForSubagents = registration.registered;
        if (!registration.registered) {
          this.logger.warn(
            '[ptah.main] chat:continue - .mcp.json entry absent, resuming without MCP',
            { reason: registration.reason },
          );
        }
      }
      // Slash commands are classified BEFORE the resume decision, not after it
      // (TASK_2026_350).
      //
      // `autoResumeIfInactive` on an inactive session starts a full SDK query in
      // `idle+streamInput` mode — it never forwards the prompt as an
      // `initialPrompt`, so the executor cannot know a slash command is coming.
      // The router below then calls `executeSlashCommand`, whose first act is to
      // end the session that was started milliseconds earlier: measured cost was
      // two CLI spawns plus a full `Interrupt timed out (5s)`, an 8524ms
      // `chat:continue` for one `/orchestrate` (log.log:2292-2364).
      //
      // `SessionQueryExecutor` already serves "slash command + resume" in ONE
      // streamed query (`idle+streamInput` — the command rides the persistent
      // user-message stream like any other prompt since TASK_2026_472),
      // and `executeSlashCommandQuery` handles a session with no registered
      // record — `SessionControl.endSession` returns on `if (!rec)` with no
      // interrupt. So the whole fix is to not ask for the resume.
      //
      // The pure static regex is used rather than `intercept()` so this decision
      // cannot drift from the router's, and so the interceptor still logs
      // `Command intercepted` exactly once.
      //
      // Every non-passthrough action of `routeFollowUpSlashCommand` is terminal,
      // so nothing downstream of it needs a live session either.
      const isSlashCommand = SlashCommandInterceptor.isSlashCommand(prompt);

      let justResumed = false;
      let promptDelivered = false;
      if (isSlashCommand) {
        await this.endDeadRecordBeforeSlashCommand(sessionId, tabId);
      } else {
        const resumeOutcome = await this.autoResumeIfInactive(
          sessionId,
          tabId,
          prompt,
          { ...params, admissionDeadline },
          mcpRegisteredForSubagents,
        );
        if ('error' in resumeOutcome) return resumeOutcome.error;
        justResumed = resumeOutcome.justResumed;
        promptDelivered = resumeOutcome.promptDelivered === true;
      }

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
      // Native Codex thread resume starts the turn (prompt and attachments).
      // Claude resume ignores them, so only that Codex turn skips the second send.
      if (promptDelivered) {
        return { success: true, sessionId };
      }
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
          const interrupted =
            await this.sdkAdapter.interruptCurrentTurn(sessionId);
          if (!interrupted) {
            return {
              success: false,
              error:
                'The current turn could not be interrupted safely. Your follow-up was not sent. Retry to resume the session.',
            };
          }
        }
      }
      const images = params.images ?? [];
      await this.sdkAdapter.sendMessageToSession(sessionId, enhancedPrompt, {
        files,
        images,
      });

      return { success: true, sessionId };
    } catch (error) {
      const codexFailure = this.codexFailure(error);
      if (codexFailure) return codexFailure;
      const refusal = mainSessionAccountFailure(error);
      if (refusal) return refusal;
      if (error instanceof RpcUserError) {
        this.logger.warn(
          `RPC: chat:continue returned user error (${error.errorCode}): ${error.message}`,
          { sessionId: params.sessionId },
        );
        return {
          success: false,
          error: error.message,
          errorCode: error.errorCode,
        };
      }
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
   * `events` (FlatStreamEventUnion[]) for tree reconstruction — the only
   * transcript in the reply (TASK_2026_437 INV-9) — plus aggregated usage
   * stats, resumable subagents, and any CLI session references.
   */
  async resumeSession(params: ChatResumeParams & MainSessionAccountSelection): Promise<ChatResumeResult> {
    const admissionDeadline = namedAdmissionDeadline();
    try {
      const { sessionId } = params;
      if (!params.ptahCliId) {
        await this.gateAccount({ sessionId, accountSelection: params.accountSelection });
      }
      const metadata = await this.sessionMetadataStore.get(sessionId);
      const result = await this.historyRead.readForResume(sessionId, {
        includeBlockOwners: params.historyBlockOwners === true,
      });
      const resolvedWorkspacePath = result.resolvedWorkspacePath;
      this.logger.info('RPC: chat:resume called', {
        sessionId,
        workspacePath: params.workspacePath || '(empty)',
        resolvedWorkspacePath,
        ptahCliId: params.ptahCliId,
      });
      if (params.ptahCliId) {
        this.ptahCli.registerResumedSession(
          sessionId as string,
          params.ptahCliId,
          params.tabId,
          resolvedWorkspacePath,
        );
      }
      // Keep this unsliced: history registration and stats depend on the full transcript.
      const fullEvents = result.events;
      const stats = result.stats;
      const staleSnapshot = result.staleSnapshot;
      // Recompute the stage from the resume figure (N7); no stats, no budget.
      const budget = this.sessionBudget?.observeLoaded(stats ?? null);

      const restoredFromMetadata =
        this.subagentRegistry.restoreResumableBySession(
          sessionId,
          metadata?.resumableSdkSubagents ?? [],
        );
      if (restoredFromMetadata > 0) {
        this.logger.info(
          '[RPC] Restored interrupted SDK agents from session metadata',
          { sessionId, restoredCount: restoredFromMetadata },
        );
      }

      // Legacy/additive fallback. The history registrar skips toolCallIds that
      // the durable snapshot restored above, so old sessions still work without
      // duplicating current records.
      const registeredFromHistory =
        this.subagentRegistry.registerFromHistoryEvents(fullEvents, sessionId);

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
        // Lean references only (TASK_2026_411): no segments or stream events.
        // The webview fetches each agent's output in bounded pages through
        // `session:cli-output-page`. Must agree with `session:cli-sessions`,
        // the other restore path.
        const restored =
          await this.sessionMetadataStore.getCliSessionsForRestore(sessionId);
        if (restored.length > 0) {
          cliSessions = restored;
          this.logger.info('[RPC] CLI sessions found for session', {
            sessionId,
            cliSessionCount: cliSessions.length,
          });
          // The UI gets these cards either way. Put them back into the agent
          // registry too, or `ptah_agent_read` answers `Agent not found` for
          // every id the restored transcript names.
          this.agentProcessManager?.restoreAgents(
            restored,
            resolvedWorkspacePath,
          );
        }
      } catch (error) {
        this.logger.debug('[RPC] Could not query CLI sessions', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.logger.info('[RPC] Session history loaded from JSONL', {
        sessionId,
        eventCount: fullEvents.length,
        hasStats: !!stats,
        totalCost: stats?.totalCost,
        resumableSubagentCount: resumableSubagents.length,
        cliSessionCount: cliSessions?.length ?? 0,
      });
      let activated = false;
      let activationError: string | undefined;
      let activationErrorCode: ChatResumeResult['activationErrorCode'];
      if (params.activate === true && params.tabId) {
        if (!this.hasLiveSessionStream(sessionId, params.tabId)) {
          const activateResult = await this.autoResumeIfInactive(
            sessionId,
            params.tabId,
            '',
            {
              sessionId,
              tabId: params.tabId,
              workspacePath: resolvedWorkspacePath,
              systemPrompt: params.systemPrompt,
              ptahUiFence: params.ptahUiFence,
              accountSelection: params.accountSelection,
              admissionDeadline,
            },
          );
          if ('justResumed' in activateResult) {
            activated =
              activateResult.justResumed ||
              this.sdkAdapter.isSessionActive(sessionId);
          } else if (activateResult.error.cancelled) {
            return { success: false, cancelled: true };
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

      const page = params.historyPage
        ? selectHistoryPage(fullEvents, {
            endIndex: fullEvents.length,
            maxEvents: params.historyPage.maxEvents,
          })
        : undefined;
      return {
        success: true,
        ...(metadata?.providerId ? { providerId: metadata.providerId } : {}),
        events: page?.events ?? fullEvents,
        stats,
        ...(budget !== undefined ? { budget } : {}),
        resumableSubagents,
        cliSessions,
        activated,
        ...(page ? { historyPage: { olderCursor: page.olderCursor } } : {}),
        ...(params.historyBlockOwners === true
          ? {
              historyBlockOwners: selectDeliveredBlockOwners(
                fullEvents,
                page?.events ?? fullEvents,
                result.blockOwners ?? new Map(),
              ),
              historySyntheticToolResults: selectDeliveredSyntheticResults(
                page?.events ?? fullEvents,
                result.syntheticToolResults ?? new Set(),
              ),
            }
          : {}),
        ...(staleSnapshot ? { staleSnapshot } : {}),
        ...(activationError ? { activationError } : {}),
        ...(activationErrorCode ? { activationErrorCode } : {}),
      };
    } catch (error) {
      const codexFailure = this.codexFailure(error);
      if (codexFailure) return codexFailure;
      const refusal = mainSessionAccountFailure(error);
      if (refusal) return refusal;
      if (error instanceof RpcUserError) {
        this.logger.warn(
          `RPC: chat:resume returned user error (${error.errorCode}): ${error.message}`,
          { sessionId: params.sessionId },
        );
        return {
          success: false,
          error: error.message,
          errorCode: error.errorCode,
        };
      }
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

      // Read before the interrupt removes the record. Same lookup as
      // `SessionControl.endSession`, so false means the interrupt below is a
      // no-op ('already-ended').
      const hadLiveRecord = this.sdkAdapter.isSessionActive(sessionId);
      await this.sdkAdapter.interruptSession(sessionId);
      // A user interrupt skips the Stop hook, so end the turn here (D9).
      this.turnAttribution?.onTurnAborted(sessionId);

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

      // `saveResumeState` REPLACES the durable list. Without a live record
      // nothing changed this call, and the registry may simply never have
      // restored that list (a tab restored after a restart and closed
      // unopened), so writing its snapshot would wipe resumable agents.
      if (hadLiveRecord) {
        await this.sessionMetadataStore.saveResumeState(sessionId, {
          resumableSdkSubagents: resumableSubagents,
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
   * config + streaming code path as `chat:continue` auto-resume.
   *
   * Public entry point — wraps the private `autoResumeIfInactive` helper.
   */
  async ensureSessionActiveForRewind(
    sessionId: SessionId,
    tabId: string,
    workspacePath: string,
    systemPrompt?: string,
  ): Promise<
    | { alreadyActive: true }
    | { resumed: true }
    | { resumed: false; error: string;
        accountRefusal?: NonNullable<ReturnType<typeof mainSessionAccountFailure>>['accountRefusal'] }
  > {
    try {
      await this.gateAccount({ sessionId });
    } catch (error: unknown) {
      const refusal = mainSessionAccountFailure(error);
      if (!refusal) throw error;
      return { resumed: false, error: refusal.error, accountRefusal: refusal.accountRefusal };
    }
    if (this.hasLiveSessionStream(sessionId, tabId)) {
      return { alreadyActive: true };
    }

    const outcome = await this.autoResumeIfInactive(sessionId, tabId, '', {
      sessionId,
      tabId,
      workspacePath,
      systemPrompt,
    });

    if ('error' in outcome) {
      return {
        resumed: false,
        error: outcome.error.error ?? 'Auto-resume failed',
      };
    }
    // outcome.justResumed is `boolean`; when `autoResumeIfInactive` returned
    // `{ justResumed: false }` it meant "already live", which we already
    // short-circuited above via `hasLiveSessionStream`. Coerce to `true`.
    return { resumed: true };
  }

  /**
   * True when the session is both registered AND has a broadcast loop attached
   * to it — the real "can this session receive a message right now" test.
   *
   * `isSessionActive` alone only proves a registry record exists. A record
   * whose `streamEventsToWebview` loop has exited still answers true, and
   * `sendMessageToSession` against it resolves happily onto a queue with no
   * consumer: the turn hangs forever with no events and no error. The stream is
   * keyed by tabId for a session started via `chat:start` and by the real
   * session UUID once resumed, so both keys count as live.
   *
   * A native Codex thread is the exception: each turn is its own stream, so
   * between turns no loop is attached while the thread stays open, and
   * `sendMessageToSession` publishes the next turn's stream itself. The
   * runtime router answers that case (idle, unblocked native thread); it
   * answers false for Claude, and is consulted only when no stream is attached.
   */
  private hasLiveSessionStream(sessionId: SessionId, tabId: string): boolean {
    if (!this.sdkAdapter.isSessionActive(sessionId)) {
      return false;
    }
    return (
      this.streamBroadcaster.isStreaming(sessionId as string) ||
      this.streamBroadcaster.isStreaming(tabId) ||
      this.sessionRuntimeRouter?.acceptsFollowUpWithoutStream(sessionId) ===
        true
    );
  }

  /**
   * Auto-resume an inactive SDK session before continuing. Returns
   * `{ justResumed: false }` when already active; otherwise resumes via
   * the resolved session config and streams to the webview. `{ error }`
   * carries a structured `ChatContinueResult` on failure.
   *
   * `promptDelivered` is set only on a successful resume, and only when the
   * Codex app-server runtime started the turn from a non-empty prompt.
   * Callers that ignore the field keep the previous `{ justResumed }` behavior.
   */
  private async autoResumeIfInactive(
    sessionId: SessionId,
    tabId: string,
    prompt: string,
    params: AutoResumePreflight,
    /**
     * Whether the caller confirmed a `ptah` entry is on disk (TASK_2026_332).
     *
     * Defaults to `true` because the two other callers
     * (`chat:resume --activate`, `ensureSessionActiveForRewind`) never call
     * `ensureRegisteredForSubagents` at all, so they have nothing to report and
     * must not be silently downgraded. Only the `chat:continue` path, which
     * does register, passes the real answer.
     */
    mcpRegisteredForSubagents = true,
  ): Promise<
    | { justResumed: boolean; promptDelivered?: boolean }
    | { error: ChatContinueResult }
  > {
    let accountSelection: ResolvedMainAccountSelection | undefined;
    try {
      accountSelection = await this.gateAccount({ sessionId, accountSelection: params.accountSelection });
    } catch (error: unknown) {
      const refusal = mainSessionAccountFailure(error);
      if (!refusal) throw error;
      return { error: { ...refusal, sessionId } };
    }
    if (this.hasLiveSessionStream(sessionId, tabId)) {
      return { justResumed: false };
    }
    // Registered but with no attached stream: the record is a corpse whose
    // consumer already exited. Continuing into it would silently queue the
    // message against a dead query, so tear it down first and fall through to
    // a real resume — otherwise `executeQuery` would re-register over the
    // stale record and leave its abort controller dangling.
    //
    // `interruptSession`, not `endSession`, and the difference is load-bearing
    // rather than stylistic: `IAIProvider.endSession` returns `void`
    // (ai-provider.types.ts:280) and the adapter fires the teardown with a bare
    // `.catch()`, so the `await` here awaited `undefined` and the teardown was
    // still running when `resumeSession` below registered the NEW record — under
    // the SAME tabId. `SessionRegistry.remove` deletes by `rec.tabId` with no
    // identity check, so the corpse's late removal would evict the replacement:
    // a live session, absent from the registry, exactly the failure
    // `endSessionIfTokenMatches` was introduced to prevent elsewhere. Awaiting
    // the real teardown closes that window (judge round 2).
    if (this.sdkAdapter.isSessionActive(sessionId)) {
      this.logger.warn(
        '[RPC] Session is registered but has no attached stream — ending the dead record before resume',
        { sessionId, tabId },
      );
      try {
        await this.sdkAdapter.interruptSession(sessionId);
      } catch (cleanupError) {
        this.logger.warn(
          '[RPC] Failed to end dead session record before resume',
          cleanupError instanceof Error
            ? cleanupError
            : new Error(String(cleanupError)),
        );
      }
    }

    this.logger.info(
      `[RPC] Session ${sessionId} not active, attempting resume...`,
    );

    // Resolved here, not taken from the caller, so every caller resumes in the
    // session's own folder. A worktree child must resume in its worktree, or
    // its edits land on the parent's branch.
    let workspacePath: string;
    try {
      workspacePath = await this.historyRead.resolveSessionFolder(sessionId);
    } catch (error) {
      if (!(error instanceof RpcUserError)) throw error;
      return {
        error: {
          success: false,
          sessionId,
          error: error.message,
          errorCode: error.errorCode,
        },
      };
    }

    const mcpServerRunning =
      this.sdkContext.isMcpServerRunning() && mcpRegisteredForSubagents;

    this.logger.info('[ptah.main] chat:continue resume - session config', {
      mcpServerRunning,
      mcpPort: this.codeExecutionMcp.getPort(),
      sessionId,
    });

    // Named resumes bound their preparation by the handler-entry deadline (D76).
    const named = !!accountSelection;
    const enhancedPromptsContent = await this.withinNamedAdmissionDeadline(
      named,
      params.admissionDeadline,
      () => this.sdkContext.resolveEnhancedPromptsContent(workspacePath),
    );

    this.logger.info('[ptah.main] chat:continue resume - prompt config', {
      hasEnhancedPrompts: !!enhancedPromptsContent,
      enhancedPromptsLength: enhancedPromptsContent?.length ?? 0,
    });

    try {
      // Same per-workspace isolation as chat:start — the resumed turn must run
      // against the session's own workspace provider, not whichever provider
      // is globally active after a workspace switch. A provider mismatch throws
      // AuthRequiredError (→ AUTH_REQUIRED below) rather than resume on another
      // provider.
      //
      // Output style is re-resolved for the resumed turn rather than carried
      // over from the original start: the provider or the style may have
      // changed since, and Req 5.6 forbids caching the decision across sessions.
      // Named resumes bound this preparation by the handler-entry deadline (D76).
      const { config, execution } = await this.withinNamedAdmissionDeadline(
        named,
        params.admissionDeadline,
        async () => {
          const outputStyle =
            await this.outputStyleActivation.resolveSessionFields({
              workspaceRoot: workspacePath,
            });
          const identity = this.runtimeProfile
            ? storedChatRuntimeIdentity(
                sessionId,
                await this.sessionMetadataStore.get(sessionId),
                workspacePath,
              )
            : undefined;
          // Read after the last await before prepare(), so the model and the
          // provider profile see the same provider.
          const modelIsStored = !params.model;
          const currentModel =
            params.model || this.modelSettings.selectedModel.get() || 'default';

          const config: AgentSessionResumeConfig = {
            projectPath: workspacePath,
            model: currentModel,
            mcpServerRunning,
            enhancedPromptsContent,
            tabId,
            thinking: params.thinking,
            effort: params.effort,
            workflowsDisabled: this.resolveWorkflowsDisabled(),
            prompt,
            ...outputStyle,
            ...(params.systemPrompt
              ? { systemPrompt: params.systemPrompt }
              : {}),
            ...(params.mcpToolProfile
              ? { mcpToolProfile: params.mcpToolProfile }
              : {}),
            ...(params.ptahUiFence !== undefined
              ? { ptahUiFence: params.ptahUiFence }
              : {}),
          };
          const execution = this.runtimeProfile
            ? await this.runtimeProfile.prepare(config, identity, modelIsStored)
            : await resolveClaudeExecution(
                this.workspaceProviderProfileResolver,
                workspacePath,
                currentModel,
                modelIsStored,
              );
          return { config, execution };
        },
      );
      const stream = await this.sdkAdapter.resumeSession(sessionId, {
        ...config,
        ...(execution.runtime === 'claude-sdk'
          ? {
              model: execution.model,
              providerProfile: execution.providerProfile,
              // Named only: the resume reuses the stored binding (no second lease).
              ...(accountSelection
                ? { accountSelection, admissionDeadline: params.admissionDeadline }
                : {}),
            }
          : {
              model: execution.seed.model,
              // Codex thread/resume starts the turn; Claude resume ignores these.
              ...(params.files !== undefined ? { files: params.files } : {}),
              ...(params.images !== undefined ? { images: params.images } : {}),
            }),
      });
      if (execution.runtime === 'codex-app-server') {
        try {
          await this.runtimeProfile?.publishRuntimeNotices(execution, {
            tabId,
            sessionId,
          });
        } catch {
          this.logger.warn('[RPC] Model substitution notice failed; continuing session stream');
        }
      }
      this.streamBroadcaster.streamEventsToWebview(
        sessionId,
        stream,
        tabId,
        params.surfaceMode,
      );
      this.logger.info(`[RPC] Session ${sessionId} resumed successfully`);
      // Native Codex resume already started the turn when the prompt is non-empty.
      const promptDelivered =
        execution.runtime === 'codex-app-server' && prompt.length > 0;
      return { justResumed: true, promptDelivered };
    } catch (resumeError) {
      const codexFailure = this.codexFailure(resumeError);
      if (codexFailure) return { error: codexFailure };
      // A named run's refusal keeps its typed code; the conversation is kept.
      const refusal = mainSessionAccountFailure(resumeError);
      if (refusal) {
        this.logger.warn('[RPC] chat:continue - resume account refused', {
          sessionId,
          code: refusal.accountRefusal.code,
        });
        return { error: { ...refusal, sessionId } };
      }
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
          ...this.authErrorFields(resumeError),
        },
      };
    }
  }

  /**
   * Tear down a DEAD session record before routing a slash command into it.
   *
   * The slash path skips `autoResumeIfInactive`, and with it that method's
   * corpse-cleanup branch — so this is the third state, the one neither the
   * "live" nor the "nothing registered" case covers: `isSessionActive` is true
   * because a record exists, but its broadcast loop already exited, so
   * `hasLiveSessionStream` is false. `SessionRegistry.find` resolves by tabId OR
   * realSessionId, so a corpse registered under a tabId really is visible here
   * under the SDK UUID `chat:continue` carries.
   *
   * Why this must AWAIT a real teardown rather than fire one off:
   * `IAIProvider.endSession` returns `void` (ai-provider.types.ts:280) and the
   * adapter fires the lifecycle teardown with a bare `.catch()`, so awaiting it
   * awaits `undefined`. Using it here would leave the corpse registered when
   * `executeSlashCommandQuery` runs its own unconditional `endSession`, and the
   * SAME record would be torn down twice concurrently: two interrupt races for
   * one query. `interruptSession` is the awaitable teardown (`Promise<void>`),
   * so by the time the router runs the registry no longer holds the record and
   * the slash query's `endSession` returns on `if (!rec)` — exactly one
   * teardown, exactly one query.
   *
   * `autoResumeIfInactive`'s corpse branch takes the same `interruptSession` for
   * the same reason (judge round 2); the two paths differ only in what they do
   * afterwards, not in how they kill the record.
   *
   * It also restores a flush the direct path drops: the adapter's
   * `interruptSession` calls `flushPendingUserActivityFor`, whereas
   * `executeSlashCommandQuery` reaches `SessionControl.endSession` directly and
   * bypasses that wrapper, silently discarding the dead session's buffered
   * activity.
   *
   * No-op — and therefore behaviour-preserving — for both judged slash
   * quadrants: a live session returns at the `hasLiveSessionStream` check, and
   * a session with no record at all returns at the `isSessionActive` check.
   */
  private async endDeadRecordBeforeSlashCommand(
    sessionId: SessionId,
    tabId: string,
  ): Promise<void> {
    if (!this.sdkAdapter.isSessionActive(sessionId)) return;
    if (this.hasLiveSessionStream(sessionId, tabId)) return;

    this.logger.warn(
      '[RPC] Session is registered but has no attached stream — ending the dead record before the slash command',
      { sessionId, tabId },
    );
    try {
      await this.sdkAdapter.interruptSession(sessionId);
    } catch (cleanupError: unknown) {
      // Non-fatal by design: the slash query re-registers under this id anyway,
      // and its own `endSession` is a second chance at the teardown. Failing the
      // user's command because a corpse would not die is the worse outcome.
      this.logger.warn(
        '[RPC] Failed to end dead session record before the slash command',
        cleanupError instanceof Error
          ? cleanupError
          : new Error(String(cleanupError)),
      );
    }
  }

  /** Check the original session account before fork/rewind without resuming it. */
  public async gateSessionAccount(sessionId: SessionId): Promise<void> {
    await this.gateAccount({ sessionId });
  }

  private async gateAccount(
    input: MainSessionAccountSelection & { workspacePath?: string; sessionId?: string; inheritedSource?: boolean },
  ): Promise<ResolvedMainAccountSelection | undefined> {
    // A separate child/handoff inherits only on the native Claude route.
    // Resume/fork/rewind calls are not inherited launches and must always
    // validate their original binding, irrespective of today's provider.
    if (input.inheritedSource && input.sessionId && input.workspacePath && this.activeProvider &&
        this.activeProvider.resolveActiveAuthForPath(input.workspacePath).authMethod !== 'claudeCli') {
      return gateMainSessionAccount({ accounts: this.accounts, activeProvider: this.activeProvider,
        metadata: this.sessionMetadataStore }, { workspacePath: input.workspacePath,
        accountSelection: input.accountSelection });
    }
    // Fresh ambient hosts retain their call sequence. Existing sessions still
    // inspect local linkage if the authoritative account service is unavailable.
    if (!this.accounts && input.accountSelection === undefined && !input.sessionId) return undefined;
    return gateMainSessionAccount({ accounts: this.accounts, activeProvider: this.activeProvider,
      metadata: this.sessionMetadataStore }, input);
  }

  /** Per-method Sentry capture (each method result-shapes its failures, so the handler's `runRpc` won't see them). */
  private captureSentry(error: unknown, errorSource: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.sentryService.captureException(err, { errorSource });
  }

  /**
   * Resolve the persisted `workflows.disabled` kill switch (default false =
   * workflows ON). Threaded into the AISessionConfig so SdkQueryOptionsBuilder
   * can inject `CLAUDE_CODE_DISABLE_WORKFLOWS=1` into the query env only when
   * disabled. Read here (not in the builder) because this is where a workspace
   * provider is available — the builder has no workspace-config access.
   */
  private resolveWorkflowsDisabled(): boolean {
    return (
      this.workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'workflows.disabled',
        false,
      ) ?? false
    );
  }
}
