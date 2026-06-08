/**
 * RPC contracts for the skill clone/enhance/reconcile surface
 * (`skillSynthesis:` namespace, P3-3).
 *
 * Shared MUST NOT import backend libs, so the registry kind / clone-status
 * literals are mirrored here rather than imported from skill-synthesis.
 */

export type SkillCloneKind = 'skill' | 'agent' | 'command';
export type SkillCloneStatus = 'clone' | 'authored' | 'synth' | 'diverged';

export interface CloneSummary {
  slug: string;
  kind: SkillCloneKind;
  cloneStatus: SkillCloneStatus;
  diverged: boolean;
  invocationCount: number;
  successRate: number;
  lastEnhancedAt: number | null;
  historyCount: number;
  pendingSourceHash: string | null;
}

export interface SkillCloneHistoryEntry {
  ts: string;
  hasBody: boolean;
}

export interface SkillCloneInvocationStats {
  total: number;
  succeeded: number;
  failed: number;
  distinctContexts: number;
}

export type SkillSynthesisListClonesParams = Record<string, never>;
export interface SkillSynthesisListClonesResult {
  clones: CloneSummary[];
}

export interface SkillSynthesisGetCloneParams {
  slug: string;
  kind: SkillCloneKind;
}
export interface SkillSynthesisGetCloneResult {
  clone: CloneSummary | null;
  body: string | null;
  history: SkillCloneHistoryEntry[];
}

export interface SkillSynthesisEnhanceNowParams {
  slug: string;
}
export interface SkillSynthesisEnhanceNowResult {
  changed: boolean;
  slug: string;
  kind: SkillCloneKind;
  judgeScore: number | null;
  judgeReason: string | null;
  historyTs: string | null;
  skipReason: string | null;
}

export interface SkillSynthesisRevertEnhancementParams {
  slug: string;
  historyTs: string;
}
export interface SkillSynthesisRevertEnhancementResult {
  reverted: boolean;
  slug: string;
  revertedFrom: string;
  newHistoryTs: string | null;
}

export interface SkillSynthesisRebaseCloneParams {
  kind: SkillCloneKind;
  slug: string;
}
export interface SkillSynthesisRebaseCloneResult {
  kind: SkillCloneKind;
  slug: string;
  sourceHash: string;
  snapshotPath: string | null;
  failed: boolean;
  reason: string | null;
}

export interface SkillSynthesisKeepCloneParams {
  kind: SkillCloneKind;
  slug: string;
}
export interface SkillSynthesisKeepCloneResult {
  kind: SkillCloneKind;
  slug: string;
  sourceHash: string;
}

export interface SkillSynthesisInvocationStatsParams {
  slug: string;
}
export interface SkillSynthesisInvocationStatsResult {
  slug: string;
  stats: SkillCloneInvocationStats;
}
