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

export type EmbedderDownloadPhaseWire =
  | 'starting'
  | 'downloading'
  | 'ready'
  | 'failed';

export interface MemoryCuratorEventWire {
  readonly kind: MemoryCuratorEventKind;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly stats?: Readonly<Record<string, number | string | boolean | null>>;
  readonly error?: string;
  readonly phase?: EmbedderDownloadPhaseWire;
  readonly progress?: number;
}

export type SkillSynthesisEventKind =
  | 'analyze-run'
  | 'curator-pass'
  | 'idle-trigger'
  | 'boot-scan'
  | 'manual-run'
  | 'ineligible'
  | 'subagent-stop'
  | 'edit-then-test'
  | 'rate-limited'
  | 'error';

export interface SkillSynthesisEventWire {
  readonly kind: SkillSynthesisEventKind;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly stats?: Readonly<Record<string, number | string | boolean | null>>;
  readonly error?: string;
}

export interface MemoryTriggersDto {
  readonly preCompact: boolean;
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
  readonly sessionEnd: boolean;
  readonly idleMs: number;
  readonly bootScan: boolean;
  readonly subagentStop?: {
    readonly enabled: boolean;
  };
  readonly postToolUse?: {
    readonly enabled: boolean;
    readonly minEditCount: number;
  };
  readonly maxAnalyzesPerHour?: number;
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
}

export interface EligibilityHistogramDto {
  readonly tooFewTurns: number;
  readonly lowFidelity: number;
  readonly insufficientAbstraction: number;
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
  readonly lastDecayAt: number | null;
  readonly lastDecayStats: Readonly<
    Record<string, number | string | boolean | null>
  > | null;
  readonly recentEvents: readonly MemoryCuratorEventWire[];
  readonly dbHealth: MemoryDbHealthDto;
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
}

export interface MemorySetTriggersResult {
  readonly triggers: MemoryTriggersDto;
}

export type MemoryGetTriggersParams = Record<string, never>;

export interface MemoryGetTriggersResult {
  readonly triggers: MemoryTriggersDto;
}

export interface SkillDiagnosticsParams {
  readonly workspaceRoot?: string | null;
  readonly eventLimit?: number;
}

export interface SkillDiagnosticsResult {
  readonly lastAnalyzeRunAt: number | null;
  readonly lastCuratorPassAt: number | null;
  readonly totalCandidates: number;
  readonly totalPromoted: number;
  readonly totalRejected: number;
  readonly totalInvocations: number;
  readonly activeSkills: number;
  readonly eligibilityHistogram: EligibilityHistogramDto;
  readonly recentEvents: readonly SkillSynthesisEventWire[];
  readonly triggers: SkillTriggersDto;
}

export interface SkillAnalyzeNowParams {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly force?: boolean;
}

export interface SkillAnalyzeNowResult {
  readonly success: boolean;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly candidateId: string | null;
  readonly reason: string | null;
  readonly error?: string;
}

export interface SkillSetTriggersParams {
  readonly triggers: Partial<SkillTriggersDto>;
}

export interface SkillSetTriggersResult {
  readonly triggers: SkillTriggersDto;
}

export type SkillGetTriggersParams = Record<string, never>;

export interface SkillGetTriggersResult {
  readonly triggers: SkillTriggersDto;
}
