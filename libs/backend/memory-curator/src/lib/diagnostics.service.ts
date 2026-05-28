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
    let memories = 0;
    let memory_chunks = 0;
    let memory_chunks_vec = 0;
    let memory_chunks_fts = 0;
    let code_symbols = 0;
    let code_symbols_vec = 0;

    try {
      const db = this.sqlite.db;
      memories = this.count(db, 'memories');
      memory_chunks = this.count(db, 'memory_chunks');
      memory_chunks_fts = this.count(db, 'memory_chunks_fts');
      code_symbols = this.count(db, 'code_symbols');
      if (vecLoaded) {
        memory_chunks_vec = this.count(db, 'memory_chunks_vec');
        code_symbols_vec = this.count(db, 'code_symbols_vec');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[memory-curator] db-health read failed', {
        error: message,
      });
    }

    const mismatches: string[] = [];
    if (vecLoaded && memory_chunks !== memory_chunks_vec) {
      mismatches.push('memory_chunks/memory_chunks_vec');
    }
    if (memory_chunks !== memory_chunks_fts) {
      mismatches.push('memory_chunks/memory_chunks_fts');
    }
    if (vecLoaded && code_symbols !== code_symbols_vec) {
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
    };
  }

  private count(db: SqliteConnectionService['db'], table: string): number {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as
      | CountRow
      | undefined;
    return row?.n ?? 0;
  }
}
