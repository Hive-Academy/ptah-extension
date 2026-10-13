/**
 * Lane data for the compact session card. A lane is one sub-agent, CLI agent
 * or background task working under a session. The `chat` lib builds these
 * values from the agent monitor store; `chat-ui` only renders them.
 */
export type CompactLaneKind = 'subagent' | 'cli' | 'background';

export type CompactLaneStatus =
  'waiting' | 'error' | 'running' | 'done' | 'stopped';

export interface CompactLaneRow {
  /** Lane key, unique across lane kinds; emitted when the row is selected. */
  readonly id: string;
  readonly name: string;
  readonly kind: CompactLaneKind;
  readonly status: CompactLaneStatus;
  /** Start time (ms since epoch); `null` when the store has none. */
  readonly startedAt: number | null;
  /** End time (ms since epoch); `null` while the lane has not ended. */
  readonly endedAt: number | null;
}

export interface CompactLaneSummary {
  /** Rows to show, already sorted and capped by the builder. */
  readonly rows: readonly CompactLaneRow[];
  /** Lanes not shown as rows: `total - rows.length`. */
  readonly moreCount: number;
  readonly total: number;
  readonly counts: Readonly<Record<CompactLaneStatus, number>>;
}

/** A pending permission, from the session itself or from a CLI lane. */
export interface CompactPermissionCallout {
  readonly kind: 'permission';
  readonly source: 'session' | 'cli';
  readonly requestId: string;
  /** CLI agent id; set when `source` is `cli`. */
  readonly agentId?: string;
  /** Tab that answers the request (the deciding tab for the answer). */
  readonly tabId: string | null;
  readonly text: string;
  readonly moreCount?: number;
}

export interface CompactQuestionCallout {
  readonly kind: 'question';
  readonly requestId: string;
  readonly text: string;
  readonly moreCount?: number;
}

export interface CompactErrorCallout {
  readonly kind: 'error';
  readonly requestId: string;
  readonly text: string;
  /** True only where a retry action exists for this error. */
  readonly canRetry: boolean;
}

export type CompactCallout =
  | CompactPermissionCallout
  | CompactQuestionCallout
  | CompactErrorCallout
  | null;

export type CompactRailState = 'running' | 'needs' | 'error' | 'done' | 'idle';
export type CompactRailDensity = 'comfortable' | 'dense';
export const COMPACT_RAIL_CARD_HEIGHT: Readonly<
  Record<CompactRailDensity, number>
> = {
  comfortable: 176,
  dense: 96,
};
