/**
 * Gateway RPC Handlers (TASK_2026_HERMES Track 4)
 *
 * Bridges the eight `gateway:*` RPC methods to {@link GatewayService}. Lives
 * in `rpc-handlers` (not in any app) because the messaging gateway is shared
 * between Electron and VS Code hosts — both apps register these handlers via
 * `registerAllRpcHandlers()`.
 *
 * The handler is intentionally thin: it converts shared DTOs (`GatewayBindingDto`,
 * `GatewayMessageDto`) to/from the rich types in `@ptah-extension/messaging-gateway`
 * and otherwise delegates straight through. No business logic lives here.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { RpcMethodName } from '@ptah-extension/shared';
import type {
  GatewayApprovalStatus,
  GatewayApproveBindingParams,
  GatewayApproveBindingResult,
  GatewayBindingDto,
  GatewayBlockBindingParams,
  GatewayBlockBindingResult,
  GatewayListBindingsParams,
  GatewayListBindingsResult,
  GatewayListMessagesParams,
  GatewayListMessagesResult,
  GatewayMessageDto,
  GatewayPlatformId,
  GatewaySetTokenParams,
  GatewaySetTokenResult,
  GatewayStartParams,
  GatewayStartResult,
  GatewayStatusParams,
  GatewayStatusResult,
  GatewayStopParams,
  GatewayStopResult,
} from '@ptah-extension/shared';
import {
  GATEWAY_TOKENS,
  GatewayService,
  type ApprovalStatus,
  type GatewayBinding,
  type GatewayMessage,
  type GatewayPlatform,
  BindingId,
} from '@ptah-extension/messaging-gateway';

@injectable()
export class GatewayRpcHandlers {
  static readonly METHODS = [
    'gateway:status',
    'gateway:start',
    'gateway:stop',
    'gateway:setToken',
    'gateway:listBindings',
    'gateway:approveBinding',
    'gateway:blockBinding',
    'gateway:listMessages',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(GATEWAY_TOKENS.GATEWAY_SERVICE)
    private readonly gateway: GatewayService,
  ) {}

  register(): void {
    this.registerStatus();
    this.registerStart();
    this.registerStop();
    this.registerSetToken();
    this.registerListBindings();
    this.registerApproveBinding();
    this.registerBlockBinding();
    this.registerListMessages();

    this.logger.debug('Gateway RPC handlers registered', {
      methods: GatewayRpcHandlers.METHODS,
    });
  }

  // ---------------------------------------------------------------------------

  private registerStatus(): void {
    this.rpcHandler.registerMethod<GatewayStatusParams, GatewayStatusResult>(
      'gateway:status',
      async () => {
        const status = this.gateway.status();
        return {
          enabled: status.enabled,
          adapters: status.adapters.map((a) => ({
            platform: a.platform as GatewayPlatformId,
            running: a.running,
            ...(a.lastError ? { lastError: a.lastError } : {}),
          })),
        };
      },
    );
  }

  private registerStart(): void {
    this.rpcHandler.registerMethod<GatewayStartParams, GatewayStartResult>(
      'gateway:start',
      async (params) => {
        if (params?.platform) {
          await this.gateway.startPlatform(params.platform as GatewayPlatform);
        } else {
          await this.gateway.start();
        }
        return { ok: true };
      },
    );
  }

  private registerStop(): void {
    this.rpcHandler.registerMethod<GatewayStopParams, GatewayStopResult>(
      'gateway:stop',
      async (params) => {
        if (params?.platform) {
          await this.gateway.stopPlatform(params.platform as GatewayPlatform);
        } else {
          await this.gateway.stop();
        }
        return { ok: true };
      },
    );
  }

  private registerSetToken(): void {
    this.rpcHandler.registerMethod<
      GatewaySetTokenParams,
      GatewaySetTokenResult
    >('gateway:setToken', async (params) => {
      if (!params?.platform || !params?.token) {
        throw new Error('gateway:setToken requires { platform, token }');
      }
      if (params.platform === 'slack' && !params.slackAppToken) {
        throw new Error(
          'gateway:setToken for slack requires both `token` (xoxb-...) and `slackAppToken` (xapp-...)',
        );
      }
      await this.gateway.setToken({
        platform: params.platform as GatewayPlatform,
        token: params.token,
        ...(params.slackAppToken
          ? { slackAppToken: params.slackAppToken }
          : {}),
      });
      return { ok: true };
    });
  }

  private registerListBindings(): void {
    this.rpcHandler.registerMethod<
      GatewayListBindingsParams,
      GatewayListBindingsResult
    >('gateway:listBindings', async (params) => {
      const filter: { platform?: GatewayPlatform; status?: ApprovalStatus } =
        {};
      if (params?.platform)
        filter.platform = params.platform as GatewayPlatform;
      if (params?.status) filter.status = params.status as ApprovalStatus;
      const bindings = this.gateway.listBindings(filter);
      return { bindings: bindings.map(toBindingDto) };
    });
  }

  private registerApproveBinding(): void {
    this.rpcHandler.registerMethod<
      GatewayApproveBindingParams,
      GatewayApproveBindingResult
    >('gateway:approveBinding', async (params) => {
      if (!params?.bindingId) {
        throw new Error('gateway:approveBinding requires bindingId');
      }
      const binding = this.gateway.approveBinding(
        BindingId.create(params.bindingId),
        params.ptahSessionId,
        params.workspaceRoot,
      );
      return { binding: toBindingDto(binding) };
    });
  }

  private registerBlockBinding(): void {
    this.rpcHandler.registerMethod<
      GatewayBlockBindingParams,
      GatewayBlockBindingResult
    >('gateway:blockBinding', async (params) => {
      if (!params?.bindingId) {
        throw new Error('gateway:blockBinding requires bindingId');
      }
      const status: ApprovalStatus = params.status ?? 'rejected';
      const binding = this.gateway.setBindingStatus(
        BindingId.create(params.bindingId),
        status,
      );
      return { binding: toBindingDto(binding) };
    });
  }

  private registerListMessages(): void {
    this.rpcHandler.registerMethod<
      GatewayListMessagesParams,
      GatewayListMessagesResult
    >('gateway:listMessages', async (params) => {
      if (!params?.bindingId) {
        throw new Error('gateway:listMessages requires bindingId');
      }
      const messages = this.gateway.listMessages({
        bindingId: BindingId.create(params.bindingId),
        ...(params.limit !== undefined ? { limit: params.limit } : {}),
        ...(params.before !== undefined ? { before: params.before } : {}),
      });
      return { messages: messages.map(toMessageDto) };
    });
  }
}

// ---------------------------------------------------------------------------
// DTO mappers — keep the shared layer dependency-free.
// ---------------------------------------------------------------------------

function toBindingDto(b: GatewayBinding): GatewayBindingDto {
  return {
    id: String(b.id),
    platform: b.platform as GatewayPlatformId,
    externalChatId: b.externalChatId,
    displayName: b.displayName,
    approvalStatus: b.approvalStatus as GatewayApprovalStatus,
    ptahSessionId: b.ptahSessionId,
    workspaceRoot: b.workspaceRoot,
    pairingCode: b.pairingCode,
    createdAt: b.createdAt,
    approvedAt: b.approvedAt,
    lastActiveAt: b.lastActiveAt,
  };
}

function toMessageDto(m: GatewayMessage): GatewayMessageDto {
  return {
    id: String(m.id),
    bindingId: String(m.bindingId),
    direction: m.direction,
    externalMsgId: m.externalMsgId,
    ptahMessageId: m.ptahMessageId,
    body: m.body,
    voicePath: m.voicePath,
    createdAt: m.createdAt,
  };
}
