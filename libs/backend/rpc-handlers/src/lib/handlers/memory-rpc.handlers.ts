/**
 * Memory RPC Handlers.
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
  type CodeSymbolStore,
  type Memory,
  type MemoryChunk,
  type MemoryCuratorService,
  type MemoryDiagnosticsService,
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
  MemoryDiagnosticsParams,
  MemoryDiagnosticsResult,
  MemoryForgetParams,
  MemoryForgetResult,
  MemoryGetParams,
  MemoryGetResult,
  MemoryGetTriggersParams,
  MemoryGetTriggersResult,
  MemoryListParams,
  MemoryListResult,
  MemoryPinParams,
  MemoryPinResult,
  MemoryPurgeBySubjectPatternParams,
  MemoryPurgeBySubjectPatternResult,
  MemoryPurgeJunkParams,
  MemoryPurgeJunkResult,
  MemoryRebuildIndexParams,
  MemoryRebuildIndexResult,
  MemoryRunNowParams,
  MemoryRunNowResult,
  MemorySearchHitWire,
  MemorySearchParams,
  MemorySearchResult,
  MemorySetTriggersParams,
  MemorySetTriggersResult,
  MemoryStatsParams,
  MemoryStatsResult,
  MemoryTriggersDto,
  MemoryWire,
  RpcMethodName,
} from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import { z } from 'zod';
import {
  MemoryDiagnosticsParamsSchema,
  MemoryGetTriggersParamsSchema,
  MemoryPurgeBySubjectPatternParamsSchema,
  MemoryRunNowParamsSchema,
  MemorySetTriggersParamsSchema,
} from './memory-rpc.schema';

const DEFAULT_MEMORY_CUE_LIST: readonly string[] = [
  'remember (this|that)',
  '(important|critical)\\s+(point|note|fact|detail)',
  'from now on',
  'going forward',
  'keep in mind',
  'note that',
  'save to memory',
];

const MEMORY_TRIGGER_DEFAULTS = {
  preCompact: true,
  idleMs: 600000,
  turnThreshold: 20,
  bootScan: true,
  userPromptSubmit: {
    enabled: true,
    cueList: DEFAULT_MEMORY_CUE_LIST,
    minPromptLength: 20,
  },
  postToolUse: { enabled: true },
  maxCuratesPerHour: 12,
} as const;

const MEMORY_TRIGGER_PREFIXES: Record<keyof MemoryTriggersDto, string> = {
  preCompact: 'memory.triggers.preCompact',
  idleMs: 'memory.triggers.idleMs',
  turnThreshold: 'memory.triggers.turnThreshold',
  bootScan: 'memory.triggers.bootScan',
  userPromptSubmit: 'memory.triggers.userPromptSubmit',
  postToolUse: 'memory.triggers.postToolUse',
  maxCuratesPerHour: 'memory.triggers.maxCuratesPerHour',
};

function flattenTrigger(
  prefix: string,
  value: unknown,
): Array<[string, unknown]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [[prefix, value]];
  }
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(...flattenTrigger(`${prefix}.${k}`, v));
  }
  return out;
}

/**
 * Narrow schema for extracting workspaceRoot independently of the full
 * MemorySearchParamsSchema. This ensures that a bad `topK` or `query` value
 * cannot poison the scope — workspaceRoot survives any other field's failure.
 */
const WorkspaceRootSchema = z.string().min(1).optional();

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
    'memory:purgeJunk',
    'memory:diagnostics',
    'memory:runNow',
    'memory:setTriggers',
    'memory:getTriggers',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(MEMORY_TOKENS.MEMORY_STORE) private readonly store: MemoryStore,
    @inject(MEMORY_TOKENS.CODE_SYMBOL_STORE)
    private readonly codeSymbols: CodeSymbolStore,
    @inject(MEMORY_TOKENS.MEMORY_SEARCH)
    private readonly search: MemorySearchService,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
    @inject(MEMORY_TOKENS.MEMORY_DIAGNOSTICS_SERVICE)
    private readonly diagnostics: MemoryDiagnosticsService,
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
        const workspaceRoot = WorkspaceRootSchema.safeParse(
          (params as { workspaceRoot?: unknown }).workspaceRoot,
        ).data;
        const r = await this.search.searchRich(
          params.query,
          params.topK ?? 10,
          workspaceRoot,
        );
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
        const workspaceRoot = params?.workspaceRoot ?? undefined;
        const curated = this.store.stats(workspaceRoot);
        const codeIndex = this.codeSymbols.count(workspaceRoot);
        return {
          core: curated.core,
          recall: curated.recall,
          archival: curated.archival,
          codeIndex,
          lastCuratedAt: curated.lastCuratedAt,
        };
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
          this.logger.warn('[memory] purgeBySubjectPattern — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for memory:purgeBySubjectPattern',
            'INVALID_PARAMS',
          );
        }
        if (
          validated.workspaceRoot === null ||
          validated.workspaceRoot === undefined
        ) {
          throw new RpcUserError(
            'memory:purgeBySubjectPattern requires an explicit workspaceRoot; cross-workspace purge is not permitted.',
            'INVALID_PARAMS',
          );
        }
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

    this.rpcHandler.registerMethod(
      'memory:purgeJunk',
      async (
        params: MemoryPurgeJunkParams | undefined,
      ): Promise<MemoryPurgeJunkResult> => {
        const workspaceRoot = params?.workspaceRoot ?? undefined;
        if (
          workspaceRoot !== undefined &&
          workspaceRoot !== null &&
          !isAuthorizedWorkspace(workspaceRoot, this.workspaceProvider)
        ) {
          throw new RpcUserError(
            'Workspace not authorized',
            'UNAUTHORIZED_WORKSPACE',
          );
        }
        try {
          const deleted = this.codeSymbols.purgeJunk(workspaceRoot);
          this.logger.info('[memory] purgeJunk complete', {
            deleted,
            workspaceRoot: workspaceRoot ?? null,
          });
          return { deleted };
        } catch (err) {
          this.logger.error('[memory] purgeJunk failed', {
            error: String(err),
          });
          throw new RpcUserError(
            'memory:purgeJunk failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:diagnostics',
      async (
        params: MemoryDiagnosticsParams | undefined,
      ): Promise<MemoryDiagnosticsResult> => {
        let validated: z.infer<typeof MemoryDiagnosticsParamsSchema>;
        try {
          validated = MemoryDiagnosticsParamsSchema.parse(params ?? {});
        } catch (err: unknown) {
          this.logger.warn('[memory] diagnostics — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for memory:diagnostics',
            'INVALID_PARAMS',
          );
        }
        try {
          const snapshot = await this.diagnostics.getSnapshot(
            validated.workspaceRoot ?? undefined,
            validated.eventLimit,
          );
          return {
            lastRunAt: snapshot.lastRunAt,
            lastRunStats: snapshot.lastRunStats
              ? {
                  extracted: snapshot.lastRunStats.extracted,
                  merged: snapshot.lastRunStats.merged,
                  created: snapshot.lastRunStats.created,
                  skipped: snapshot.lastRunStats.skipped,
                }
              : null,
            lastDecayAt: snapshot.lastDecayAt,
            lastDecayStats: snapshot.lastDecayStats
              ? {
                  scanned: snapshot.lastDecayStats.scanned,
                  demoted: snapshot.lastDecayStats.demoted,
                  archived: snapshot.lastDecayStats.archived,
                  expired: snapshot.lastDecayStats.expired,
                }
              : null,
            recentEvents: snapshot.recentEvents.map((e) => ({
              kind: e.kind,
              timestamp: e.timestamp,
              sessionId: e.sessionId,
              stats: e.stats,
              error: e.error,
            })),
            dbHealth: {
              memories: snapshot.dbHealth.memories,
              memory_chunks: snapshot.dbHealth.memory_chunks,
              memory_chunks_vec: snapshot.dbHealth.memory_chunks_vec,
              memory_chunks_fts: snapshot.dbHealth.memory_chunks_fts,
              code_symbols: snapshot.dbHealth.code_symbols,
              code_symbols_vec: snapshot.dbHealth.code_symbols_vec,
              coherent: snapshot.dbHealth.coherent,
              mismatches: snapshot.dbHealth.mismatches,
            },
            triggers: {
              preCompact: snapshot.triggers.preCompact,
              idleMs: snapshot.triggers.idleMs,
              turnThreshold: snapshot.triggers.turnThreshold,
              bootScan: snapshot.triggers.bootScan,
              userPromptSubmit: {
                enabled: snapshot.triggers.userPromptSubmit.enabled,
                cueList: snapshot.triggers.userPromptSubmit.cueList,
                minPromptLength:
                  snapshot.triggers.userPromptSubmit.minPromptLength,
              },
              postToolUse: { enabled: snapshot.triggers.postToolUse.enabled },
              maxCuratesPerHour: snapshot.triggers.maxCuratesPerHour,
            },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[memory] diagnostics failed', { error: message });
          throw new RpcUserError(
            'memory:diagnostics failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:runNow',
      async (
        params: MemoryRunNowParams | undefined,
      ): Promise<MemoryRunNowResult> => {
        let validated: z.infer<typeof MemoryRunNowParamsSchema>;
        try {
          validated = MemoryRunNowParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[memory] runNow — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for memory:runNow',
            'INVALID_PARAMS',
          );
        }
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
        const startedAt = Date.now();
        try {
          const stats = await this.curator.curate({
            sessionId: validated.sessionId,
            workspaceRoot: validated.workspaceRoot,
          });
          this.curator.pushEvent({
            kind: 'manual-run',
            timestamp: Date.now(),
            sessionId: validated.sessionId,
            stats: {
              extracted: stats.extracted,
              merged: stats.merged,
              created: stats.created,
              skipped: stats.skipped,
            },
          });
          return {
            success: true,
            startedAt,
            completedAt: Date.now(),
            stats: {
              extracted: stats.extracted,
              merged: stats.merged,
              created: stats.created,
              skipped: stats.skipped,
            },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[memory] runNow failed', { error: message });
          return {
            success: false,
            startedAt,
            completedAt: Date.now(),
            stats: null,
            error: message,
          };
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:setTriggers',
      async (
        params: MemorySetTriggersParams | undefined,
      ): Promise<MemorySetTriggersResult> => {
        let validated: z.infer<typeof MemorySetTriggersParamsSchema>;
        try {
          validated = MemorySetTriggersParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[memory] setTriggers — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for memory:setTriggers',
            'INVALID_PARAMS',
          );
        }
        try {
          const incoming = validated.triggers;
          const entries: Array<[keyof MemoryTriggersDto, unknown]> =
            Object.entries(incoming) as Array<
              [keyof MemoryTriggersDto, unknown]
            >;
          for (const [key, value] of entries) {
            if (value === undefined) continue;
            const prefix = MEMORY_TRIGGER_PREFIXES[key];
            const leaves = flattenTrigger(prefix, value);
            for (const [flatKey, flatValue] of leaves) {
              await this.workspaceProvider.setConfiguration(
                'ptah',
                flatKey,
                flatValue,
              );
            }
          }
          return { triggers: this.readMemoryTriggers() };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[memory] setTriggers failed', { error: message });
          throw new RpcUserError(
            'memory:setTriggers failed; please try again.',
            'PERSISTENCE_UNAVAILABLE',
          );
        }
      },
    );

    this.rpcHandler.registerMethod(
      'memory:getTriggers',
      async (
        params: MemoryGetTriggersParams | undefined,
      ): Promise<MemoryGetTriggersResult> => {
        try {
          MemoryGetTriggersParamsSchema.parse(params);
        } catch (err: unknown) {
          this.logger.warn('[memory] getTriggers — invalid params', {
            err: String(err),
          });
          throw new RpcUserError(
            'Invalid parameters for memory:getTriggers',
            'INVALID_PARAMS',
          );
        }
        return { triggers: this.readMemoryTriggers() };
      },
    );

    void this.curator;
    this.logger.info('[memory] RPC handlers registered');
  }

  private readMemoryTriggers(): MemoryTriggersDto {
    const preCompact =
      this.workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'memory.triggers.preCompact',
        MEMORY_TRIGGER_DEFAULTS.preCompact,
      ) ?? MEMORY_TRIGGER_DEFAULTS.preCompact;
    const idleMs =
      this.workspaceProvider.getConfiguration<number>(
        'ptah',
        'memory.triggers.idleMs',
        MEMORY_TRIGGER_DEFAULTS.idleMs,
      ) ?? MEMORY_TRIGGER_DEFAULTS.idleMs;
    const turnThreshold =
      this.workspaceProvider.getConfiguration<number>(
        'ptah',
        'memory.triggers.turnThreshold',
        MEMORY_TRIGGER_DEFAULTS.turnThreshold,
      ) ?? MEMORY_TRIGGER_DEFAULTS.turnThreshold;
    const bootScan =
      this.workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'memory.triggers.bootScan',
        MEMORY_TRIGGER_DEFAULTS.bootScan,
      ) ?? MEMORY_TRIGGER_DEFAULTS.bootScan;
    const userPromptSubmitEnabled =
      this.workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'memory.triggers.userPromptSubmit.enabled',
        MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled,
      ) ?? MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled;
    const userPromptSubmitCueList =
      this.workspaceProvider.getConfiguration<readonly string[]>(
        'ptah',
        'memory.triggers.userPromptSubmit.cueList',
        MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList,
      ) ?? MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList;
    const userPromptSubmitMinPromptLength =
      this.workspaceProvider.getConfiguration<number>(
        'ptah',
        'memory.triggers.userPromptSubmit.minPromptLength',
        MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength,
      ) ?? MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength;
    const postToolUseEnabled =
      this.workspaceProvider.getConfiguration<boolean>(
        'ptah',
        'memory.triggers.postToolUse.enabled',
        MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled,
      ) ?? MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled;
    const maxCuratesPerHour =
      this.workspaceProvider.getConfiguration<number>(
        'ptah',
        'memory.triggers.maxCuratesPerHour',
        MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour,
      ) ?? MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour;
    return {
      preCompact,
      idleMs,
      turnThreshold,
      bootScan,
      userPromptSubmit: {
        enabled: userPromptSubmitEnabled,
        cueList: userPromptSubmitCueList,
        minPromptLength: userPromptSubmitMinPromptLength,
      },
      postToolUse: { enabled: postToolUseEnabled },
      maxCuratesPerHour,
    };
  }
}
