/**
 * Skill Synthesis UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need skill-synthesis services without pulling the skill
 * tab components — and the Thoth shell graph behind them — into the bundle:
 *
 *   import { SkillSynthesisLiveService } from '@ptah-extension/skill-synthesis-ui/services';
 *
 * For components, use the main entry point:
 *
 *   import { SkillSynthesisTabComponent } from '@ptah-extension/skill-synthesis-ui';
 *
 * `SkillSynthesisLiveService` is a `MESSAGE_HANDLERS` entry constructed at
 * bootstrap to receive skill-synthesis push events — it must stay EAGER. Only
 * the components are deferred (TASK_2026_187, I-3/R4).
 */

export { SkillSynthesisLiveService } from './lib/services/skill-synthesis-live.service';
export { SkillSynthesisRpcService } from './lib/services/skill-synthesis-rpc.service';
