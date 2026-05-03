/**
 * @ptah-extension/skill-synthesis — public API (Track 2 of TASK_2026_HERMES).
 *
 * Records each successful AI session, when a stable trajectory repeats
 * 3 times the corresponding workflow is promoted to a permanent SKILL.md
 * under `~/.ptah/skills/<slug>/`. Cosine-similarity dedup against the
 * active set and an LRU cap of 50 keeps the skill library focused.
 */
export { SkillCandidateStore } from './lib/skill-candidate.store';
export { SkillMdGenerator } from './lib/skill-md-generator';
export type { SkillMdInput, MaterializedSkill } from './lib/skill-md-generator';
export {
  SkillPromotionService,
  type PromotionDecision,
} from './lib/skill-promotion.service';
export {
  SkillInvocationTracker,
  type RecordInvocationInput,
  type RecordInvocationResult,
} from './lib/skill-invocation-tracker';
export { SkillSynthesisService } from './lib/skill-synthesis.service';
export {
  TrajectoryExtractor,
  type ExtractedTrajectory,
  MIN_TURNS_FOR_TRAJECTORY,
} from './lib/trajectory-extractor';

export {
  SKILL_SYNTHESIS_TOKENS,
  type SkillSynthesisDIToken,
} from './lib/di/tokens';
export { registerSkillSynthesisServices } from './lib/di/register';

export type {
  SkillId,
  CandidateId,
  SkillStatus,
  SkillCandidateRow,
  SkillInvocationRow,
  SkillSynthesisSettings,
  NewCandidateInput,
  RegisterCandidateResult,
} from './lib/types';
