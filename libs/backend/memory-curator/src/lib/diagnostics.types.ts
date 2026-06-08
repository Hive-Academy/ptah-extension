import type { EmbedderDownloadPhase } from '@ptah-extension/memory-contracts';
import type { CuratorRunStats } from './memory-curator.service';

export type MemoryCuratorEventKind =
  | 'curator-run'
  | 'curator-skipped-no-data'
  | 'decay-run'
  | 'idle-trigger'
  | 'turn-trigger'
  | 'boot-scan'
  | 'manual-run'
  | 'user-cue-trigger'
  | 'commit-detect'
  | 'turn-complete-trigger'
  | 'episode-trigger'
  | 'session-end-trigger'
  | 'tool-failure'
  | 'rate-limited'
  | 'error'
  | 'curator-error'
  | 'embedder-download';

export interface MemoryCuratorEvent {
  readonly kind: MemoryCuratorEventKind;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly stats?: Readonly<Record<string, number | string | boolean | null>>;
  readonly error?: string;
  readonly phase?: EmbedderDownloadPhase;
  readonly progress?: number;
}

export interface MemoryDecayStats {
  readonly scanned: number;
  readonly demoted: number;
  readonly archived: number;
  readonly expired: number;
}

export interface MemoryDbHealth {
  readonly memories: number;
  readonly memory_chunks: number;
  readonly memory_chunks_vec: number;
  readonly memory_chunks_fts: number;
  readonly code_symbols: number;
  readonly code_symbols_vec: number;
  readonly coherent: boolean;
  readonly mismatches: readonly string[];
}

export interface MemoryDiagnosticsSnapshot {
  readonly lastRunAt: number | null;
  readonly lastRunStats: CuratorRunStats | null;
  readonly lastDecayAt: number | null;
  readonly lastDecayStats: MemoryDecayStats | null;
  readonly recentEvents: readonly MemoryCuratorEvent[];
  readonly dbHealth: MemoryDbHealth;
  readonly triggers: {
    readonly preCompact: boolean;
    readonly idleMs: number;
    readonly turnThreshold: number;
    readonly bootScan: boolean;
    readonly userPromptSubmit: {
      readonly enabled: boolean;
      readonly cueList: readonly string[];
      readonly minPromptLength: number;
    };
    readonly postToolUse: {
      readonly enabled: boolean;
    };
    readonly turnComplete: {
      readonly enabled: boolean;
    };
    readonly episode: {
      readonly enabled: boolean;
    };
    readonly sessionEnd: {
      readonly enabled: boolean;
    };
    readonly maxCuratesPerHour: number;
  };
}
