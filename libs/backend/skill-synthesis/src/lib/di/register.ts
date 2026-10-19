/** Register retained skill library services and required dependencies. */
import type { DependencyContainer } from 'tsyringe';
import type { Logger } from '@ptah-extension/vscode-core';
import { LANE_OUTCOME_TOKENS } from '@ptah-extension/lane-outcomes';
import { SkillTelemetrySeamAdapter } from '../outcome-seam/skill-telemetry-seam.adapter';
import { SkillInvocationEventStore } from '../skill-invocation-event.store';
import { TrajectoryExtractor } from '../trajectory-extractor';
import { SkillJudgeService } from '../skill-judge.service';
import { SkillTriggerService } from '../triggers/skill-trigger.service';
import { SkillInvocationRecorder } from '../skill-invocation-recorder';
import { SkillRegistryStore } from '../skill-registry.store';
import { SkillTaskGradeStore } from '../skill-task-grade.store';
import { SkillMdMigrationStateStore } from '../skill-md-migration-state.store';
import { SkillRegistryCatalogService } from '../skill-registry-catalog.service';
import { SkillEnhancerService } from '../skill-enhancer.service';
import {
  NoOpSkillRepropagation,
  SKILL_REPROPAGATION_TOKEN,
} from '../skill-repropagation.port';
import { SpecHarvesterService } from '../spec-harvester.service';
import { SubagentMetricsExtractor } from '../subagent-metrics-extractor';
import { SkillScorecardService } from '../skill-scorecard.service';
import { ForegroundActivityTracker } from '../queue/foreground-activity.tracker';
import { LaneResolverService } from '../lanes/lane-resolver.service';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import { ProviderNetworkBackoffs } from '../lanes/provider-network-backoffs';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import { SPEC_FINDINGS_TOKEN } from '../spec-findings.port';
import { SKILL_SYNTHESIS_TOKENS } from './tokens';

export function registerSkillSynthesisServices(
  container: DependencyContainer,
  logger: Logger,
): void {
  logger.info('[skill-synthesis] registering services');
  container.registerSingleton(ForegroundActivityTracker);
  container.register(SKILL_SYNTHESIS_TOKENS.FOREGROUND_ACTIVITY_TRACKER, {
    useToken: ForegroundActivityTracker,
  });
  container.registerSingleton(SkillInvocationEventStore);
  container.registerSingleton(SkillTelemetrySeamAdapter);
  container.register(LANE_OUTCOME_TOKENS.SKILL_TELEMETRY_SEAM, {
    useToken: SkillTelemetrySeamAdapter,
  });
  container.registerSingleton(TrajectoryExtractor);
  container.registerSingleton(SkillJudgeService);
  container.registerSingleton(SkillTriggerService);
  container.registerSingleton(SkillInvocationRecorder);
  container.registerSingleton(SkillRegistryStore);
  container.registerSingleton(SkillMdMigrationStateStore);
  container.registerSingleton(SkillRegistryCatalogService);
  container.registerSingleton(SkillEnhancerService);
  container.registerSingleton(SpecHarvesterService);
  container.registerSingleton(SubagentMetricsExtractor);
  container.registerSingleton(SkillScorecardService);
  container.registerSingleton(SessionVerdictStore);
  container.registerSingleton(LaneResolverService);
  container.registerSingleton(LaneRunnerService);
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_JUDGE_SERVICE, {
    useToken: SkillJudgeService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE, {
    useToken: SkillTriggerService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER, {
    useToken: SkillInvocationRecorder,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, {
    useToken: SkillRegistryStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_TASK_GRADE_STORE, {
    useToken: SkillTaskGradeStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_MD_MIGRATION_STATE_STORE, {
    useToken: SkillMdMigrationStateStore,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_CATALOG_SERVICE, {
    useToken: SkillRegistryCatalogService,
  });
  container.register(SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE, {
    useToken: SkillEnhancerService,
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
  // The lane runner and enhancer share provider back-off state.
  container.register(SKILL_SYNTHESIS_TOKENS.NETWORK_BACKOFF, {
    useValue: new ProviderNetworkBackoffs({
      logger,
      logPrefix: '[skill-synthesis]',
    }),
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
  container.register(SKILL_REPROPAGATION_TOKEN, {
    useClass: NoOpSkillRepropagation,
  });
  // The harvester is the live SpecFindingsPort impl for the enhancer.
  container.register(SPEC_FINDINGS_TOKEN, {
    useToken: SpecHarvesterService,
  });

  logger.info('[skill-synthesis] services registered');
}
