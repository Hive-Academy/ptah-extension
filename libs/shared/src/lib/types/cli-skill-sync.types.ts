/**
 * Rival-CLI target vocabulary.
 *
 * What is left of this module after TASK_2026_278 Batch 2. It used to carry the
 * wire types of three parallel fan-out pipelines — `CliSkillSyncStatus`,
 * `CliPluginSyncState`, `CliAgentTransformResult`, `CliGenerationResult` — each
 * describing one pipeline's idea of "what got written where". All four went
 * with the pipelines. Outcomes are now reported once, for every artifact and
 * every target, by `HarnessHealth` in `harness-sync.types.ts`.
 *
 * `CliTarget` survives because it is the vocabulary the agent transformers
 * still speak: it names the CLIs whose prompt conventions differ from Claude's.
 *
 * Design: Pure TypeScript types, no runtime dependencies (shared library boundary).
 */

import type { CliType } from './agent-process.types';

/**
 * CLIs whose agent and skill formats Ptah transforms content for.
 *
 * A narrower set than `CliType`: it excludes the CLIs Ptah can drive but has no
 * harness surface for. Kept in sync with the rival `HarnessTargetId` members by
 * `libs/backend/harness-sync/src/lib/targets/rival-targets.ts`, which is the one
 * place their directories and capabilities are declared.
 */
export type CliTarget = Extract<
  CliType,
  'copilot' | 'codex' | 'cursor' | 'antigravity'
>;
