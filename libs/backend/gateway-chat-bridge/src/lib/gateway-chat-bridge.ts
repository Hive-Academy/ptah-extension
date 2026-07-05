/**
 * GatewayChatBridge — turns inbound messaging-gateway events into running
 * Ptah agent sessions and streams the assistant reply back to the chat
 * platform (Discord / Telegram / Slack).
 *
 * Inbound `GatewayInboundEvent`s are serialized per conversation via
 * {@link ConversationQueue}; each turn either starts a new SDK session (first
 * message for the conversation row) or resumes the one persisted on it.
 * Gateway-originated sessions run with bypass permission (v1 auto-approve)
 * once the real SDK session UUID resolves.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  GATEWAY_TOKENS,
  ConversationKey,
  type ConversationStore,
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
import { ConversationQueue } from './conversation-queue';

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
    void this.queue.enqueue(conversationKey, () => this.runTurn(event));
  }

  private async runTurn(event: GatewayInboundEvent): Promise<void> {
    if (this.stopped) return;
    const { binding, conversation } = event;
    const route = this.resolveRoute(event);
    const body = event.message.body;

    const workspaceRoot =
      binding.workspaceRoot ?? this.workspace.getWorkspaceRoot() ?? null;
    if (!workspaceRoot) {
      await this.sendError(
        route,
        'No workspace is open in Ptah. Open a project folder, then try again.',
      );
      return;
    }

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

    try {
      const stream = await this.openStream(
        conversation,
        body,
        workspaceRoot,
        tabId,
      );
      sessionToEnd =
        (await this.pumpStream(stream, conversation, tabId, route)) ??
        sessionToEnd;
    } catch (error: unknown) {
      const recovered = await this.tryFallbackStart(
        error,
        conversation,
        body,
        workspaceRoot,
        tabId,
        route,
      );
      if (recovered.ok) {
        sessionToEnd = recovered.sessionId ?? sessionToEnd;
      } else {
        this.logger.error(
          '[gateway-chat-bridge] turn failed',
          error instanceof Error ? error : new Error(String(error)),
        );
        await this.sendError(
          route,
          'Ptah could not complete this request. Please try again.',
        );
      }
    } finally {
      await sealTurn().catch((sealErr: unknown) => {
        this.logger.warn('[gateway-chat-bridge] drain failed', {
          error: sealErr instanceof Error ? sealErr.message : String(sealErr),
        });
      });
      this.endSessionAfterTurn(sessionToEnd ?? tabId);
    }
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
      });
    }
    if (persistedId) {
      try {
        return await this.agentAdapter.resumeSession(
          SessionId.from(persistedId),
          { prompt: body, tabId, projectPath: workspaceRoot, model },
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
    return this.startNew(body, workspaceRoot, tabId);
  }

  private startNew(
    body: string,
    workspaceRoot: string,
    tabId: string,
  ): Promise<AsyncIterable<FlatStreamEventUnion>> {
    return this.agentAdapter.startChatSession({
      tabId,
      prompt: body,
      projectPath: workspaceRoot,
      workspaceId: workspaceRoot,
      model: this.resolveModel(),
      includePartialMessages: true,
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
  ): Promise<string | null> {
    let eventCount = 0;
    let sessionUuidBound = false;
    let resolvedSessionId: string | null = null;

    // `text_delta` only accumulates into the coalescer buffer (no send). The
    // single outbound message is flushed once at end-of-turn via `sealTurn()`
    // → `completeOutboundTurn`. `message_complete` carries no text and is not
    // a flush point here — flushing mid-turn would emit a partial message.
    for await (const event of stream) {
      eventCount++;
      if (!sessionUuidBound && event.sessionId && event.sessionId !== tabId) {
        sessionUuidBound = true;
        resolvedSessionId = event.sessionId;
        await this.bindSession(conversation, event.sessionId);
      }
      if (event.eventType === 'text_delta' && event.delta) {
        this.gateway.appendOutboundChunk(route, event.delta);
      }
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
  ): Promise<{ ok: boolean; sessionId: string | null }> {
    if (!conversation.ptahSessionId) return { ok: false, sessionId: null };
    this.logger.warn(
      '[gateway-chat-bridge] resumed turn failed; retrying with a new session',
      {
        conversationId: String(conversation.id),
        error: error instanceof Error ? error.message : String(error),
      },
    );
    try {
      const stream = await this.startNew(body, workspaceRoot, tabId);
      const sessionId = await this.pumpStream(
        stream,
        conversation,
        tabId,
        route,
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

  private async bindSession(
    conversation: GatewayConversation,
    sessionUuid: string,
  ): Promise<void> {
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
    try {
      await this.agentAdapter.setSessionPermissionLevel(
        SessionId.from(sessionUuid),
        'bypassPermissions',
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[gateway-chat-bridge] failed to set bypass permission',
        {
          conversationId: String(conversation.id),
          error: error instanceof Error ? error.message : String(error),
        },
      );
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
