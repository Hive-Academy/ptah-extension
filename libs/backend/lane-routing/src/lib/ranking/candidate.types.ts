/**
 * Ranking candidates (part A §4).
 *
 * Plain data for one routing call. Lane identity is `ptahCliId` for a Ptah
 * CLI row and `cli` otherwise (part A data flow, step 5). Family prefers the
 * row's `family` and otherwise `laneFamilyOf`. A null limit map, or a missing
 * key, is `unknown`: missing evidence is not `at-limit`.
 */
import {
  laneFamilyOf,
  SUBAGENT_FAMILY,
  type CliDetectionResult,
  type CliType,
  type LaneFamilyInput,
  type LaneLimitState,
} from '@ptah-extension/shared';

export interface LaneCandidate {
  readonly kind: 'lane';
  /** `ptahCliId` when the row is a Ptah CLI agent; otherwise `cli`. */
  readonly id: string;
  readonly cli: CliType;
  readonly ptahCliId?: string;
  readonly family: string;
  readonly installed: boolean;
  readonly disabled: boolean;
  readonly limitState: LaneLimitState;
  /** Copied from the row. `0` means unranked and is preserved. */
  readonly preferredRank?: number;
}

export interface SubagentCandidate {
  readonly kind: 'subagent';
  /** `subagent:<role>`. */
  readonly id: string;
  readonly role: string;
  readonly family: typeof SUBAGENT_FAMILY;
}

export type RoutingCandidate = LaneCandidate | SubagentCandidate;

export function laneCandidateId(
  row: Pick<CliDetectionResult, 'cli' | 'ptahCliId'>,
): string {
  if (row.cli === 'ptah-cli' && row.ptahCliId) {
    return row.ptahCliId;
  }
  return row.cli;
}

/** Row `family` when the lister set it; otherwise `laneFamilyOf`. */
export function resolveLaneFamily(
  row: LaneFamilyInput & Pick<CliDetectionResult, 'family'>,
): string {
  if (row.family) {
    return row.family;
  }
  return laneFamilyOf(row);
}

/**
 * Limit-map key is the candidate id (`cli` or `ptahCliId`). A null map means
 * the limit lookup was unavailable, so every lane is `unknown`.
 */
export function limitStateForCandidate(
  candidateId: string,
  limits: ReadonlyMap<string, LaneLimitState> | null,
): LaneLimitState {
  if (limits === null) {
    return 'unknown';
  }
  return limits.get(candidateId) ?? 'unknown';
}

export function toLaneCandidate(
  row: CliDetectionResult,
  limits: ReadonlyMap<string, LaneLimitState> | null,
): LaneCandidate {
  const id = laneCandidateId(row);
  return {
    kind: 'lane',
    id,
    cli: row.cli,
    ...(row.cli === 'ptah-cli' && row.ptahCliId
      ? { ptahCliId: row.ptahCliId }
      : {}),
    family: resolveLaneFamily(row),
    installed: row.installed,
    disabled: row.disabled === true,
    limitState: limitStateForCandidate(id, limits),
    ...(typeof row.preferredRank === 'number'
      ? { preferredRank: row.preferredRank }
      : {}),
  };
}

export function toSubagentCandidate(role: string): SubagentCandidate {
  if (role.trim() === '') {
    throw new Error('subagent role must be non-empty');
  }
  return {
    kind: 'subagent',
    id: `subagent:${role}`,
    role,
    family: SUBAGENT_FAMILY,
  };
}
