export type MemoryCuratorEventKind =
  | 'curator-run'
  | 'curator-skipped-no-data'
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

export type EmbedderDownloadPhaseWire =
  'starting' | 'downloading' | 'ready' | 'failed';

export interface MemoryCuratorEventWire {
  readonly kind: MemoryCuratorEventKind;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly stats?: Readonly<Record<string, number | string | boolean | null>>;
  readonly error?: string;
  readonly phase?: EmbedderDownloadPhaseWire;
  readonly progress?: number;
}

export interface MemoryTriggersDto {
  readonly idleMs: number;
  readonly turnThreshold: number;
  readonly bootScan: boolean;
  readonly userPromptSubmit?: {
    readonly enabled: boolean;
    readonly cueList: readonly string[];
    readonly minPromptLength: number;
  };
  readonly postToolUse?: {
    readonly enabled: boolean;
  };
  readonly turnComplete?: {
    readonly enabled: boolean;
  };
  readonly episode?: {
    readonly enabled: boolean;
  };
  readonly sessionEnd?: {
    readonly enabled: boolean;
  };
  readonly maxCuratesPerHour?: number;
  readonly curatorProvider?: string;
  readonly curatorModel?: string;
}

export interface SkillTriggersDto {
  readonly idleMs: number;
  readonly bootScan: boolean;
  readonly subagentStop?: {
    readonly enabled: boolean;
  };
  readonly turnComplete?: {
    readonly enabled: boolean;
  };
  readonly postToolUse?: {
    readonly enabled: boolean;
    readonly minEditCount: number;
  };
  readonly maxAnalyzesPerHour?: number;
}

export interface MemoryRetentionRunDto {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly outcome: 'completed' | 'partial' | 'failed';
  readonly reason: string | null;
  readonly error: string | null;
  readonly durationMs: number;
  readonly processedPurged: number;
  readonly stuckQuarantined: number;
  readonly ledgerPruned: number;
  readonly freedBytes: number;
  readonly pagesReclaimed: number;
  readonly memoriesArchived: number;
  readonly memoriesDeleted: number;
  readonly memoriesEvicted: number;
  readonly backlogRemaining: boolean;
}

export interface MemoryLifecyclePreviewDto {
  readonly measuredAt: number;
  readonly forRunAt: number;
  readonly archiveEligible: number;
  readonly deleteEligible: number;
  readonly overCap: number;
}

export type RetentionHealthVerdict =
  'disabled' | 'never-completed' | 'stalled' | 'unknown' | 'healthy';

export interface MemoryStorageHealthDto {
  readonly dbBytes: number | null; // page_count × page_size, live
  readonly reclaimableBytes: number | null; // freelist_count × page_size, live
  readonly autoVacuumIncremental: boolean | null;
  readonly observations: {
    readonly pendingRows: number | null; // live, idx_obs_queue_drain
    readonly pendingBytes: number | null; // live, octet_length over pending rows
    readonly oldestPendingAt: number | null; // live
    readonly stuckEligibleRows: number | null; // live: pending and older than stuckDays
    readonly processedRows: number | null; // as of the last run (not polled)
    readonly processedBytesEstimate: number | null; // processedRows × avg freed bytes per purged row
    readonly measuredAt: number | null; // when processedRows was counted
    readonly quarantineLedgerRows: number | null;
    readonly bootScanFailuresPending: number | null; // live: failed boot-scan sessions still retried
    readonly bootScanFailuresGivenUp: number | null; // live: failed boot-scan sessions given up on
  };
  readonly retention: {
    readonly healthVerdict: RetentionHealthVerdict;
    readonly enabled: boolean;
    readonly processedDays: number;
    readonly stuckDays: number;
    readonly lastRun: MemoryRetentionRunDto | null;
    readonly lastCompletedAt: number | null;
    readonly nextDueAt: number | null; // null = never ran → due at the next idle tick
    readonly lastSkippedAt: number | null;
    readonly lastSkipReason: string | null;
  };
  readonly memoryLifecycle: {
    readonly enabled: boolean;
    readonly archiveAfterDays: number;
    readonly deleteAfterDays: number;
    readonly maxPerWorkspace: number;
    readonly lastNote: 'disabled' | 'vec-unavailable' | null;
    readonly preview: MemoryLifecyclePreviewDto | null;
  };
  readonly readErrors?: readonly string[];
}

export interface MemoryDbHealthDto {
  readonly memories: number;
  readonly memory_chunks: number;
  readonly memory_chunks_vec: number;
  readonly memory_chunks_fts: number;
  readonly code_symbols: number;
  readonly code_symbols_vec: number;
  readonly coherent: boolean;
  readonly mismatches: readonly string[];
  readonly countErrors?: readonly string[];
}

export interface EligibilityHistogramDto {
  readonly prefilterTooThin: number;
  readonly prefilterRejected: number;
  readonly accepted: number;
}

export interface MemoryDiagnosticsParams {
  readonly workspaceRoot?: string | null;
  readonly eventLimit?: number;
}

export interface MemoryDiagnosticsResult {
  readonly lastRunAt: number | null;
  readonly lastRunStats: Readonly<
    Record<string, number | string | boolean | null>
  > | null;
  readonly recentEvents: readonly MemoryCuratorEventWire[];
  readonly dbHealth: MemoryDbHealthDto;
  readonly storage: MemoryStorageHealthDto;
  readonly triggers: MemoryTriggersDto;
}

export interface MemoryRunNowParams {
  readonly sessionId: string;
  readonly workspaceRoot: string;
}

export interface MemoryRunNowResult {
  readonly success: boolean;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly stats: Readonly<
    Record<string, number | string | boolean | null>
  > | null;
  readonly error?: string;
}

export interface MemorySetTriggersParams {
  readonly triggers: Partial<MemoryTriggersDto>;
  /**
   * The memory master switch (`memory.enabled`). Kept outside
   * `MemoryTriggersDto` because it is the switch above the triggers, not one
   * of them. Omitted → left as is. The pause toggle sends
   * `{ triggers: {}, enabled }`, which writes no trigger key.
   */
  readonly enabled?: boolean;
}

export interface MemorySetTriggersResult {
  readonly triggers: MemoryTriggersDto;
  /** `memory.enabled` read back after the write; `false` means paused. */
  readonly enabled: boolean;
}

export type MemoryGetTriggersParams = Record<string, never>;

export interface MemoryGetTriggersResult {
  readonly triggers: MemoryTriggersDto;
  /** `memory.enabled`; `false` means memory background work is paused. */
  readonly enabled: boolean;
}

