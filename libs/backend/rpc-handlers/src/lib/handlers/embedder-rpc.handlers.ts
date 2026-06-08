/**
 * Embedder RPC Handlers.
 *
 * Surfaces two `embedder:*` methods backed by `EmbedderStatusService`
 * from `@ptah-extension/memory-curator`:
 *
 *   - embedder:status  → snapshot of ready/downloading/progress/error
 *   - embedder:retry   → user-triggered re-warmup after a failed download
 *
 * License-exempt (recovery surface) and Electron-only (better-sqlite3 +
 * ONNX worker do not run in the VS Code extension host).
 *
 * Per architecture §7 the status handler MUST NOT throw — it always
 * returns a structured snapshot. The retry handler surfaces failures
 * via `ok: false` + sanitised message instead of throwing.
 */

import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  MEMORY_TOKENS,
  EmbedderStatusService,
  type EmbedderStatusSnapshot,
} from '@ptah-extension/memory-curator';
import type {
  RpcMethodName,
  EmbedderStatusParams,
  EmbedderStatusResult,
  EmbedderStatusWire,
  EmbedderRetryParams,
  EmbedderRetryResult,
} from '@ptah-extension/shared';

function toEmbedderWire(snapshot: EmbedderStatusSnapshot): EmbedderStatusWire {
  const base: EmbedderStatusWire = {
    ready: snapshot.ready,
    downloading: snapshot.downloading,
  };
  const withProgress =
    snapshot.progress !== undefined
      ? { ...base, progress: snapshot.progress }
      : base;
  return snapshot.error
    ? {
        ...withProgress,
        error: snapshot.error.code
          ? { code: snapshot.error.code, message: snapshot.error.message }
          : { message: snapshot.error.message },
      }
    : withProgress;
}

function sanitiseErrorMessage(message: string): string {
  return message
    .replace(/[A-Za-z]:[/\\][^\s,'"]+/g, '[path redacted]')
    .replace(/\/(?:home|Users|root)\/[^\s,'"]+/g, '[path redacted]');
}

@injectable()
export class EmbedderRpcHandlers {
  static readonly METHODS = [
    'embedder:status',
    'embedder:retry',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(MEMORY_TOKENS.EMBEDDER_STATUS)
    private readonly embedderStatus: EmbedderStatusService,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<EmbedderStatusParams, EmbedderStatusResult>(
      'embedder:status',
      () => this.handleStatus(),
    );
    this.rpcHandler.registerMethod<EmbedderRetryParams, EmbedderRetryResult>(
      'embedder:retry',
      () => this.handleRetry(),
    );
    this.logger.info('[embedder] RPC handlers registered');
  }

  private async handleStatus(): Promise<EmbedderStatusResult> {
    return { status: toEmbedderWire(this.embedderStatus.getStatus()) };
  }

  private async handleRetry(): Promise<EmbedderRetryResult> {
    try {
      await this.embedderStatus.ensureReady();
      const snapshot = this.embedderStatus.getStatus();
      return {
        ok: snapshot.ready,
        status: toEmbedderWire(snapshot),
        message: snapshot.ready
          ? 'Embedder is ready.'
          : 'Embedder warmup completed but readiness signal was not raised.',
      };
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const sanitised = sanitiseErrorMessage(raw);
      this.logger.warn('[embedder] embedder:retry failed', { error: raw });
      const snapshot = this.embedderStatus.getStatus();
      return {
        ok: false,
        status: toEmbedderWire(snapshot),
        message: `Embedder retry failed: ${sanitised}`,
      };
    }
  }
}
