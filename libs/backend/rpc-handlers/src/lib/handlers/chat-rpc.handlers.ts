/**
 * Chat RPC Handlers — thin facade (Wave C7e cleanup pass 2).
 *
 * Registers the six `chat:*` / `agent:backgroundList` RPC methods and delegates
 * each call to one of the extracted chat sub-services:
 *
 *   - `ChatPremiumContextService` — MCP-running probe + premium prompt/plugin resolution.
 *   - `ChatPtahCliService`        — Ptah CLI dispatch + the two private session maps.
 *   - `ChatStreamBroadcaster`     — webview event loop + background-agent subscription.
 *   - `ChatSessionService`        — SDK orchestration for the six chat methods.
 *
 * The six-entry METHODS tuple is preserved verbatim so `SHARED_HANDLERS`
 * coverage + runtime disjoint-ness keep working.
 *
 * Error handling: each `ChatSessionService` method already wraps its body in
 * try/catch and returns a result-shaped failure (`{ success: false, error }`)
 * after capturing the error to Sentry directly. The `runRpc` helper here adds
 * the C7d-style outer try/catch + entry/exit debug logs so any unexpected
 * throw (re-thrown error or new bug) still gets logged and captured.
 *
 * `registerChatServices(container)` from `@ptah-extension/rpc-handlers` MUST
 * be invoked BEFORE `registerAllRpcHandlers(container)` resolves this class —
 * registration order is documented in `../chat/di.ts`.
 *
 * Original history:
 *   TASK_2025_074: Extracted from monolithic RpcMethodRegistrationService.
 *   TASK_2025_203: Moved to @ptah-extension/rpc-handlers.
 *   TASK_2025_291 / Wave C7e: Split monolith into chat/ sub-services.
 *   Wave C7e cleanup pass 2: aligned with C7d harness pattern (DI over
 *   callbacks; runRpc with logging + Sentry; subagent-context + slash-command
 *   carve-outs).
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
} from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import { ModelNotAvailableError } from '@ptah-extension/agent-sdk';
import type {
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
  RpcMethodName,
} from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../chat/tokens';
import type { ChatPtahCliService } from '../chat/ptah-cli/chat-ptah-cli.service';
import type { ChatStreamBroadcaster } from '../chat/streaming/chat-stream-broadcaster.service';
import type { ChatSessionService } from '../chat/session/chat-session.service';
import { hasStopIntent } from '../chat/session/chat-stop-intent';

/** Type of the RPC handler callback used by every `rpcHandler.registerMethod`. */
type RpcHandlerFn<TParams, TResp> = (params: TParams) => Promise<TResp>;

/**
 * RPC handlers for chat operations (SDK-based).
 *
 * Owns RPC registration + light orchestration only; SDK lifecycle, streaming,
 * Ptah-CLI dispatch, subagent-context injection, and slash-command routing
 * live in the chat sub-services registered via `registerChatServices(container)`.
 */
@injectable()
export class ChatRpcHandlers {
  static readonly METHODS = [
    'chat:start',
    'chat:continue',
    'chat:resume',
    'chat:abort',
    'chat:running-agents',
    'agent:backgroundList',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(CHAT_TOKENS.PTAH_CLI)
    private readonly ptahCli: ChatPtahCliService,
    @inject(CHAT_TOKENS.STREAM_BROADCASTER)
    private readonly streamBroadcaster: ChatStreamBroadcaster,
    @inject(CHAT_TOKENS.SESSION)
    private readonly session: ChatSessionService,
  ) {}

  /**
   * Detect clear stop/cancel intent in a user message.
   *
   * Static delegate to the free `hasStopIntent` function in
   * `../chat/session/chat-stop-intent.ts`. Preserved as `static` so any
   * external callers / Sentry breadcrumbs that reference
   * `ChatRpcHandlers.hasStopIntent` keep working after the cleanup pass.
   */
  static hasStopIntent(message: string): boolean {
    return hasStopIntent(message);
  }

  /**
   * Get the resolved SDK session UUID for a Ptah CLI session.
   * Used by persistCliSessionReference to set sdkSessionId on CliSessionReference.
   */
  getPtahCliSdkSessionId(tabId: string): string | undefined {
    return this.ptahCli.getSdkSessionId(tabId);
  }

  /**
   * Track a Ptah CLI session by its real session ID.
   * Called when SESSION_ID_RESOLVED is received for a Ptah CLI session.
   */
  trackPtahCliSession(tabId: string, realSessionId: string): void {
    this.ptahCli.trackSession(tabId, realSessionId);
  }

  /**
   * Shared error funnel — mirrors the C7d harness facade.
   *
   * Logs `RPC: {method} called` on entry and `RPC: {method} success` on exit.
   * On exception, logs the error, captures it in Sentry under
   * `errorSource: ChatRpcHandlers.{tag}`, and re-throws.
   *
   * The session service already result-shapes its own failures (returning
   * `{ success: false, error }`) and captures Sentry directly via
   * `SentryService`, so on the happy + result-shaped paths this wrapper only
   * adds the entry/exit debug logs. Truly unexpected throws (e.g. a
   * re-thrown rejection inside a future delegate) hit the catch.
   */
  private runRpc<TParams, TResp>(
    method: RpcMethodName,
    tag: string,
    fn: RpcHandlerFn<TParams, TResp>,
  ): RpcHandlerFn<TParams, TResp> {
    return async (params) => {
      this.logger.debug(`RPC: ${method} called`);
      try {
        const result = await fn(params);
        this.logger.debug(`RPC: ${method} success`);
        return result;
      } catch (error) {
        if (error instanceof RpcUserError) {
          this.logger.debug(
            `RPC: ${method} returned user error (${error.errorCode})`,
          );
          throw error;
        }
        if (error instanceof ModelNotAvailableError) {
          this.logger.debug(
            `RPC: ${method} model not available (${error.requestedModel})`,
          );
          throw new RpcUserError(error.message, 'MODEL_NOT_AVAILABLE');
        }
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(`RPC: ${method} failed`, err);
        this.sentryService.captureException(err, {
          errorSource: `ChatRpcHandlers.${tag}`,
        });
        throw error;
      }
    };
  }

  /** Sugar: `runRpc` + `rpcHandler.registerMethod` combined. */
  private wire<TParams, TResp>(
    method: RpcMethodName,
    tag: string,
    fn: RpcHandlerFn<TParams, TResp>,
  ): void {
    this.rpcHandler.registerMethod<TParams, TResp>(
      method,
      this.runRpc(method, tag, fn),
    );
  }

  /** Register all chat RPC methods. */
  register(): void {
    this.wire<ChatStartParams, ChatStartResult>(
      'chat:start',
      'registerChatStart',
      (params) => this.session.startSession(params),
    );
    this.wire<ChatContinueParams, ChatContinueResult>(
      'chat:continue',
      'registerChatContinue',
      (params) => this.session.continueSession(params),
    );
    this.wire<ChatResumeParams, ChatResumeResult>(
      'chat:resume',
      'registerChatResume',
      (params) => this.session.resumeSession(params),
    );
    this.wire<ChatAbortParams, ChatAbortResult>(
      'chat:abort',
      'registerChatAbort',
      (params) => this.session.abortSession(params),
    );
    this.wire<ChatRunningAgentsParams, ChatRunningAgentsResult>(
      'chat:running-agents',
      'registerChatRunningAgents',
      (params) => this.session.getRunningAgents(params),
    );
    this.wire<
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
    >('agent:backgroundList', 'registerBackgroundAgentHandlers', (params) =>
      this.session.listBackgroundAgents(params),
    );

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
}
