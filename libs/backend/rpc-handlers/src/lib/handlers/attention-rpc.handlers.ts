import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { SafeHostAttentionNotice } from '@ptah-extension/platform-core';
import type {
  AttentionGetSnapshotParams,
  AttentionGetSnapshotResult,
  AttentionNotice,
  RpcMethodName,
} from '@ptah-extension/shared';
import { AttentionNoticeSchema } from '@ptah-extension/shared';
import { RpcUserError, TOKENS, type Logger, type RpcHandler } from '@ptah-extension/vscode-core';
import {
  AttentionGetSnapshotParamsSchema,
  AttentionGetSnapshotResultSchema,
} from './attention-rpc.schema';

type PendingNoticeReader = {
  pendingNotices(): readonly SafeHostAttentionNotice[];
};

const METHOD = 'attention:getSnapshot';

@injectable()
export class AttentionRpcHandlers {
  static readonly METHODS = [METHOD] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SDK_TOKENS.HOST_ATTENTION_COORDINATOR)
    private readonly coordinator: PendingNoticeReader,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<AttentionGetSnapshotParams, AttentionGetSnapshotResult>(
      METHOD,
      async (rawParams: unknown) => this.snapshot(rawParams),
    );
    this.logger.debug('Attention RPC handler registered', { method: METHOD });
  }

  private snapshot(rawParams: unknown): AttentionGetSnapshotResult {
    if (!AttentionGetSnapshotParamsSchema.safeParse(rawParams).success) {
      throw new RpcUserError('attention:getSnapshot: invalid params', 'INVALID_PARAMS');
    }

    try {
      const notices: AttentionNotice[] = [];
      let invalidCount = 0;
      for (const notice of this.coordinator.pendingNotices()) {
        if (notice.kind === 'failure') continue;
        const parsed = AttentionNoticeSchema.safeParse({
          key: notice.key,
          generation: notice.generation,
          kind: notice.kind,
          title: notice.sessionTitle,
          occurredAt: notice.generation,
          target: { ...notice.target },
        });
        if (parsed.success) {
          notices.push(parsed.data);
        } else {
          invalidCount += 1;
        }
      }
      if (invalidCount > 0) {
        this.logger.warn('[RPC] attention:getSnapshot dropped invalid notices', {
          errorName: 'ZodError',
          count: invalidCount,
        });
      }
      return AttentionGetSnapshotResultSchema.parse({ notices });
    } catch (error: unknown) {
      this.logger.warn('[RPC] attention:getSnapshot failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw new RpcUserError('Attention snapshot unavailable.', 'PERSISTENCE_UNAVAILABLE');
    }
  }
}
