/**
 * Peer-session RPC handlers (TASK_2026_402, Requirement 10).
 *
 * Two methods over the Claude CLI's own session registry:
 *
 *  - `peerSession:list` — the sessions this user can reach, each stating a
 *    name, a workspace and whether it is reachable. Built from
 *    `~/.claude/sessions`, never from Ptah bookkeeping, because the whole
 *    point is addressing sessions Ptah did not start.
 *  - `peerSession:send` — hand one of them a message, and report what was
 *    actually observed.
 *
 * ## `accepted`, never `delivered`
 *
 * `research-report-addressing.md` (Task 10.1) established that no route
 * available to Ptah can observe arrival. This handler therefore returns
 * acceptance, carries the caveat on every response, and has no code path that
 * can report anything stronger. Do not add one without a measurement that
 * changes the research answer.
 *
 * ## Dual registration
 *
 * `peerSession:` is registered in BOTH halves, as the house rule requires:
 * `RpcMethodRegistry` in `libs/shared/.../rpc.types.ts` (compile-time) and
 * `ALLOWED_METHOD_PREFIXES` in `vscode-core/src/messaging/rpc-handler.ts`
 * (runtime guard). Missing either makes the method silently unreachable.
 */

import { inject, injectable } from 'tsyringe';
import { RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  PeerSessionDirectory,
  PeerSessionMessenger,
} from '@ptah-extension/agent-sdk';
import type {
  PeerSessionListParams,
  PeerSessionListResult,
  PeerSessionSendParams,
  PeerSessionSendResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  PeerSessionListParamsSchema,
  PeerSessionSendParamsSchema,
} from './peer-session-rpc.schema';

@injectable()
export class PeerSessionRpcHandlers {
  static readonly METHODS = [
    'peerSession:list',
    'peerSession:send',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.SDK_PEER_SESSION_DIRECTORY)
    private readonly directory: PeerSessionDirectory,
    @inject(SDK_TOKENS.SDK_PEER_SESSION_MESSENGER)
    private readonly messenger: PeerSessionMessenger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<
      PeerSessionListParams,
      PeerSessionListResult
    >('peerSession:list', async (params) => this.handleList(params));

    this.rpcHandler.registerMethod<
      PeerSessionSendParams,
      PeerSessionSendResult
    >('peerSession:send', async (params) => this.handleSend(params));

    this.logger.debug('[peerSession] RPC handlers registered', {
      methods: PeerSessionRpcHandlers.METHODS,
    });
  }

  private async handleList(
    params: PeerSessionListParams | undefined,
  ): Promise<PeerSessionListResult> {
    const parsed = PeerSessionListParamsSchema.safeParse(params ?? {});
    if (!parsed.success) {
      throw new RpcUserError(
        `peerSession:list: invalid params — ${parsed.error.message}`,
        'INVALID_PARAMS',
      );
    }

    const currentWorkspace = this.workspace.getWorkspaceRoot();
    return this.directory.list({
      ...(currentWorkspace ? { currentWorkspace } : {}),
      ...(parsed.data.excludeSessionId
        ? { excludeSessionId: parsed.data.excludeSessionId }
        : {}),
    });
  }

  private async handleSend(
    params: PeerSessionSendParams | undefined,
  ): Promise<PeerSessionSendResult> {
    const parsed = PeerSessionSendParamsSchema.safeParse(params);
    if (!parsed.success) {
      // An invalid value is an error here, never a fallback. A default
      // `sessionId` would address the wrong session; a truncated `message`
      // would send something the caller never wrote.
      throw new RpcUserError(
        `peerSession:send: invalid params — ${parsed.error.message}`,
        'INVALID_PARAMS',
      );
    }

    const currentWorkspace = this.workspace.getWorkspaceRoot();
    const result = await this.messenger.send({
      sessionId: parsed.data.sessionId,
      fromSessionId: parsed.data.fromSessionId,
      message: parsed.data.message,
      ...(currentWorkspace ? { currentWorkspace } : {}),
    });

    if (result.outcome === 'refused') {
      this.logger.warn('[peerSession] send refused', {
        reason: result.reason,
        targetSessionId: result.target?.sessionId,
      });
    }

    return result;
  }
}
