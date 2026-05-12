/**
 * Indexing RPC Handlers (TASK_2026_114 Batch 5).
 *
 * Surfaces 8 `indexing:*` methods backed by `IndexingControlService`:
 * getStatus / start / pause / resume / cancel /
 * setPipelineEnabled / dismissStale / acknowledgeDisclosure.
 *
 * All handlers are thin delegates — business logic lives in IndexingControlService.
 * The `runDeps` passed to start/resume build the CodeSymbolIndexer bridge so
 * wire-runtime only needs to pass the callable at the time of the RPC call
 * (avoids a circular-import chain from rpc-handlers → workspace-intelligence).
 *
 * NOTE: `start` and `resume` require an `IndexingRunDeps` callback set on this
 * handler via `setRunDeps()`. Wire-runtime calls `setRunDeps()` after boot so
 * the chokidar watcher and symbolIndexer references are fully constructed.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  MEMORY_TOKENS,
  type IndexingControlService,
  type IndexingRunDeps,
  type IndexingStatus,
} from '@ptah-extension/memory-curator';
import type {
  IndexingGetStatusParams,
  IndexingGetStatusResult,
  IndexingStartParams,
  IndexingStartResult,
  IndexingPauseParams,
  IndexingPauseResult,
  IndexingResumeParams,
  IndexingResumeResult,
  IndexingCancelParams,
  IndexingCancelResult,
  IndexingSetPipelineEnabledParams,
  IndexingSetPipelineEnabledResult,
  IndexingDismissStaleParams,
  IndexingDismissStaleResult,
  IndexingAcknowledgeDisclosureParams,
  IndexingAcknowledgeDisclosureResult,
  IndexingStatusWire,
  RpcMethodName,
} from '@ptah-extension/shared';

// ---- Status mapper -----------------------------------------------------------

function toStatusWire(status: IndexingStatus): IndexingStatusWire {
  return {
    state: status.state,
    workspaceFingerprint: status.workspaceFingerprint,
    gitHeadSha: status.gitHeadSha,
    currentGitHeadSha: status.currentGitHeadSha,
    lastIndexedAt: status.lastIndexedAt,
    symbolsEnabled: status.symbolsEnabled,
    memoryEnabled: status.memoryEnabled,
    symbolsCursor: status.symbolsCursor,
    disclosureAcknowledgedAt: status.disclosureAcknowledgedAt,
    lastDismissedStaleSha: status.lastDismissedStaleSha,
    errorMessage: status.errorMessage,
  };
}

// ---- Handler class -----------------------------------------------------------

@injectable()
export class IndexingRpcHandlers {
  static readonly METHODS = [
    'indexing:getStatus',
    'indexing:start',
    'indexing:pause',
    'indexing:resume',
    'indexing:cancel',
    'indexing:setPipelineEnabled',
    'indexing:dismissStale',
    'indexing:acknowledgeDisclosure',
  ] as const satisfies readonly RpcMethodName[];

  /**
   * Callable deps injected by wire-runtime after CodeSymbolIndexer is
   * resolved. If null, start/resume return `accepted: false`.
   */
  private runDeps: IndexingRunDeps | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(MEMORY_TOKENS.INDEXING_CONTROL)
    private readonly indexingControl: IndexingControlService,
  ) {}

  /**
   * Wire-runtime calls this once CodeSymbolIndexer is available (PHASE 4.53b).
   * Must be called before any `indexing:start` or `indexing:resume` RPC arrives.
   */
  setRunDeps(deps: IndexingRunDeps): void {
    this.runDeps = deps;
  }

  register(): void {
    // indexing:getStatus — returns full IndexingStatusWire for workspace
    this.rpcHandler.registerMethod(
      'indexing:getStatus',
      async (
        params: IndexingGetStatusParams | undefined,
      ): Promise<IndexingGetStatusResult> => {
        if (!params?.workspaceRoot) {
          this.logger.warn('[indexing] getStatus — missing workspaceRoot');
          return {
            status: {
              state: 'never-indexed',
              workspaceFingerprint: '',
              gitHeadSha: null,
              currentGitHeadSha: null,
              lastIndexedAt: null,
              symbolsEnabled: true,
              memoryEnabled: true,
              symbolsCursor: null,
              disclosureAcknowledgedAt: null,
              lastDismissedStaleSha: null,
              errorMessage: null,
            },
          };
        }
        try {
          const status = await this.indexingControl.getStatus(
            params.workspaceRoot,
          );
          return { status: toStatusWire(status) };
        } catch (error: unknown) {
          this.logger.warn('[indexing] getStatus failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    );

    // indexing:start — start or force-restart indexing
    this.rpcHandler.registerMethod(
      'indexing:start',
      async (
        params: IndexingStartParams | undefined,
      ): Promise<IndexingStartResult> => {
        if (!params?.workspaceRoot) {
          return { accepted: false, state: 'never-indexed' };
        }
        if (!this.runDeps) {
          this.logger.warn(
            '[indexing] start — runDeps not set (indexer not ready)',
          );
          return { accepted: false, state: 'never-indexed' };
        }
        try {
          // Fire-and-forget — state machine handles concurrency guard internally
          void this.indexingControl
            .start(params.pipeline, params.workspaceRoot, this.runDeps, {
              force: params.force,
            })
            .catch((err: unknown) => {
              this.logger.warn('[indexing] start failed (non-fatal):', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          const status = await this.indexingControl.getStatus(
            params.workspaceRoot,
          );
          return { accepted: true, state: status.state };
        } catch (error: unknown) {
          this.logger.warn('[indexing] start setup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { accepted: false, state: 'error' };
        }
      },
    );

    // indexing:pause — cooperative abort of active run
    this.rpcHandler.registerMethod(
      'indexing:pause',
      async (
        _params: IndexingPauseParams | undefined,
      ): Promise<IndexingPauseResult> => {
        try {
          this.indexingControl.pause();
          return { accepted: true, state: 'paused' };
        } catch (error: unknown) {
          this.logger.warn('[indexing] pause failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { accepted: false, state: 'error' };
        }
      },
    );

    // indexing:resume — resume from stored cursor (or start fresh)
    this.rpcHandler.registerMethod(
      'indexing:resume',
      async (
        params: IndexingResumeParams | undefined,
      ): Promise<IndexingResumeResult> => {
        if (!params?.workspaceRoot) {
          return { accepted: false, state: 'paused' };
        }
        if (!this.runDeps) {
          this.logger.warn(
            '[indexing] resume — runDeps not set (indexer not ready)',
          );
          return { accepted: false, state: 'paused' };
        }
        try {
          void this.indexingControl
            .resume(params.workspaceRoot, this.runDeps)
            .catch((err: unknown) => {
              this.logger.warn('[indexing] resume failed (non-fatal):', {
                error: err instanceof Error ? err.message : String(err),
              });
            });
          const status = await this.indexingControl.getStatus(
            params.workspaceRoot,
          );
          return { accepted: true, state: status.state };
        } catch (error: unknown) {
          this.logger.warn('[indexing] resume setup failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { accepted: false, state: 'error' };
        }
      },
    );

    // indexing:cancel — abort and clear cursor
    this.rpcHandler.registerMethod(
      'indexing:cancel',
      async (
        _params: IndexingCancelParams | undefined,
      ): Promise<IndexingCancelResult> => {
        try {
          this.indexingControl.cancel();
          return { accepted: true, state: 'never-indexed' };
        } catch (error: unknown) {
          this.logger.warn('[indexing] cancel failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { accepted: false, state: 'error' };
        }
      },
    );

    // indexing:setPipelineEnabled — toggle symbol or memory pipeline
    this.rpcHandler.registerMethod(
      'indexing:setPipelineEnabled',
      async (
        params: IndexingSetPipelineEnabledParams | undefined,
      ): Promise<IndexingSetPipelineEnabledResult> => {
        if (!params?.workspaceRoot || !params?.pipeline) {
          return { applied: false, symbolsEnabled: true, memoryEnabled: true };
        }
        try {
          await this.indexingControl.setPipelineEnabled(
            params.pipeline,
            params.enabled,
            params.workspaceRoot,
          );
          const status = await this.indexingControl.getStatus(
            params.workspaceRoot,
          );
          return {
            applied: true,
            symbolsEnabled: status.symbolsEnabled,
            memoryEnabled: status.memoryEnabled,
          };
        } catch (error: unknown) {
          this.logger.warn('[indexing] setPipelineEnabled failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { applied: false, symbolsEnabled: true, memoryEnabled: true };
        }
      },
    );

    // indexing:dismissStale — record dismissed SHA so banner is hidden
    this.rpcHandler.registerMethod(
      'indexing:dismissStale',
      async (
        params: IndexingDismissStaleParams | undefined,
      ): Promise<IndexingDismissStaleResult> => {
        if (!params?.workspaceRoot) {
          return { accepted: false, dismissedSha: null };
        }
        try {
          await this.indexingControl.dismissStale(params.workspaceRoot);
          const status = await this.indexingControl.getStatus(
            params.workspaceRoot,
          );
          return {
            accepted: true,
            dismissedSha: status.lastDismissedStaleSha,
          };
        } catch (error: unknown) {
          this.logger.warn('[indexing] dismissStale failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { accepted: false, dismissedSha: null };
        }
      },
    );

    // indexing:acknowledgeDisclosure — record privacy disclosure acceptance
    this.rpcHandler.registerMethod(
      'indexing:acknowledgeDisclosure',
      async (
        params: IndexingAcknowledgeDisclosureParams | undefined,
      ): Promise<IndexingAcknowledgeDisclosureResult> => {
        if (!params?.workspaceRoot) {
          return { accepted: false, acknowledgedAt: 0 };
        }
        try {
          await this.indexingControl.acknowledgeDisclosure(
            params.workspaceRoot,
          );
          const status = await this.indexingControl.getStatus(
            params.workspaceRoot,
          );
          return {
            accepted: true,
            acknowledgedAt: status.disclosureAcknowledgedAt ?? Date.now(),
          };
        } catch (error: unknown) {
          this.logger.warn('[indexing] acknowledgeDisclosure failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return { accepted: false, acknowledgedAt: 0 };
        }
      },
    );

    this.logger.info('[indexing] RPC handlers registered');
  }
}
