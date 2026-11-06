/**
 * Message handling for the SQLite search utility process. Transport-free so it
 * can be driven by a test; `search-worker.ts` wires it to Electron's
 * `process.parentPort`.
 *
 * The connection is read-only (`readonly: true` plus `PRAGMA query_only`), so
 * the worker can never write to the live database. Under WAL it reads beside
 * the main process, which keeps writing. `PRAGMA data_version` changes when
 * another connection commits, and the memory search service (whose LRU keys
 * on in-process write counters that never move here) is rebuilt when it does.
 */
import { NoopTracer } from '@ptah-extension/vscode-core';
import type { SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { CodeSymbolStore } from './code-symbol.store';
import { MemorySearchService } from './memory-search.service';
import { MemoryStore } from './memory.store';
import { memoryId } from './memory.types';
import { ObservationQueueStore } from './observation-queue.store';
import { HostBridgeEmbedder } from './search-worker-host-embedder';
import {
  searchWorkerInboundSchema,
  toTransferableLogContext,
  type SearchWorkerInit,
  type SearchWorkerLogLevel,
  type SearchWorkerOutbound,
  type SearchWorkerQuery,
} from './search-worker.protocol';
import type {
  CuratorLogger,
  SqliteDbProvider,
  VecAvailability,
} from './sqlite-reader-deps.types';

/** Opens `dbPath` read-only; must throw when the file does not exist. */
export type ReadOnlyDatabaseOpener = (dbPath: string) => SqliteDatabase;

interface WorkerState {
  readonly db: SqliteDatabase;
  readonly connection: SqliteDbProvider;
  readonly vecStatus: VecAvailability;
  readonly bridge: HostBridgeEmbedder;
  readonly memoryStore: MemoryStore;
  readonly observationQueue: ObservationQueueStore;
  readonly symbols: CodeSymbolStore;
  memorySearch: MemorySearchService;
  dataVersion: number;
}

export interface SearchWorkerRuntimeOptions {
  readonly post: (message: SearchWorkerOutbound) => void;
  readonly openReadOnly: ReadOnlyDatabaseOpener;
  readonly hostCallTimeoutMs?: number;
}

export class SearchWorkerRuntime {
  private state: WorkerState | null = null;
  readonly logger: CuratorLogger;

  constructor(private readonly options: SearchWorkerRuntimeOptions) {
    this.logger = {
      debug: (message: string, ...args: unknown[]) => this.log('debug', message, args[0]),
      info: (message: string, ...args: unknown[]) => this.log('info', message, args[0]),
      warn: (message: string, ...args: unknown[]) => this.log('warn', message, args[0]),
      error: (message: string | Error, errorOrContext?: Error | Record<string, unknown>) =>
        this.log(
          'error',
          message instanceof Error ? message.message : message,
          errorOrContext ?? (message instanceof Error ? message : undefined),
        ),
    };
  }

  /** Entry point for every message the host posts. */
  handle(raw: unknown): void {
    const parsed = searchWorkerInboundSchema.safeParse(raw);
    if (!parsed.success) {
      this.log('warn', '[sqlite-search-worker] rejected an invalid host message', {
        issues: parsed.error.issues.slice(0, 3).map((issue) => issue.message),
      });
      return;
    }
    const message = parsed.data;
    switch (message.kind) {
      case 'init':
        this.init(message);
        return;
      case 'embed-result':
      case 'rerank-result':
      case 'host-call-failed':
        this.state?.bridge.settle(message);
        return;
      default:
        void this.answer(message);
    }
  }

  /** Release the bridge's pending host calls and close the connection. */
  async dispose(): Promise<void> {
    const state = this.state;
    this.state = null;
    if (!state) return;
    await state.bridge.dispose();
    try {
      state.db.close();
    } catch (error: unknown) {
      this.logger.warn('[sqlite-search-worker] close failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private init(message: SearchWorkerInit): void {
    if (this.state) {
      this.logger.warn('[sqlite-search-worker] ignoring a second init');
      return;
    }
    let db: SqliteDatabase;
    try {
      db = this.options.openReadOnly(message.dbPath);
      db.pragma('query_only = ON');
      db.pragma('busy_timeout = 5000');
    } catch (error: unknown) {
      // degradation-audit: reported - posted to the host as `init-failed`,
      // which logs it, kills this process and backs off.
      const text = error instanceof Error ? error.message : String(error);
      this.options.post({ kind: 'init-failed', message: text });
      return;
    }
    const vecLoaded = this.loadVec(db, message.vecPath);
    const logger = this.logger;
    const connection: SqliteDbProvider = {
      db,
      vecExtensionLoaded: vecLoaded,
      handleFatalWriteError(error: unknown): boolean {
        logger.error(
          '[sqlite-search-worker] a write reached the read-only search connection',
          error instanceof Error ? error : { error: String(error) },
        );
        return false;
      },
    };
    const vecStatus: VecAvailability = { available: vecLoaded };
    const bridge = new HostBridgeEmbedder({
      dim: message.embedderDim,
      modelId: message.embedderModelId,
      canRerank: message.rerankAvailable,
      post: this.options.post,
      callTimeoutMs: this.options.hostCallTimeoutMs,
    });
    const memoryStore = new MemoryStore(logger, connection, bridge, vecStatus);
    const observationQueue = new ObservationQueueStore(logger, connection);
    const symbols = new CodeSymbolStore(logger, connection, bridge, vecStatus);
    // Hybrid symbol search in the main process repairs stale vec rows; this
    // connection cannot write, so it only honours the persisted stale marker.
    symbols.enableReadOnlySearch();
    const partial = { db, connection, vecStatus, bridge, memoryStore, observationQueue };
    this.state = {
      ...partial,
      symbols,
      memorySearch: this.createMemorySearch(partial),
      dataVersion: this.readDataVersion(db),
    };
    this.options.post({ kind: 'ready', vecLoaded });
  }

  private loadVec(db: SqliteDatabase, vecPath: string | undefined): boolean {
    if (!vecPath) {
      this.logger.info('[sqlite-search-worker] no sqlite-vec path; vector search disabled');
      return false;
    }
    if (typeof db.loadExtension !== 'function') {
      this.logger.warn('[sqlite-search-worker] loadExtension unavailable; vector search disabled');
      return false;
    }
    try {
      db.loadExtension(vecPath);
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - forwarded at warn; the worker
      // searches lexically, like the main connection without sqlite-vec.
      this.logger.warn('[sqlite-search-worker] sqlite-vec load failed; vector search disabled', {
        vecPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private createMemorySearch(
    state: Pick<WorkerState, 'connection' | 'vecStatus' | 'bridge' | 'memoryStore' | 'observationQueue'>,
  ): MemorySearchService {
    return new MemorySearchService(
      this.logger,
      state.connection,
      state.bridge,
      state.memoryStore,
      state.observationQueue,
      state.vecStatus,
      new NoopTracer(),
    );
  }

  private readDataVersion(db: SqliteDatabase): number {
    return Number(db.pragma('data_version', { simple: true }));
  }

  private async answer(query: SearchWorkerQuery): Promise<void> {
    const state = this.state;
    if (!state) {
      this.options.post({ kind: 'error', id: query.id, message: 'search worker not initialized' });
      return;
    }
    try {
      const result = await this.run(state, query);
      this.options.post({ kind: 'result', id: query.id, result });
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error);
      this.logger.warn('[sqlite-search-worker] query failed', { kind: query.kind, error: text });
      this.options.post({ kind: 'error', id: query.id, message: text });
    }
  }

  private run(state: WorkerState, query: SearchWorkerQuery): unknown {
    switch (query.kind) {
      case 'memory': {
        const version = this.readDataVersion(state.db);
        if (version !== state.dataVersion) {
          state.memorySearch = this.createMemorySearch(state);
          state.dataVersion = version;
        }
        return state.memorySearch.searchRich(query.query, query.topK, query.workspaceRoot);
      }
      case 'symbols':
        return state.symbols.searchSymbols(query.query, query.topK, query.workspaceRoot);
      case 'symbol-page':
        return state.symbols.search(query.params);
      case 'list':
        return state.memoryStore.listAll(query.workspaceRoot, undefined, query.limit, 0);
      case 'chunks':
        return state.memoryStore.getChunks(memoryId(query.memoryId));
    }
  }

  private log(level: SearchWorkerLogLevel, message: string, context: unknown): void {
    this.options.post({ kind: 'log', level, message, context: toTransferableLogContext(context) });
  }
}
