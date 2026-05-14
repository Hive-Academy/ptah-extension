/**
 * Memory RPC Handlers (TASK_2026_HERMES Track 1).
 *
 * Surfaces 8 `memory:*` methods backed by the `@ptah-extension/memory-curator`
 * library: list / search / get / pin / unpin / forget / rebuildIndex / stats.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import {
  MEMORY_TOKENS,
  memoryId,
  type Memory,
  type MemoryChunk,
  type MemoryCuratorService,
  type MemorySearchService,
  type MemoryStore,
} from '@ptah-extension/memory-curator';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { isAuthorizedWorkspace } from '../utils/workspace-authorization';
import type {
  MemoryChunkWire,
  MemoryForgetParams,
  MemoryForgetResult,
  MemoryGetParams,
  MemoryGetResult,
  MemoryListParams,
  MemoryListResult,
  MemoryPinParams,
  MemoryPinResult,
  MemoryPurgeBySubjectPatternParams,
  MemoryPurgeBySubjectPatternResult,
  MemoryRebuildIndexParams,
  MemoryRebuildIndexResult,
  MemorySearchHitWire,
  MemorySearchParams,
  MemorySearchResult,
  MemoryStatsParams,
  MemoryStatsResult,
  MemoryWire,
  RpcMethodName,
} from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import { MemoryPurgeBySubjectPatternParamsSchema } from './memory-rpc.schema';

function toMemoryWire(m: Memory): MemoryWire {
  return {
    id: m.id as unknown as string,
    sessionId: m.sessionId,
    workspaceRoot: m.workspaceRoot,
    tier: m.tier,
    kind: m.kind,
    subject: m.subject,
    content: m.content,
    sourceMessageIds: m.sourceMessageIds,
    salience: m.salience,
    decayRate: m.decayRate,
    hits: m.hits,
    pinned: m.pinned,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastUsedAt: m.lastUsedAt,
    expiresAt: m.expiresAt,
  };
}

function toChunkWire(c: MemoryChunk): MemoryChunkWire {
  return {
    id: c.id as unknown as string,
    memoryId: c.memoryId as unknown as string,
    ord: c.ord,
    text: c.text,
    tokenCount: c.tokenCount,
    createdAt: c.createdAt,
  };
}

@injectable()
export class MemoryRpcHandlers {
  static readonly METHODS = [
    'memory:list',
    'memory:search',
    'memory:get',
    'memory:pin',
    'memory:unpin',
    'memory:forget',
    'memory:rebuildIndex',
    'memory:stats',
    'memory:purgeBySubjectPattern',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(MEMORY_TOKENS.MEMORY_SEARCH)
    private readonly search: MemorySearchService,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'memory:list',
      async (
        params: MemoryListParams | undefined,
      ): Promise<MemoryListResult> => {
        const r = this.store.list({
          workspaceRoot: params?.workspaceRoot ?? undefined,
          tier: params?.tier,
          limit: params?.limit,
          offset: params?.offset,
        });
        return {
          memories: r.memories.map(toMemoryWire),
          total: r.total,
        };
      },
    );

    this.rpcHandler.registerMethod(
      'memory:search',
      async (
        params: MemorySearchParams | undefined,
      ): Promise<MemorySearchResult> => {
        if (!params || typeof params.query !== 'string') {
          return { hits: [], bm25Only: false };
        }
        const r = await this.search.searchRich(params.query, params.topK ?? 10);
        const hits: MemorySearchHitWire[] = r.hits.map((h) => ({
          memory: toMemoryWire(h.memory),
          chunk: toChunkWire(h.chunk),
          score: h.score,
          bm25Rank: h.bm25Rank,
          vecRank: h.vecRank,
        }));
        return { hits, bm25Only: r.bm25Only };
      },
    );

    this.rpcHandler.registerMethod(
      'memory:get',
      async (params: MemoryGetParams | undefined): Promise<MemoryGetResult> => {
        if (!params?.id) return { memory: null, chunks: [] };
        const id = memoryId(params.id);
        const memory = this.store.getById(id);
        if (!memory) return { memory: null, chunks: [] };
        const chunks = this.store.getChunks(id);
        return {
          memory: toMemoryWire(memory),
          chunks: chunks.map(toChunkWire),
        };
      },
    );

    this.rpcHandler.registerMethod(
      'memory:pin',
      async (params: MemoryPinParams | undefined): Promise<MemoryPinResult> => {
        if (!params?.id) return { success: false, pinned: false };
        try {
          this.store.setPinned(memoryId(params.id), true);
          return { success: true, pinned: true };
        } catch (err) {
          this.logger.warn('[memory] pin failed', { error: String(err) });
          return { success: false, pinned: false };
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:unpin',
      async (params: MemoryPinParams | undefined): Promise<MemoryPinResult> => {
        if (!params?.id) return { success: false, pinned: false };
        try {
          this.store.setPinned(memoryId(params.id), false);
          return { success: true, pinned: false };
        } catch (err) {
          this.logger.warn('[memory] unpin failed', { error: String(err) });
          return { success: false, pinned: false };
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:forget',
      async (
        params: MemoryForgetParams | undefined,
      ): Promise<MemoryForgetResult> => {
        if (!params?.id) return { success: false };
        try {
          this.store.forget(memoryId(params.id));
          return { success: true };
        } catch (err) {
          this.logger.warn('[memory] forget failed', { error: String(err) });
          return { success: false };
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:rebuildIndex',
      async (
        _params: MemoryRebuildIndexParams | undefined,
      ): Promise<MemoryRebuildIndexResult> => {
        try {
          const r = await this.store.rebuildIndex();
          return r;
        } catch (err) {
          this.logger.warn('[memory] rebuildIndex failed', {
            error: String(err),
          });
          return { rebuiltFts: false, rebuiltVec: false };
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:stats',
      async (
        params: MemoryStatsParams | undefined,
      ): Promise<MemoryStatsResult> => {
        return this.store.stats(params?.workspaceRoot ?? undefined);
      },
    );

    this.rpcHandler.registerMethod(
      'memory:purgeBySubjectPattern',
      async (
        params: MemoryPurgeBySubjectPatternParams | undefined,
      ): Promise<MemoryPurgeBySubjectPatternResult> => {
        let validated: MemoryPurgeBySubjectPatternParams;
        try {
          validated = MemoryPurgeBySubjectPatternParamsSchema.parse(params);
        } catch (err) {
          // Issue 3 (LOW): log full Zod error server-side; send generic message to client.
          this.logger.warn('[memory] purgeBySubjectPattern — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for memory:purgeBySubjectPattern',
            'INVALID_PARAMS',
          );
        }
        // Issue 1 (HIGH): reject null/undefined workspaceRoot — cross-workspace purge not permitted.
        if (
          validated.workspaceRoot === null ||
          validated.workspaceRoot === undefined
        ) {
          throw new RpcUserError(
            'memory:purgeBySubjectPattern requires an explicit workspaceRoot; cross-workspace purge is not permitted.',
            'INVALID_PARAMS',
          );
        }
        // Issue 2 (MEDIUM): workspace authorization guard — defence-in-depth against arbitrary workspaceRoot.
        if (
          !isAuthorizedWorkspace(
            validated.workspaceRoot,
            this.workspaceProvider,
          )
        ) {
          throw new RpcUserError(
            'Workspace not authorized',
            'UNAUTHORIZED_WORKSPACE',
          );
        }
        try {
          const deleted = this.store.purgeBySubjectPattern(
            validated.pattern,
            validated.mode,
            validated.workspaceRoot,
          );
          this.logger.info('[memory] purgeBySubjectPattern complete', {
            pattern: validated.pattern,
            mode: validated.mode,
            deleted,
          });
          return { deleted };
        } catch (err) {
          this.logger.error('[memory] purgeBySubjectPattern failed', {
            error: String(err),
          });
          throw new RpcUserError(
            'memory:purgeBySubjectPattern failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    // Touch curator so DI graph fully resolves on registration. Curator is
    // started by the host app at activation; this is just to ensure construction.
    void this.curator;
    this.logger.info('[memory] RPC handlers registered');
  }
}
