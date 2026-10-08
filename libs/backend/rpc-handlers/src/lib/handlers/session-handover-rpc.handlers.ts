import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger, type RpcHandler } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SessionHandoverCoordinator,
  SessionTurnStateRegistry,
} from '@ptah-extension/agent-sdk';
import type { IChildChatSessionHost } from '@ptah-extension/cli-agent-runtime';
import {
  MESSAGE_TYPES,
  type BeginSessionHandoverResult,
  type CancelSessionHandoverResult,
  type GetSessionHandoverStateResult,
  type RpcMethodName,
  type SessionHandoverState,
  type SuccessorBoundResult,
} from '@ptah-extension/shared';
import {
  parseBeginSessionHandoverParams,
  parseCancelSessionHandoverParams,
  parseGetSessionHandoverStateParams,
  parseSuccessorBoundParams,
} from './session-handover-rpc.schema';

/** Transport entry point for the revisioned session-handover state machine. */
@injectable()
export class SessionHandoverRpcHandlers {
  static readonly METHODS = [
    'session:beginHandover',
    'session:cancelHandover',
    'session:successorBound',
    'session:getHandoverState',
  ] as const satisfies readonly RpcMethodName[];
  private readonly latestStates = new Map<string, SessionHandoverState>();
  private readonly stateBroadcasts = new Map<string, Promise<void>>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SessionHandoverCoordinator, { isOptional: true })
    private readonly coordinator: SessionHandoverCoordinator | null = null,
    @inject(SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY, { isOptional: true })
    private readonly turnState: SessionTurnStateRegistry | null = null,
    @inject(Symbol.for('ChildChatSessionHost'), { isOptional: true })
    private readonly successorHost: IChildChatSessionHost | null = null,
    @inject(TOKENS.WEBVIEW_MANAGER, { isOptional: true })
    private readonly webviewManager: {
      broadcastMessage(type: string, payload: unknown): Promise<void>;
    } | null = null,
  ) {
    this.coordinator?.onStateChange((state) => {
      this.latestStates.set(state.sourceSessionId, state);
      void this.scheduleStateBroadcast(state);
    });
  }

  private scheduleStateBroadcast(
    state: SessionHandoverState,
  ): Promise<void> {
    const previous = this.stateBroadcasts.get(state.sourceSessionId) ?? Promise.resolve();
    const scheduled = previous.catch(() => undefined).then(async () => {
      if (this.latestStates.get(state.sourceSessionId)?.revision !== state.revision) return;
      try {
        await this.webviewManager?.broadcastMessage(MESSAGE_TYPES.SESSION_STATS, {
          sessionId: state.sourceSessionId,
          handover: state,
        });
      } catch (error: unknown) {
        this.logger.warn('[SessionHandoverRpcHandlers] state broadcast failed', {
          operationId: state.operationId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    this.stateBroadcasts.set(state.sourceSessionId, scheduled);
    return scheduled;
  }

  register(): void {
    this.rpcHandler.registerMethod<unknown, BeginSessionHandoverResult>(
      'session:beginHandover',
      async (raw) => {
        const params = parseBeginSessionHandoverParams(raw);
        if (!params || !this.coordinator) {
          return { accepted: false, error: 'unavailable' };
        }
        const begin = this.coordinator.begin(
          params.sourceSessionId,
          'successor',
          this.turnState?.get(params.sourceSessionId)?.phase === 'generating',
          params.handoff,
        );
        if (begin.accepted && params.queuedInput) {
          this.coordinator.admitOrHold(params.sourceSessionId, {
            content: params.queuedInput,
            admission: 'require-idle',
          });
        }
        return begin;
      },
    );
    this.rpcHandler.registerMethod<unknown, CancelSessionHandoverResult>(
      'session:cancelHandover',
      async (raw) => {
        const params = parseCancelSessionHandoverParams(raw);
        if (!params || !this.coordinator) return { cancelled: false };
        const inputs = this.coordinator.cancel(params.sourceSessionId, params.operationId);
        const state = this.latestStates.get(params.sourceSessionId) ??
          this.coordinator.snapshotFor(params.sourceSessionId);
        return {
          cancelled: inputs !== undefined,
          ...(state ? { state } : {}),
        };
      },
    );
    this.rpcHandler.registerMethod<unknown, SuccessorBoundResult>(
      'session:successorBound',
      async (raw) => {
        const params = parseSuccessorBoundParams(raw);
        if (!params || !this.successorHost) return { acknowledged: false };
        return {
          acknowledged: this.successorHost.acknowledgeSuccessorBound(
            params.operationId,
            params.sourceTabId,
            params.successorTabId,
          ),
        };
      },
    );
    this.rpcHandler.registerMethod<unknown, GetSessionHandoverStateResult>(
      'session:getHandoverState',
      async (raw) => {
        const params = parseGetSessionHandoverStateParams(raw);
        if (!params || !this.coordinator) return {};
        const state = this.coordinator.snapshotFor(params.sourceSessionId);
        return state ? { state } : {};
      },
    );
    this.logger.debug('Session handover RPC handlers registered', {
      methods: [...SessionHandoverRpcHandlers.METHODS],
    });
  }
}
