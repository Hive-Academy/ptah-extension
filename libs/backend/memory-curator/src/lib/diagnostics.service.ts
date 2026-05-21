import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from './di/tokens';
import { MemoryCuratorService } from './memory-curator.service';
import { MemoryDecayJob } from './memory-decay.job';
import type {
  MemoryCuratorEvent,
  MemoryDbHealth,
  MemoryDiagnosticsSnapshot,
} from './diagnostics.types';

interface CountRow {
  readonly n: number;
}

const TRIGGER_KEYS = {
  preCompact: 'memory.triggers.preCompact',
  idleMs: 'memory.triggers.idleMs',
  turnThreshold: 'memory.triggers.turnThreshold',
  bootScan: 'memory.triggers.bootScan',
  userPromptSubmitEnabled: 'memory.triggers.userPromptSubmit.enabled',
  userPromptSubmitCueList: 'memory.triggers.userPromptSubmit.cueList',
  userPromptSubmitMinPromptLength:
    'memory.triggers.userPromptSubmit.minPromptLength',
  postToolUseEnabled: 'memory.triggers.postToolUse.enabled',
  maxCuratesPerHour: 'memory.triggers.maxCuratesPerHour',
} as const;

const DEFAULT_CUE_LIST: readonly string[] = [
  'remember (this|that)',
  '(important|critical)\\s+(point|note|fact|detail)',
  'from now on',
  'going forward',
  'keep in mind',
  'note that',
  'save to memory',
];

const TRIGGER_DEFAULTS = {
  preCompact: true,
  idleMs: 600000,
  turnThreshold: 20,
  bootScan: true,
  userPromptSubmitEnabled: true,
  userPromptSubmitCueList: DEFAULT_CUE_LIST,
  userPromptSubmitMinPromptLength: 20,
  postToolUseEnabled: true,
  maxCuratesPerHour: 12,
} as const;

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
    const triggers = this.readTriggers();

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

  private readTriggers(): MemoryDiagnosticsSnapshot['triggers'] {
    const preCompact =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.preCompact,
        TRIGGER_DEFAULTS.preCompact,
      ) ?? TRIGGER_DEFAULTS.preCompact;
    const idleMs =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.idleMs,
        TRIGGER_DEFAULTS.idleMs,
      ) ?? TRIGGER_DEFAULTS.idleMs;
    const turnThreshold =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.turnThreshold,
        TRIGGER_DEFAULTS.turnThreshold,
      ) ?? TRIGGER_DEFAULTS.turnThreshold;
    const bootScan =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.bootScan,
        TRIGGER_DEFAULTS.bootScan,
      ) ?? TRIGGER_DEFAULTS.bootScan;
    const userPromptSubmitEnabled =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.userPromptSubmitEnabled,
        TRIGGER_DEFAULTS.userPromptSubmitEnabled,
      ) ?? TRIGGER_DEFAULTS.userPromptSubmitEnabled;
    const userPromptSubmitCueList =
      this.workspace.getConfiguration<readonly string[]>(
        'ptah',
        TRIGGER_KEYS.userPromptSubmitCueList,
        TRIGGER_DEFAULTS.userPromptSubmitCueList,
      ) ?? TRIGGER_DEFAULTS.userPromptSubmitCueList;
    const userPromptSubmitMinPromptLength =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.userPromptSubmitMinPromptLength,
        TRIGGER_DEFAULTS.userPromptSubmitMinPromptLength,
      ) ?? TRIGGER_DEFAULTS.userPromptSubmitMinPromptLength;
    const postToolUseEnabled =
      this.workspace.getConfiguration<boolean>(
        'ptah',
        TRIGGER_KEYS.postToolUseEnabled,
        TRIGGER_DEFAULTS.postToolUseEnabled,
      ) ?? TRIGGER_DEFAULTS.postToolUseEnabled;
    const maxCuratesPerHour =
      this.workspace.getConfiguration<number>(
        'ptah',
        TRIGGER_KEYS.maxCuratesPerHour,
        TRIGGER_DEFAULTS.maxCuratesPerHour,
      ) ?? TRIGGER_DEFAULTS.maxCuratesPerHour;
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

  private readDbHealth(): MemoryDbHealth {
    const vecLoaded = this.sqlite.vecExtensionLoaded;
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
