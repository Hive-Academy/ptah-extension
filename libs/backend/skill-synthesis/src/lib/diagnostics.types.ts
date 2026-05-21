export type SkillSynthesisEventKind =
  | 'analyze-run'
  | 'curator-pass'
  | 'idle-trigger'
  | 'boot-scan'
  | 'manual-run'
  | 'ineligible'
  | 'error';

export type SkillIneligibleReason =
  | 'tooFewTurns'
  | 'lowFidelity'
  | 'insufficientAbstraction';

export interface SkillSynthesisEvent {
  readonly kind: SkillSynthesisEventKind;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly candidateId?: string;
  readonly reason?: SkillIneligibleReason | string;
  readonly stats?: Readonly<Record<string, number | string | boolean | null>>;
  readonly error?: string;
}

export interface EligibilityHistogram {
  readonly tooFewTurns: number;
  readonly lowFidelity: number;
  readonly insufficientAbstraction: number;
  readonly accepted: number;
}

export interface SkillCandidateStatusCounts {
  readonly candidate: number;
  readonly promoted: number;
  readonly rejected: number;
  readonly invocations: number;
}

export interface SkillSynthesisDiagnosticsSnapshot {
  readonly lastAnalyzeRunAt: number | null;
  readonly lastCuratorPassAt: number | null;
  readonly eligibilityHistogram: EligibilityHistogram;
  readonly byStatus: SkillCandidateStatusCounts;
  readonly recentEvents: readonly SkillSynthesisEvent[];
  readonly triggers: {
    readonly sessionEnd: boolean;
    readonly idleMs: number;
    readonly bootScan: boolean;
  };
}
