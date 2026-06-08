/**
 * skill-synthesis DI registration helper.
 *
 * Mirrors `registerPersistenceSqliteServices`. Pre-conditions:
 *  - `TOKENS.LOGGER` is registered.
 *  - `PERSISTENCE_TOKENS.SQLITE_CONNECTION` is registered.
 *  - `PLATFORM_TOKENS.WORKSPACE_PROVIDER` is registered.
 *  - `SDK_TOKENS.SDK_JSONL_READER` is registered (agent-sdk).
 *
 * Post-conditions: all four SKILL_SYNTHESIS_TOKENS resolve to singletons.
 * `PERSISTENCE_TOKENS.EMBEDDER` is treated as optional — the
 * promotion service short-circuits dedup when it's missing.
 */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { SkillCandidateStore } from '../skill-candidate.store';
import { SkillMdGenerator } from '../skill-md-generator';
import { SkillPromotionService } from '../skill-promotion.service';
import { SkillInvocationTracker } from '../skill-invocation-tracker';
import { SkillSynthesisService } from '../skill-synthesis.service';
import { TrajectoryExtractor } from '../trajectory-extractor';
import { SkillClusterDedupService } from '../skill-cluster-dedup.service';
import { SkillJudgeService } from '../skill-judge.service';
import { SkillCuratorService } from '../skill-curator.service';
import { SkillTriggerService } from '../triggers/skill-trigger.service';
import { SkillSynthesisDiagnosticsService } from '../diagnostics.service';
import { SkillInvocationRecorder } from '../skill-invocation-recorder';
import { SKILL_SYNTHESIS_TOKENS } from './tokens';

export function registerSkillSynthesisServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[skill-synthesis] registering services');
  container.registerSingleton(SkillCandidateStore);
  container.registerSingleton(SkillMdGenerator);
  container.registerSingleton(TrajectoryExtractor);
  container.registerSingleton(SkillClusterDedupService);
  container.registerSingleton(SkillJudgeService);
  container.registerSingleton(SkillCuratorService);
  container.registerSingleton(SkillPromotionService);
  container.registerSingleton(SkillInvocationTracker);
  container.registerSingleton(SkillSynthesisService);
  container.registerSingleton(SkillTriggerService);
  container.registerSingleton(SkillSynthesisDiagnosticsService);
  container.registerSingleton(SkillInvocationRecorder);
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE, {
    useToken: SkillCandidateStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_PROMOTION_SERVICE, {
    useToken: SkillPromotionService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_TRACKER, {
    useToken: SkillInvocationTracker,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, {
    useToken: SkillSynthesisService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_CLUSTER_DEDUP_SERVICE, {
    useToken: SkillClusterDedupService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE, {
    useToken: SkillJudgeService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE, {
    useToken: SkillCuratorService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE, {
    useToken: SkillTriggerService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_DIAGNOSTICS_SERVICE, {
    useToken: SkillSynthesisDiagnosticsService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER, {
    useToken: SkillInvocationRecorder,
  });

  logger.info('[skill-synthesis] services registered', {
    tokens: Object.keys(SKILL_SYNTHESIS_TOKENS),
  });
}
