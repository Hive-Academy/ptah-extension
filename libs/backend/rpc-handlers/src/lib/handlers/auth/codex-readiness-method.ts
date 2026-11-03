import type { ICodexReadinessReader } from '@ptah-extension/auth-providers';
import type {
  AuthGetCodexReadinessParams,
  AuthGetCodexReadinessResponse,
} from '@ptah-extension/shared';
import { RpcUserError, type RpcHandler } from '@ptah-extension/vscode-core';

const TRIGGERS = ['mount', 'follow-up', 'recheck'] as const;

/** The auth RPC boundary for the host's Codex readiness reader. */
export class CodexReadinessMethod {
  constructor(
    private readonly rpcHandler: RpcHandler,
    private readonly reader?: ICodexReadinessReader,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<AuthGetCodexReadinessParams, AuthGetCodexReadinessResponse>(
      'auth:getCodexReadiness',
      async (raw: unknown): Promise<AuthGetCodexReadinessResponse> => {
        if (
          raw !== undefined &&
          (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        ) {
          throw new RpcUserError('auth:getCodexReadiness: invalid params', 'INVALID_PARAMS');
        }
        const params = (raw ?? {}) as Record<string, unknown>;
        if (params['refresh'] !== undefined && typeof params['refresh'] !== 'boolean') {
          throw new RpcUserError('auth:getCodexReadiness: invalid params', 'INVALID_PARAMS');
        }
        const options: AuthGetCodexReadinessParams = {
          ...(params['refresh'] !== undefined ? { refresh: params['refresh'] as boolean } : {}),
          ...(TRIGGERS.some(trigger => trigger === params['trigger'])
            ? { trigger: params['trigger'] as AuthGetCodexReadinessParams['trigger'] }
            : {}),
        };
        if (this.reader) return this.reader.read(options);
        return {
          binary: { state: 'unknown', reason: 'local' },
          signIn: { outcome: 'unreadable' },
          checkedAt: new Date().toISOString(),
        };
      },
    );
  }
}
