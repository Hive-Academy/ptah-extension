import type { PopulatedSkillTriggers } from './triggers/skill-trigger-config';

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

export type SkillIneligibleReason = 'prefilterTooThin' | 'prefilterRejected';

export interface SkillSynthesisEvent {
  /**
   * ULID assigned by `SkillSynthesisService.pushEvent` from a monotonic
   * factory: unique per event, strictly increasing in recording order, and the
   * same value on the live broadcast and in the diagnostics snapshot.
   */
  readonly id: string;
  readonly kind: SkillSynthesisEventKind;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly candidateId?: string;
  readonly reason?: SkillIneligibleReason | string;
  readonly stats?: Readonly<Record<string, number | string | boolean | null>>;
  readonly error?: string;
}

/**
 * What a producer hands to `SkillSynthesisService.pushEvent`. The id is not
 * the producer's to choose; the service assigns it when it records the event.
 */
export type SkillSynthesisEventInput = Omit<SkillSynthesisEvent, 'id'>;

export interface EligibilityHistogram {
  readonly prefilterTooThin: number;
  readonly prefilterRejected: number;
  readonly accepted: number;
}

export interface SkillCandidateStatusCounts {
  readonly candidate: number;
  readonly promoted: number;
  readonly rejected: number;
  readonly invocations: number;
  /** Promoted and resident. */
  readonly active: number;
  /** Promoted and dormant. */
  readonly dormant: number;
  /** Rejected by an umbrella merge. */
  readonly merged: number;
  /** Rejected by unused-skill retirement. */
  readonly retired: number;
}

export interface SkillSynthesisDiagnosticsSnapshot {
  readonly lastAnalyzeRunAt: number | null;
  readonly lastCuratorPassAt: number | null;
  readonly eligibilityHistogram: EligibilityHistogram;
  readonly byStatus: SkillCandidateStatusCounts;
  readonly recentEvents: readonly SkillSynthesisEvent[];
  readonly triggers: PopulatedSkillTriggers;
}
