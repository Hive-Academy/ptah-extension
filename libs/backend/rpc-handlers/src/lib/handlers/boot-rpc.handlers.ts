/**
 * Boot RPC Handlers.
 *
 * One method, `boot:getReadiness`, backed by
 * `PLATFORM_TOKENS.BOOT_READINESS` (`IBootReadinessProvider` in
 * `platform-core`).
 *
 * ## Why a pull exists beside the push
 *
 * The Electron host pushes `boot:readinessChanged` on every transition, and the
 * renderer misses the first one every single time: `did-finish-load` fires when
 * the document finishes loading, and Angular's `bootstrapApplication` — and
 * therefore the `window.addEventListener('message')` that receives pushes — is
 * installed after that. A renderer reload has the same problem. So the first
 * read has to be a pull, and this is it.
 *
 * ## Why it never throws
 *
 * Same contract as `db:health` (`persistence-rpc.handlers.ts`): unavailability
 * is DATA, not an exception. The consumer of this method is a boot screen. If
 * the probe rejects, the renderer cannot learn that the boot finished and the
 * user sits behind a spinner for the rest of the session — a strictly worse
 * outcome than a slightly optimistic answer. So any failure reading the port
 * degrades to `{ readiness: 'ready', phase: 'settled' }`, which dismisses the
 * screen. Failing OPEN is the safe direction here, and only here.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IBootReadinessProvider } from '@ptah-extension/platform-core';
import type {
  RpcMethodName,
  BootGetReadinessResult,
} from '@ptah-extension/shared';
import { BootGetReadinessParamsSchema } from './boot-rpc.schema';

export type { BootGetReadinessResult } from '@ptah-extension/shared';

@injectable()
export class BootRpcHandlers {
  static readonly METHODS = [
    'boot:getReadiness',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.BOOT_READINESS)
    private readonly bootReadiness: IBootReadinessProvider,
  ) {}

  /** Register the `boot:*` methods with the shared RpcHandler. */
  register(): void {
    this.rpcHandler.registerMethod<
      Record<string, never>,
      BootGetReadinessResult
      // The transport's handler signature returns a promise; the port itself
      // is synchronous, so this is the one `async` in the path and it never
      // awaits anything.
    >('boot:getReadiness', async (params) => this.handleGetReadiness(params));

    this.logger.debug('[boot] RPC handlers registered', {
      methods: BootRpcHandlers.METHODS,
    });
  }

  private handleGetReadiness(
    params: Record<string, never> | undefined,
  ): BootGetReadinessResult {
    // The method takes no arguments, so a malformed payload cannot change the
    // answer — it is worth a log line and nothing more. Denying the read would
    // strand the boot screen, which is exactly what this method exists to
    // prevent.
    const parsed = BootGetReadinessParamsSchema.safeParse(params ?? {});
    if (!parsed.success) {
      this.logger.warn('[boot] boot:getReadiness received unexpected params', {
        issues: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
    }

    try {
      return this.bootReadiness.getReadiness();
    } catch (error: unknown) {
      this.logger.warn('[boot] boot:getReadiness fell back to ready', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return {
        readiness: 'ready',
        phase: 'settled',
        startedAt: Date.now(),
      };
    }
  }
}
