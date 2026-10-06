/**
 * Input and output shapes of the stats-grid limit view model
 * (TASK_2026_596, Component 15). See `stats-limit-view-model.ts`.
 */
import type {
  AgentFailureKind,
  AgentStatus,
  CliUsageTotals,
  LaneLimitState,
  LaneStateContext,
  LocalTimeOptions,
  PlanLimitOwnerSnapshot,
  PlanWindowKey,
  PlanWindowState,
  QuotaOwnerRef,
} from '@ptah-extension/shared';

// ------------------------------------------------------------------ input

/** One CLI lane run of the session, as the host view reads it. */
export interface StatsLimitLaneRun {
  readonly runId: string;
  /** CLI id (`codex`, `ptah-cli`, …); part of the lane tile id. */
  readonly cli: string;
  /** Display name of the CLI ("Codex"). */
  readonly cliLabel: string;
  readonly role?: string | null;
  /** Model id as reported, for display; absent when unknown. */
  readonly model?: string | null;
  /** Resolved model scope (`opus`, `sonnet`); `null`/absent when unknown. */
  readonly modelScope?: string | null;
  readonly status: AgentStatus;
  /** Rebuilt from persisted history after a reload. */
  readonly restored: boolean;
  readonly startedAt: number;
  readonly failureKind?: AgentFailureKind;
  /** Owner recorded at the run; absent or malformed reads "not recorded". */
  readonly quotaOwner?: QuotaOwnerRef | null;
  /** `null` or absent means unknown, never 0. */
  readonly usageTotals?: CliUsageTotals | null;
}

export interface StatsLimitViewModelInput {
  readonly sessionId: string;
  /** The session's current owner key; `null` while unresolved. */
  readonly sessionOwnerKey: string | null;
  /** The session's resolved model scope; `null` when unknown. */
  readonly sessionModelScope: string | null;
  readonly owners: readonly PlanLimitOwnerSnapshot[];
  /** Runs of this session only. */
  readonly laneRuns: readonly StatsLimitLaneRun[];
  /** Evaluation instant, epoch ms UTC. */
  readonly now: number;
  /** Zone and zone-name locale for absolute times; pass both explicitly. */
  readonly time: LocalTimeOptions;
  /**
   * The newest pull failed while `owners` is the retained snapshot. The host
   * view passes it in; this library never reads the store.
   */
  readonly refreshFailed?: boolean;
}

// ----------------------------------------------------------------- output

export type StatsChipTone =
  'error' | 'warning' | 'success' | 'info' | 'live' | 'neutral';

/** A state chip: the word carries the meaning, tone and glyph reinforce it. */
export interface StatsChip {
  readonly tone: StatsChipTone;
  /** Decorative glyph (render `aria-hidden`); absent when none. */
  readonly glyph?: string;
  readonly text: string;
}

/** Border tint of a tile; redundant to its chip. */
export type StatsTileTone = 'error' | 'warning' | 'info' | 'neutral';

/** Full detail of one window (plan tile expansion, lane full detail). */
export interface PlanWindowDetailModel {
  readonly windowKey: PlanWindowKey;
  readonly label: string;
  readonly state: PlanWindowState;
  /** Absent for a healthy window. */
  readonly chip?: StatsChip;
  /** "94% used", "$3.20 of $50.00", or "unknown". */
  readonly usedText: string;
  /** Percent for the meter; absent when the value is unknown. */
  readonly percent?: number;
  /** Reset facts, each absolute + relative; passed and next kept apart. */
  readonly resetFacts: readonly string[];
  /** Aged or not-confirmed explanation. */
  readonly note?: string;
  /** Per-field source chips for the values shown. */
  readonly sourceChips: readonly string[];
}

export type PlanLimitTileKind = 'window' | 'evidence' | 'cooldown' | 'status';

export interface PlanLimitTileModel {
  /** Stable id: `plan:<owner>:<window>`, `plan-evidence:<owner>[:<scope>]`, … */
  readonly id: string;
  readonly kind: PlanLimitTileKind;
  readonly label: string;
  /** Caption text that may truncate on a closed tile. */
  readonly captionLead: string;
  /** Distinguishing suffix that remains visible when the lead truncates. */
  readonly captionTail?: string;
  /** Full caption for the tooltip. */
  readonly caption: string;
  readonly value: string;
  readonly resetLine: string;
  readonly chip?: StatsChip;
  readonly tone: StatsTileTone;
  /** Short source chips for the values on the closed face. */
  readonly sourceChips: readonly string[];
  /** Window tiles only. */
  readonly window?: PlanWindowDetailModel;
  /** Expansion text of evidence, cooldown and status tiles. */
  readonly detailLines: readonly string[];
}

/** The collapsed-row alert (P4 variant A): only at or near the limit. */
export interface StatsLimitIndicator {
  readonly state: 'at-limit' | 'near-limit';
  readonly tone: 'error' | 'warning';
  readonly text: string;
}

export interface StatsLimitNote {
  /** `info` is explanatory, never a warning; `neutral` states a gap. */
  readonly tone: 'info' | 'neutral';
  readonly text: string;
}

export interface LaneRunRowModel {
  readonly runId: string;
  readonly label: string;
  readonly model: string;
  readonly tokensText: string;
  readonly costText: string;
  readonly stateText: string;
  /** Restored runs only. */
  readonly startedText?: string;
}

/**
 * How a subgroup's owner relates to the session's owner.
 * - `same` / `different`: both known (`ownerRelation`).
 * - `unknown-session-owner`: the run's owner is known, the comparison is not
 *   possible; only the run's own owner is shown.
 * - `undetermined`: the run's owner identity is unknown.
 * - `not-recorded`: the run carries no valid owner reference.
 */
export type LaneOwnerStatus =
  | 'same'
  | 'different'
  | 'unknown-session-owner'
  | 'undetermined'
  | 'not-recorded';

/** A "see plan tiles" chip of a same-owner window (A2). */
export interface LanePlanTileChip {
  readonly planTileId: string;
  readonly chip: StatsChip;
}

export interface LaneSubgroupModel {
  /** `<owner key | ?>|<model scope>`, stable across pushes. */
  readonly key: string;
  readonly heading: string;
  readonly ownerStatus: LaneOwnerStatus;
  readonly ownerLabel: 'Same account' | 'Different owner' | 'Unknown owner';
  readonly ownerText: string;
  readonly state: LaneLimitState;
  readonly stateChip: StatsChip;
  readonly runs: readonly LaneRunRowModel[];
  readonly planTileChips: readonly LanePlanTileChip[];
  /** Windows shown in full (different owner, or not on a plan tile). */
  readonly windows: readonly PlanWindowDetailModel[];
  readonly evidenceLines: readonly string[];
  readonly cooldownLine?: string;
  readonly notes: readonly StatsLimitNote[];
}

export interface LaneFaceChipModel {
  readonly chip: StatsChip;
  readonly sourceChips: readonly string[];
}

export interface LaneUsageTileModel {
  /** `lane:<cli>:<role|none>`. */
  readonly id: string;
  readonly label: string;
  readonly caption: string;
  readonly tokensText: string;
  /** "+1 unknown" when only some runs are known. */
  readonly tokensUnknownText?: string;
  readonly costLine: string;
  readonly runChip: StatsChip;
  readonly limitChips: readonly LaneFaceChipModel[];
  readonly tone: StatsTileTone;
  readonly runCount: number;
  readonly subgroups: readonly LaneSubgroupModel[];
}

export interface LaneSubtotalTileModel {
  readonly id: typeof LANES_SUBTOTAL_TILE_ID;
  readonly caption: string;
  readonly tokensText: string;
  readonly summary: string;
}

export interface StatsLimitViewModel {
  readonly indicator?: StatsLimitIndicator;
  /**
   * Neutral "refresh failed — showing last observed data" line; present only
   * when a pull failed while owner data is held.
   */
  readonly refreshNotice?: string;
  readonly planTiles: readonly PlanLimitTileModel[];
  readonly laneTiles: readonly LaneUsageTileModel[];
  readonly subtotal?: LaneSubtotalTileModel;
  /** Number of lane runs (the "LANES n" pill). */
  readonly lanesCount: number;
}

export const LANES_SUBTOTAL_TILE_ID = 'lanes-subtotal';
export const LANE_CAPTION = 'lane · not in totals';

/** Clock, zone and engine thresholds of one build. */
export interface StatsLimitContext {
  readonly now: number;
  readonly time: LocalTimeOptions;
  readonly lane: LaneStateContext;
}
