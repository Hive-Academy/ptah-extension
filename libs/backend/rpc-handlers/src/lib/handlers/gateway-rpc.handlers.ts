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
  GatewayTestParams,
  GatewayTestResult,
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
    'gateway:test',
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
    this.registerTest();

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
      // SECURITY: validate platform against the explicit allow-list so the
      // setToken switch can never default into the slack branch and store a
      // token under the wrong settings key.
      if (
        params.platform !== 'telegram' &&
        params.platform !== 'discord' &&
        params.platform !== 'slack'
      ) {
        throw new Error(
          `gateway:setToken: unknown platform '${String(params.platform)}'`,
        );
      }
      if (typeof params.token !== 'string' || params.token.length === 0) {
        throw new Error('gateway:setToken: token must be a non-empty string');
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
      // SECURITY: omit pairingCode from list responses — the code is the sole
      // pairing secret and must not be serialised to the renderer IPC channel.
      // It is only included in the explicit approveBinding confirmation.
      return { bindings: bindings.map(toBindingDtoPublic) };
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
      if (typeof params.code !== 'string' || params.code.length === 0) {
        throw new Error('gateway:approveBinding requires code');
      }
      const result = this.gateway.approveBinding(
        BindingId.create(params.bindingId),
        params.ptahSessionId,
        params.workspaceRoot,
        params.code,
      );
      if (!result.ok) {
        // Do NOT log the supplied code — it's a one-time secret. Only log the
        // structured reason so dashboards can count mismatches.
        this.logger.warn('[gateway] binding approval rejected', {
          bindingId: params.bindingId,
          reason: result.error,
        });
        return { ok: false, error: result.error };
      }
      this.logger.info('[gateway] binding approved', {
        bindingId: params.bindingId,
        platform: result.binding.platform,
      });
      return { ok: true, binding: toBindingDto(result.binding) };
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
      this.logger.info('[gateway] binding blocked', {
        bindingId: params.bindingId,
        status,
        platform: binding.platform,
      });
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

  private registerTest(): void {
    this.rpcHandler.registerMethod<GatewayTestParams, GatewayTestResult>(
      'gateway:test',
      async (params) => {
        if (
          !params?.platform ||
          (params.platform !== 'telegram' &&
            params.platform !== 'discord' &&
            params.platform !== 'slack')
        ) {
          return {
            ok: false,
            error: `gateway:test: unknown platform '${String(params?.platform)}'`,
          };
        }
        return this.gateway.sendTest({
          platform: params.platform as GatewayPlatform,
          ...(params.bindingId
            ? { bindingId: BindingId.create(params.bindingId) }
            : {}),
        });
      },
    );
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

/** Public list variant — omits pairingCode so the secret never travels to the renderer. */
function toBindingDtoPublic(b: GatewayBinding): GatewayBindingDto {
  return { ...toBindingDto(b), pairingCode: null };
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
