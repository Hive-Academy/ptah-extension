/**
 * Progressive Disclosure Memory RPC Handlers (`mem:` namespace).
 *
 * Three methods designed for token-budget-aware LLM consumption:
 *   - `mem:searchIndex`     — compact rows (no `content`) via hybrid BM25 + vec
 *   - `mem:timeline`        — neighbour rows around an anchor memory
 *   - `mem:getObservations` — full 5-field summary + read-only queue rows
 *
 * Existing `memory:*` handlers stay untouched (backwards compat).
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, RpcUserError } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  MEMORY_TOKENS,
  type MemorySearchService,
} from '@ptah-extension/memory-curator';
import type {
  MemSearchIndexParams,
  MemSearchIndexResult,
  MemTimelineParams,
  MemTimelineResult,
  MemGetObservationsParams,
  MemGetObservationsResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import { z } from 'zod';
import {
  MemSearchIndexParamsSchema,
  MemTimelineParamsSchema,
  MemGetObservationsParamsSchema,
} from './mem-rpc.schema';

@injectable()
export class MemRpcHandlers {
  static readonly METHODS = [
    'mem:searchIndex',
    'mem:timeline',
    'mem:getObservations',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(MEMORY_TOKENS.MEMORY_SEARCH)
    private readonly search: MemorySearchService,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'mem:searchIndex',
      async (
        params: MemSearchIndexParams | undefined,
      ): Promise<MemSearchIndexResult> => {
        let validated: z.infer<typeof MemSearchIndexParamsSchema>;
        try {
          validated = MemSearchIndexParamsSchema.parse(params ?? {});
        } catch (err: unknown) {
          this.logger.warn('[mem] searchIndex — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for mem:searchIndex',
            'INVALID_PARAMS',
          );
        }
        try {
          const workspaceRoot =
            validated.workspaceRoot ?? validated.project ?? undefined;
          const r = await this.search.searchIndex({
            query: validated.query,
            topK: validated.topK,
            workspaceRoot,
            type: validated.type,
            concepts: validated.concepts,
            files: validated.files,
            dateRange: validated.dateRange,
          });
          return { rows: r.rows, bm25Only: r.bm25Only };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[mem] searchIndex failed', { error: message });
          throw new RpcUserError(
            'mem:searchIndex failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'mem:timeline',
      async (
        params: MemTimelineParams | undefined,
      ): Promise<MemTimelineResult> => {
        let validated: z.infer<typeof MemTimelineParamsSchema>;
        try {
          validated = MemTimelineParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[mem] timeline — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for mem:timeline',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = this.search.timeline({
            anchorId: validated.anchorId,
            before: validated.before,
            after: validated.after,
            workspaceRoot: validated.workspaceRoot,
          });
          return { rows: r.rows, anchorIndex: r.anchorIndex };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[mem] timeline failed', { error: message });
          throw new RpcUserError(
            'mem:timeline failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'mem:getObservations',
      async (
        params: MemGetObservationsParams | undefined,
      ): Promise<MemGetObservationsResult> => {
        let validated: z.infer<typeof MemGetObservationsParamsSchema>;
        try {
          validated = MemGetObservationsParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[mem] getObservations — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for mem:getObservations',
            'INVALID_PARAMS',
          );
        }
        try {
          const r = this.search.getObservations({
            ids: validated.ids,
            includeQueueRows: validated.includeQueueRows,
          });
          return {
            memories: r.memories,
            observationsBySession: r.observationsBySession,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[mem] getObservations failed', { error: message });
          throw new RpcUserError(
            'mem:getObservations failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.logger.info('[mem] RPC handlers registered');
  }
}
