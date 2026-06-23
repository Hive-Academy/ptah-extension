import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryCuratorService } from './memory-curator.service';
import { MemoryDecayJob } from './memory-decay.job';
import { readMemoryTriggers } from './triggers/memory-trigger-config';
import type {
  MemoryCuratorEvent,
  MemoryDbHealth,
  MemoryDiagnosticsSnapshot,
} from './diagnostics.types';

interface CountRow {
  readonly n: number;
}

@injectable()
export class MemoryDiagnosticsService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
    @inject(MEMORY_TOKENS.MEMORY_DECAY_JOB)
    private readonly decay: MemoryDecayJob,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PERSISTENCE_TOKENS.VEC_STATUS)
    private readonly vecStatus: VecStatusService,
  ) {}

  async getSnapshot(
    _workspaceRoot?: string | null,
    eventLimit = 10,
  ): Promise<MemoryDiagnosticsSnapshot> {
    const lastRun = this.curator.lastRunInfo();
    const lastDecay = this.decay.lastDecayInfo();
    const recentEvents: readonly MemoryCuratorEvent[] =
      this.curator.recentEvents(eventLimit);
    const dbHealth = this.readDbHealth();
    const triggers = readMemoryTriggers(this.workspace);

    return {
      lastRunAt: lastRun.at,
      lastRunStats: lastRun.stats,
      lastDecayAt: lastDecay.at,
      lastDecayStats: lastDecay.stats,
      recentEvents,
      dbHealth,
      triggers,
    };
  }

  private readDbHealth(): MemoryDbHealth {
    const vecLoaded = this.vecStatus.available;
    const db = this.sqlite.db;
    const countErrors: string[] = [];

    const memories = this.safeCount(db, 'memories', countErrors);
    const memory_chunks = this.safeCount(db, 'memory_chunks', countErrors);
    const memory_chunks_fts = this.safeCount(
      db,
      'memory_chunks_fts_docsize',
      countErrors,
    );
    const code_symbols = this.safeCount(db, 'code_symbols', countErrors);
    const memory_chunks_vec = vecLoaded
      ? this.safeVecCount(
          db,
          'memory_chunks_vec',
          'memory_chunks_vec_rowids',
          countErrors,
        )
      : 0;
    const code_symbols_vec = vecLoaded
      ? this.safeVecCount(
          db,
          'code_symbols_vec',
          'code_symbols_vec_rowids',
          countErrors,
        )
      : 0;

    const failedTables = new Set(countErrors.map((e) => e.split(':')[0]));
    const mismatches: string[] = [];
    if (
      vecLoaded &&
      !failedTables.has('memory_chunks') &&
      !failedTables.has('memory_chunks_vec') &&
      memory_chunks !== memory_chunks_vec
    ) {
      mismatches.push('memory_chunks/memory_chunks_vec');
    }
    if (
      !failedTables.has('memory_chunks') &&
      !failedTables.has('memory_chunks_fts_docsize') &&
      memory_chunks !== memory_chunks_fts
    ) {
      mismatches.push('memory_chunks/memory_chunks_fts');
    }
    if (
      vecLoaded &&
      !failedTables.has('code_symbols') &&
      !failedTables.has('code_symbols_vec') &&
      code_symbols !== code_symbols_vec
    ) {
      mismatches.push('code_symbols/code_symbols_vec');
    }

    return {
      memories,
      memory_chunks,
      memory_chunks_vec,
      memory_chunks_fts,
      code_symbols,
      code_symbols_vec,
      coherent: mismatches.length === 0,
      mismatches,
      countErrors: countErrors.length > 0 ? countErrors : undefined,
    };
  }

  private safeCount(
    db: SqliteConnectionService['db'],
    table: string,
    errors: string[],
  ): number {
    try {
      return this.count(db, table);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${table}: ${message}`);
      this.logger.warn('[memory-curator] db-health count failed', {
        table,
        error: message,
      });
      return 0;
    }
  }

  private safeVecCount(
    db: SqliteConnectionService['db'],
    table: string,
    shadowTable: string,
    errors: string[],
  ): number {
    try {
      return this.count(db, table);
    } catch {
      try {
        return this.count(db, shadowTable);
      } catch (shadowErr: unknown) {
        const message =
          shadowErr instanceof Error ? shadowErr.message : String(shadowErr);
        errors.push(`${table}: ${message}`);
        this.logger.warn('[memory-curator] db-health vec count failed', {
          table,
          shadowTable,
          error: message,
        });
        return 0;
      }
    }
  }

  private count(db: SqliteConnectionService['db'], table: string): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
      | CountRow
      | undefined;
    return row?.n ?? 0;
  }
}
