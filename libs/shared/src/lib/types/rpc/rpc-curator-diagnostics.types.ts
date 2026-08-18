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
  | 'curator-pass-start'
  | 'backfill-progress'
  | 'backfill-complete'
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
  readonly turnComplete?: {
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

// ── Skill-synthesis lanes (TASK_2026_180, Phase 1) ──────────────────────────
//
// A LANE is the declared-capability record one background LLM stage runs
// against. The wire mirror of `SkillLaneConfig`
// (`skill-synthesis/src/lib/lanes/lane.types.ts`) — structural, not imported,
// because `libs/shared` is the foundation layer and may not import a backend
// lib.
//
// The invariant this contract carries onto the wire: **lanes differ ONLY by
// capability fields.** `provider` is an opaque registry id here and is never
// compared against a literal anywhere downstream; the only questions asked of
// it are "is it empty?" and "what does the resolver hand back?". A discriminant
// that named a vendor would make the capability fields decoration.

/**
 * The four stages that call an LLM. `archaeologist` and `replay` ship in later
 * phases but are in the union from the start, because the settings tree and the
 * picker UI are built once against it.
 */
export type SkillLaneIdDto = 'archaeologist' | 'synthesis' | 'judge' | 'replay';

/** Bare tier aliases. Resolved by the SDK, never by a hardcoded model id. */
export type SkillLaneTierDto = 'haiku' | 'sonnet' | 'opus';

export interface SkillLaneDto {
  readonly id: SkillLaneIdDto;
  /** Registry provider id, or `''` = inherit the active workspace provider. */
  readonly provider: string;
  /** Concrete model id, a bare tier alias, or `''` = fall back. */
  readonly model: string;
  /** Bare tier used when `model` is `''` and a provider IS configured. */
  readonly defaultTier: SkillLaneTierDto;
  /**
   * Whether this lane's endpoint honours JSON-Schema constrained output.
   * `'parse'` means it does not and the manual JSON extractors are the only
   * path.
   */
  readonly structuredOutput: 'sdk' | 'parse';
  /**
   * Whether this lane may run the multi-pass retrieval loop. `'none'` collapses
   * it to a single pass rather than letting a model that cannot drive tools
   * burn the whole `timeoutMs` discovering that.
   */
  readonly toolUse: 'required' | 'none';
  /** Per-lane wall clock for one LLM call. */
  readonly timeoutMs: number;
  /** Prompt input budget in characters, applied per lane. */
  readonly maxInputChars: number;
  /** Upper bound on retrieval passes. Only the archaeologist exceeds 1. */
  readonly maxPasses: number;
}

/** All four lanes, always complete — the read side never returns a partial. */
export type SkillLanesDto = {
  readonly [K in SkillLaneIdDto]: SkillLaneDto;
};

/**
 * A sparse patch: any subset of lanes, any subset of their fields.
 *
 * `id` is excluded because a lane's identity is the key it is filed under,
 * never a writable field. An omitted field is left alone rather than blanked,
 * matching `flattenSkillLanes`, which skips `undefined` instead of persisting
 * it.
 */
export interface SkillSetLanesParams {
  readonly lanes: Partial<
    Record<SkillLaneIdDto, Partial<Omit<SkillLaneDto, 'id'>>>
  >;
}

export interface SkillSetLanesResult {
  readonly lanes: SkillLanesDto;
}

export type SkillGetLanesParams = Record<string, never>;

export interface SkillGetLanesResult {
  readonly lanes: SkillLanesDto;
}
