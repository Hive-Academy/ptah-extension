/**
 * Skill Synthesis UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need skill-synthesis services without pulling the skill
 * tab components — and the Thoth shell graph behind them — into the bundle:
 *
 *   import { SkillSynthesisRpcService } from '@ptah-extension/skill-synthesis-ui/services';
 *
 * For components, use the main entry point:
 *
 *   import { SkillSynthesisTabComponent } from '@ptah-extension/skill-synthesis-ui';
 *
 * Components are deferred (TASK_2026_187, I-3/R4).
 */

export { SkillSynthesisRpcService } from './lib/services/skill-synthesis-rpc.service';
