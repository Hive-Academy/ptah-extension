/**
 * GatewayChatBridge — turns inbound messaging-gateway events into running
 * Ptah agent sessions and streams the assistant reply back to the chat
 * platform (Discord / Telegram / Slack).
 *
 * Inbound `GatewayInboundEvent`s are serialized per conversation via
 * {@link ConversationQueue}; each turn either starts a new SDK session (first
 * message for the conversation row) or resumes the one persisted on it.
 * Gateway-originated sessions are auto-approved from turn one: each start/resume
 * seeds the session's permission level to the frontend `'yolo'` level, so the
 * first tool call is auto-approved (no post-hoc bypass flip, no permission
 * prompt that a chat platform cannot render).
 *
 * Each turn runs in the conversation's EFFECTIVE workspace: the
 * conversation-pinned root first, then the binding root, then the active
 * Electron workspace (AC-7.2). A pinned root that left the allowlist or the
 * disk fails the turn closed — never a silent fallback to the binding root
 * (Data-2).
 */
import { access } from 'node:fs/promises';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  GATEWAY_TOKENS,
  ConversationKey,
  resolveEffectiveWorkspaceRoot,
  type ConversationStore,
  type ConversationTurnTracker,
  type GatewayConversation,
  type GatewayInboundEvent,
  type GatewayService,
  type OutboundRoute,
} from '@ptah-extension/messaging-gateway';
import {
  SessionId,
  type IAgentAdapter,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  SETTINGS_TOKENS,
  type ModelSettings,
} from '@ptah-extension/settings-core';
import { type CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import {
  SDK_TOKENS,
  type PluginLoaderService,
} from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  type EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import { ConversationQueue } from './conversation-queue';

/**
 * Hard cap on a single gateway turn. If the SDK stream neither completes nor
 * errors within this window the watchdog force-terminates the turn: it ends the
 * session, sends one error reply, and lets the `finally` seal run — guaranteeing
 * the per-conversation {@link ConversationQueue} chain always settles.
 */
const TURN_WATCHDOG_MS = 10 * 60_000;

/**
 * Fail-closed reply when the conversation's pinned workspace root is no longer
 * allowlisted or no longer exists on disk (Data-2). The user must explicitly
 * re-pick via `/workspace use` — the turn never silently falls back to the
 * binding root.
 */
const WORKSPACE_UNAVAILABLE_MESSAGE =
  "This thread's workspace is no longer available in Ptah. Run /workspace use to pick another.";

/**
 * Session context resolved once per turn and threaded into the start/resume
 * config so gateway sessions reach parity with the webview chat path
 * (enhanced prompts, plugins, code-exec MCP).
 */
interface SdkSessionContext {
  mcpServerRunning: boolean;
  enhancedPromptsContent?: string;
  pluginPaths?: string[];
}

/**
 * Per-turn cancellation flag tripped by the turn watchdog. Once tripped, the
 * now-abandoned turn's background continuation must become an inert no-op: it
 * must not bind a session id, append outbound chunks, retry via a fresh
 * session, or send an error reply — otherwise it would corrupt the shared
 * per-conversation state the NEXT dequeued turn is already using (the
 * `ConversationQueue` concurrency-1-per-key contract).
 */
interface TurnCancellation {
  cancelled: boolean;
}

@injectable()
export class GatewayChatBridge {
  private readonly queue = new ConversationQueue();
  private listener: ((event: GatewayInboundEvent) => void) | null = null;
  private stopped = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(GATEWAY_TOKENS.GATEWAY_SERVICE)
    private readonly gateway: GatewayService,
    @inject(GATEWAY_TOKENS.GATEWAY_CONVERSATION_STORE)
    private readonly conversations: ConversationStore,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly agentAdapter: IAgentAdapter,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SETTINGS_TOKENS.MODEL_SETTINGS)
    private readonly modelSettings: ModelSettings,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(AGENT_GENERATION_TOKENS.ENHANCED_PROMPTS_SERVICE)
    private readonly enhancedPromptsService: EnhancedPromptsService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(GATEWAY_TOKENS.GATEWAY_TURN_TRACKER)
    private readonly turnTracker: ConversationTurnTracker,
  ) {}

  start(): void {
    if (this.listener) return;
    this.stopped = false;
    const listener = (event: GatewayInboundEvent): void => {
      this.onInbound(event);
    };
    this.listener = listener;
    this.gateway.on('inbound', listener);
    this.logger.info('[gateway-chat-bridge] subscribed to inbound events');
  }

  stop(): void {
    this.stopped = true;
    if (this.listener) {
      this.gateway.off('inbound', this.listener);
      this.listener = null;
    }
    this.logger.info('[gateway-chat-bridge] unsubscribed from inbound events');
  }

  private onInbound(event: GatewayInboundEvent): void {
    if (this.stopped) return;
    const conversationKey = this.resolveConversationKey(event);
    // Busy-signal for the command control plane (AC-3.6/4.3/6.6): the key is
    // marked before enqueue so a queued turn behind a running one keeps it
    // busy, and released when the enqueue promise settles — which the
    // watchdog guarantees even for a wedged stream, so busy-state cannot leak.
    this.turnTracker.begin(conversationKey);
    void this.queue
      .enqueue(conversationKey, () => this.runTurn(event))
      .catch(() => undefined)
      .finally(() => this.turnTracker.end(conversationKey));
  }

  private async runTurn(event: GatewayInboundEvent): Promise<void> {
    if (this.stopped) return;
    const { binding, conversation } = event;
    const route = this.resolveRoute(event);
    const body = event.message.body;

    const resolved = resolveEffectiveWorkspaceRoot({
      conversationRoot: conversation.workspaceRoot,
      bindingRoot: binding.workspaceRoot,
      workspace: this.workspace,
    });
    if (!resolved.ok) {
      await this.sendError(
        route,
        resolved.reason === 'conversation-root-revoked'
          ? WORKSPACE_UNAVAILABLE_MESSAGE
          : 'No workspace is open in Ptah. Open a project folder, then try again.',
      );
      return;
    }
    if (!(await this.workspaceRootExists(resolved.root))) {
      await this.sendError(route, WORKSPACE_UNAVAILABLE_MESSAGE);
      return;
    }
    const workspaceRoot = resolved.root;

    // End-of-turn seal — flushes the turn's FULL accumulated text as ONE
    // outbound message AND resets the per-conversation buffer + message handle
    // so the NEXT turn starts a fresh platform message. This is the only
    // outbound flush per turn (no mid-turn send, no live `editMessage`
    // streaming). Runs exactly once in the `finally` below (success and error
    // paths alike). `completeOutboundTurn` drains internally.
    let sealed = false;
    const sealTurn = async (): Promise<void> => {
      if (sealed) return;
      sealed = true;
      await this.gateway.completeOutboundTurn(route.conversationKey);
    };

    const tabId = `gw-${conversation.id}`;
    let sessionToEnd: string | null = conversation.ptahSessionId ?? null;

    const sdkContext = await this.resolveSdkContext(workspaceRoot);

    // Tripped by the watchdog below. `turnWork` and everything it calls check
    // this before touching shared per-conversation state, so a timed-out turn's
    // background continuation cannot interfere with the next dequeued turn.
    const cancellation: TurnCancellation = { cancelled: false };

    const turnWork = async (): Promise<void> => {
      try {
        const stream = await this.openStream(
          conversation,
          body,
          workspaceRoot,
          tabId,
          sdkContext,
        );
        if (cancellation.cancelled) return;
        sessionToEnd =
          (await this.pumpStream(
            stream,
            conversation,
            tabId,
            route,
            cancellation,
          )) ?? sessionToEnd;
      } catch (error: unknown) {
        const recovered = await this.tryFallbackStart(
          error,
          conversation,
          body,
          workspaceRoot,
          tabId,
          route,
          sdkContext,
          cancellation,
        );
        if (recovered.ok) {
          sessionToEnd = recovered.sessionId ?? sessionToEnd;
        } else if (!cancellation.cancelled) {
          this.logger.error(
            '[gateway-chat-bridge] turn failed',
            error instanceof Error ? error : new Error(String(error)),
          );
          await this.sendError(
            route,
            'Ptah could not complete this request. Please try again.',
          ).catch((sendErr: unknown) => {
            this.logger.warn(
              '[gateway-chat-bridge] failed to send turn-failure error reply',
              {
                error:
                  sendErr instanceof Error ? sendErr.message : String(sendErr),
              },
            );
          });
        }
      }
    };

    // Turn watchdog: race the turn work against a hard timeout so a stream that
    // never settles (e.g. a wedged `canUseTool`) cannot wedge the conversation
    // queue. On timeout the turn is cancelled (so its abandoned continuation
    // becomes inert), the session is ended, and one error reply is sent; the
    // `finally` below then seals exactly once. The timer is cleared as soon as
    // the turn settles so a normal turn never triggers the watchdog reply.
    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const watchdog = new Promise<void>((resolve) => {
      watchdogTimer = setTimeout(() => {
        timedOut = true;
        cancellation.cancelled = true;
        resolve();
      }, TURN_WATCHDOG_MS);
    });

    try {
      await Promise.race([turnWork(), watchdog]);
      if (timedOut) {
        this.logger.warn('[gateway-chat-bridge] turn watchdog fired', {
          conversationId: String(conversation.id),
          timeoutMs: TURN_WATCHDOG_MS,
        });
        this.endSessionAfterTurn(sessionToEnd ?? tabId);
        await this.sendError(
          route,
          'This request took too long and was stopped. Please try again.',
        ).catch((sendErr: unknown) => {
          this.logger.warn(
            '[gateway-chat-bridge] failed to send watchdog error reply',
            {
              error:
                sendErr instanceof Error ? sendErr.message : String(sendErr),
            },
          );
        });
      }
    } finally {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      await sealTurn().catch((sealErr: unknown) => {
        this.logger.warn('[gateway-chat-bridge] drain failed', {
          error: sealErr instanceof Error ? sealErr.message : String(sealErr),
        });
      });
      this.endSessionAfterTurn(sessionToEnd ?? tabId);
    }
  }

  /**
   * Resolve the session context for a turn, mirroring the webview chat path
   * (`ChatSessionService` + `ChatSdkContextService`). Every external call
   * is guarded so a prompt/plugin/MCP failure degrades to safe defaults
   * rather than breaking the turn.
   */
  private async resolveSdkContext(
    workspaceRoot: string,
  ): Promise<SdkSessionContext> {
    let mcpServerRunning = false;
    try {
      mcpServerRunning = this.codeExecutionMcp.getPort() !== null;
      if (mcpServerRunning) {
        this.codeExecutionMcp.ensureRegisteredForSubagents();
      }
    } catch (error: unknown) {
      mcpServerRunning = false;
      this.logger.debug('[gateway-chat-bridge] MCP availability check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let enhancedPromptsContent: string | undefined;
    try {
      enhancedPromptsContent =
        (await this.enhancedPromptsService.getEnhancedPromptContent(
          workspaceRoot,
        )) ?? undefined;
    } catch (error: unknown) {
      this.logger.debug(
        '[gateway-chat-bridge] enhanced prompt resolution failed',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    let pluginPaths: string[] | undefined;
    try {
      pluginPaths = this.resolvePluginPaths();
    } catch (error: unknown) {
      this.logger.debug('[gateway-chat-bridge] plugin path resolution failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { mcpServerRunning, enhancedPromptsContent, pluginPaths };
  }

  /**
   * On-disk existence gate for the resolved effective root, run once per turn
   * before any session starts. Kept out of the pure resolver
   * (`resolveEffectiveWorkspaceRoot`) so that stays synchronously testable;
   * a root deleted since it was pinned/listed fails the turn closed (AC-6.3
   * spirit, Data-2).
   */
  private async workspaceRootExists(root: string): Promise<boolean> {
    try {
      await access(root);
      return true;
    } catch {
      return false;
    }
  }

  private resolvePluginPaths(): string[] | undefined {
    const config = this.pluginLoader.getWorkspacePluginConfig();
    if (!config.enabledPluginIds || config.enabledPluginIds.length === 0) {
      return undefined;
    }
    const paths = this.pluginLoader.resolvePluginPaths(config.enabledPluginIds);
    return paths.length > 0 ? paths : undefined;
  }

  /**
   * End the SDK session once the turn's stream is drained, mirroring the chat
   * path (`chat-stream-broadcaster`). Leaving the session active routes the
   * next inbound message into `resumeSession`'s "already active" branch, which
   * returns the drained existing stream and silently drops the new prompt — so
   * the second message is lost. Ending here forces the next turn to resume from
   * JSONL, which delivers the prompt and preserves conversation context.
   */
  private endSessionAfterTurn(sessionId: string): void {
    try {
      const id = SessionId.from(sessionId);
      if (this.agentAdapter.isSessionActive(id)) {
        this.agentAdapter.endSession(id);
      }
    } catch (error: unknown) {
      this.logger.warn('[gateway-chat-bridge] failed to end session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async openStream(
    conversation: GatewayConversation,
    body: string,
    workspaceRoot: string,
    tabId: string,
    sdkContext: SdkSessionContext,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    const persistedId = conversation.ptahSessionId;
    const canResume =
      !!persistedId &&
      this.agentAdapter.isSessionActive(SessionId.from(persistedId));
    const model = this.resolveModel();
    if (persistedId && canResume) {
      return this.agentAdapter.resumeSession(SessionId.from(persistedId), {
        prompt: body,
        tabId,
        projectPath: workspaceRoot,
        model,
        permissionLevel: 'yolo',
        mcpServerRunning: sdkContext.mcpServerRunning,
        enhancedPromptsContent: sdkContext.enhancedPromptsContent,
        pluginPaths: sdkContext.pluginPaths,
      });
    }
    if (persistedId) {
      try {
        return await this.agentAdapter.resumeSession(
          SessionId.from(persistedId),
          {
            prompt: body,
            tabId,
            projectPath: workspaceRoot,
            model,
            permissionLevel: 'yolo',
            mcpServerRunning: sdkContext.mcpServerRunning,
            enhancedPromptsContent: sdkContext.enhancedPromptsContent,
            pluginPaths: sdkContext.pluginPaths,
          },
        );
      } catch (error: unknown) {
        this.logger.warn(
          '[gateway-chat-bridge] resume of persisted session failed; falling back to new session',
          {
            conversationId: String(conversation.id),
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
    return this.startNew(body, workspaceRoot, tabId, sdkContext);
  }

  private startNew(
    body: string,
    workspaceRoot: string,
    tabId: string,
    sdkContext: SdkSessionContext,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    return this.agentAdapter.startChatSession({
      tabId,
      prompt: body,
      projectPath: workspaceRoot,
      workspaceId: workspaceRoot,
      model: this.resolveModel(),
      includePartialMessages: true,
      permissionLevel: 'yolo',
      mcpServerRunning: sdkContext.mcpServerRunning,
      enhancedPromptsContent: sdkContext.enhancedPromptsContent,
      pluginPaths: sdkContext.pluginPaths,
    });
  }

  private resolveModel(): string {
    return this.modelSettings.selectedModel.get() || 'default';
  }

  private async pumpStream(
    stream: AsyncIterable<FlatStreamEventUnion>,
    conversation: GatewayConversation,
    tabId: string,
    route: OutboundRoute,
    cancellation: TurnCancellation,
  ): Promise<string | null> {
    let eventCount = 0;
    let sessionUuidBound = false;
    let resolvedSessionId: string | null = null;

    // `text_delta` only accumulates into the coalescer buffer (no send). The
    // single outbound message is flushed once at end-of-turn via `sealTurn()`
    // → `completeOutboundTurn`. `message_complete` carries no text and is not
    // a flush point here — flushing mid-turn would emit a partial message.
    for await (const event of stream) {
      // Watchdog fired mid-stream: stop consuming and touching shared state so
      // the next dequeued turn owns the conversation exclusively.
      if (cancellation.cancelled) break;
      eventCount++;
      if (!sessionUuidBound && event.sessionId && event.sessionId !== tabId) {
        sessionUuidBound = true;
        resolvedSessionId = event.sessionId;
        this.bindSession(conversation, event.sessionId);
      }
      if (event.eventType === 'text_delta' && event.delta) {
        this.gateway.appendOutboundChunk(route, event.delta);
      }
    }

    // A cancelled turn never throws the zero-events sentinel — that would drive
    // the caller into `tryFallbackStart` and start a stray retry session.
    if (cancellation.cancelled) {
      return resolvedSessionId;
    }

    if (eventCount === 0) {
      throw new Error('gateway-chat-bridge: stream produced zero events');
    }

    return resolvedSessionId;
  }

  private async tryFallbackStart(
    error: unknown,
    conversation: GatewayConversation,
    body: string,
    workspaceRoot: string,
    tabId: string,
    route: OutboundRoute,
    sdkContext: SdkSessionContext,
    cancellation: TurnCancellation,
  ): Promise<{ ok: boolean; sessionId: string | null }> {
    // Turn already watchdog-terminated — do not start a stray retry session or
    // touch the next turn's conversation state.
    if (cancellation.cancelled) return { ok: false, sessionId: null };
    if (!conversation.ptahSessionId) return { ok: false, sessionId: null };
    this.logger.warn(
      '[gateway-chat-bridge] resumed turn failed; retrying with a new session',
      {
        conversationId: String(conversation.id),
        error: error instanceof Error ? error.message : String(error),
      },
    );
    try {
      const stream = await this.startNew(
        body,
        workspaceRoot,
        tabId,
        sdkContext,
      );
      if (cancellation.cancelled) return { ok: false, sessionId: null };
      const sessionId = await this.pumpStream(
        stream,
        conversation,
        tabId,
        route,
        cancellation,
      );
      return { ok: true, sessionId };
    } catch (fallbackError: unknown) {
      this.logger.error(
        '[gateway-chat-bridge] fallback new session also failed',
        fallbackError instanceof Error
          ? fallbackError
          : new Error(String(fallbackError)),
      );
      return { ok: false, sessionId: null };
    }
  }

  private bindSession(
    conversation: GatewayConversation,
    sessionUuid: string,
  ): void {
    if (sessionUuid !== conversation.ptahSessionId) {
      try {
        this.conversations.setPtahSessionId(conversation.id, sessionUuid);
      } catch (error: unknown) {
        this.logger.warn('[gateway-chat-bridge] failed to persist sessionId', {
          conversationId: String(conversation.id),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async sendError(
    route: OutboundRoute,
    message: string,
  ): Promise<void> {
    this.gateway.appendOutboundChunk(route, message);
    await this.gateway.drainOutbound(route.conversationKey);
  }

  private resolveRoute(event: GatewayInboundEvent): OutboundRoute {
    const conversationKey = this.resolveConversationKey(event);
    const { platform, externalChatId, conversationId } = event.message;
    return conversationId !== undefined
      ? { conversationKey, platform, externalChatId, conversationId }
      : { conversationKey, platform, externalChatId };
  }

  private resolveConversationKey(event: GatewayInboundEvent): ConversationKey {
    return (
      event.message.conversationKey ??
      ConversationKey.for(
        event.message.platform,
        event.message.externalChatId,
        event.message.conversationId,
      )
    );
  }
}
