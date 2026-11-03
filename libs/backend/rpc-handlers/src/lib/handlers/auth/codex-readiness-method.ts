import type { ICodexReadinessReader } from '@ptah-extension/auth-providers';
import type {
  AuthGetCodexReadinessParams,
  AuthGetCodexReadinessResponse,
} from '@ptah-extension/shared';
import { RpcUserError, type RpcHandler } from '@ptah-extension/vscode-core';
import { CodexReadinessParamsSchema } from '../provider-account-rpc.schema';

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
        const parsed = CodexReadinessParamsSchema.safeParse(raw);
        if (!parsed.success) {
          throw new RpcUserError('auth:getCodexReadiness: invalid params', 'INVALID_PARAMS');
        }
        const options: AuthGetCodexReadinessParams = {
          ...(parsed.data.refresh !== undefined ? { refresh: parsed.data.refresh } : {}),
          ...(parsed.data.trigger !== undefined ? { trigger: parsed.data.trigger } : {}),
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
