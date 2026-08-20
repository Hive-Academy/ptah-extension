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
import { SkillRegistryStore } from '../skill-registry.store';
import { SkillRegistryCatalogService } from '../skill-registry-catalog.service';
import { SkillEnhancerService } from '../skill-enhancer.service';
import { SkillSynthesizerService } from '../skill-synthesizer.service';
import { SkillSuggestionStore } from '../skill-suggestion.store';
import { SkillClusteringService } from '../skill-clustering.service';
import {
  NoOpSkillRepropagation,
  SKILL_REPROPAGATION_TOKEN,
} from '../skill-repropagation.port';
import { SpecHarvesterService } from '../spec-harvester.service';
import { SubagentMetricsExtractor } from '../subagent-metrics-extractor';
import { SkillScorecardService } from '../skill-scorecard.service';
import { SkillQueueStore } from '../queue/skill-queue.store';
import { SkillBudgetStore } from '../queue/skill-budget.store';
import { ForegroundActivityTracker } from '../queue/foreground-activity.tracker';
import { SkillDrainService } from '../queue/skill-drain.service';
import { SkillStageHandlersService } from '../queue/stage-handlers.service';
import { LaneResolverService } from '../lanes/lane-resolver.service';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import { SessionArchaeologistService } from '../archaeology/session-archaeologist.service';
import { ReplayValidatorService } from '../gates/replay-validator.service';
import { TriggerEvalService } from '../gates/trigger-eval.service';
import { JudgePanelService } from '../gates/judge-panel.service';
import { CandidateNamerService } from '../naming/candidate-namer.service';
import { SkillGapCuratorService } from '../digest/skill-gap-curator.service';
import { SPEC_FINDINGS_TOKEN } from '../spec-findings.port';
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
  container.registerSingleton(SkillRegistryStore);
  container.registerSingleton(SkillRegistryCatalogService);
  container.registerSingleton(SkillEnhancerService);
  container.registerSingleton(SkillSynthesizerService);
  container.registerSingleton(SkillSuggestionStore);
  container.registerSingleton(SkillClusteringService);
  container.registerSingleton(SpecHarvesterService);
  container.registerSingleton(SubagentMetricsExtractor);
  container.registerSingleton(SkillScorecardService);
  container.registerSingleton(SkillQueueStore);
  container.registerSingleton(SkillBudgetStore);
  container.registerSingleton(ForegroundActivityTracker);
  container.registerSingleton(SkillDrainService);
  container.registerSingleton(SkillStageHandlersService);
  container.registerSingleton(LaneResolverService);
  container.registerSingleton(LaneRunnerService);
  container.registerSingleton(SessionVerdictStore);
  container.registerSingleton(SessionArchaeologistService);
  container.registerSingleton(ReplayValidatorService);
  container.registerSingleton(TriggerEvalService);
  container.registerSingleton(JudgePanelService);
  container.registerSingleton(CandidateNamerService);
  container.registerSingleton(SkillGapCuratorService);
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
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, {
    useToken: SkillRegistryStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_CATALOG_SERVICE, {
    useToken: SkillRegistryCatalogService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE, {
    useToken: SkillEnhancerService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIZER_SERVICE, {
    useToken: SkillSynthesizerService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE, {
    useToken: SkillSuggestionStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_CLUSTERING_SERVICE, {
    useToken: SkillClusteringService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SPEC_HARVESTER_SERVICE, {
    useToken: SpecHarvesterService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SUBAGENT_METRICS_EXTRACTOR, {
    useToken: SubagentMetricsExtractor,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE, {
    useToken: SkillScorecardService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE, {
    useToken: SkillQueueStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_BUDGET_STORE, {
    useToken: SkillBudgetStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER, {
    useToken: ForegroundActivityTracker,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE, {
    useToken: SkillDrainService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_STAGE_HANDLERS_SERVICE, {
    useToken: SkillStageHandlersService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.LANE_RESOLVER_SERVICE, {
    useToken: LaneResolverService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.LANE_RUNNER_SERVICE, {
    useToken: LaneRunnerService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SESSION_VERDICT_STORE, {
    useToken: SessionVerdictStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SESSION_ARCHAEOLOGIST_SERVICE, {
    useToken: SessionArchaeologistService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.REPLAY_VALIDATOR_SERVICE, {
    useToken: ReplayValidatorService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.TRIGGER_EVAL_SERVICE, {
    useToken: TriggerEvalService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.JUDGE_PANEL_SERVICE, {
    useToken: JudgePanelService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.CANDIDATE_NAMER_SERVICE, {
    useToken: CandidateNamerService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_GAP_CURATOR_SERVICE, {
    useToken: SkillGapCuratorService,
  });
  container.register(SKILL_REPROPAGATION_TOKEN, {
    useClass: NoOpSkillRepropagation,
  });
  // The harvester is the live SpecFindingsPort impl for the enhancer.
  container.register(SPEC_FINDINGS_TOKEN, {
    useToken: SpecHarvesterService,
  });

  logger.info('[skill-synthesis] services registered', {
    tokens: Object.keys(SKILL_SYNTHESIS_TOKENS),
  });
}
