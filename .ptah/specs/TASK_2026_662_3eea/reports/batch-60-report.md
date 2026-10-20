# Batch 60.1 report

## Changed

- `libs/backend/skill-synthesis/src/lib/di/register.ts`: removed pipeline class and token registrations, retained live library wiring and four registrations still required by retained constructors.
- `libs/backend/skill-synthesis/src/lib/di/register.spec.ts`: narrowed the registration assertion to retained tokens and removed obsolete pipeline resolution checks.
- `libs/backend/skill-synthesis/src/index.ts`: removed pipeline-only public re-exports and obsolete pipeline API comments.

## Removed registrations

`SKILL_BACKLOG_CLEANUP_STORE`, `SKILL_BACKLOG_CLEANUP_SERVICE`, `SKILL_BACKLOG_PURGE_STATE_STORE`, `SKILL_RETIREMENT_SERVICE`, `SKILL_UMBRELLA_MERGE_SERVICE`, `SKILL_PROMOTION_SERVICE`, `SKILL_INVOCATION_TRACKER`, `SKILL_SYNTHESIS_SERVICE`, `SKILL_CLUSTER_DEDUP_SERVICE`, `SKILL_CURATOR_SERVICE`, `SKILL_DIAGNOSTICS_SERVICE`, `SKILL_SYNTHESIZER_SERVICE`, `SKILL_SUGGESTION_STORE`, `SKILL_CLUSTERING_SERVICE`, `SKILL_DRAIN_SERVICE`, `SKILL_STAGE_HANDLERS_SERVICE`, `SESSION_ARCHAEOLOGIST_SERVICE`, `REPLAY_VALIDATOR_SERVICE`, `TRIGGER_EVAL_SERVICE`, `JUDGE_PANEL_SERVICE`, `SKILL_GAP_CURATOR_SERVICE`.

Their class singleton registrations were removed too, along with `SessionTranscriptLocator`, `SkillMdGenerator`, and other pipeline-only classes. `di/tokens.ts` was left intact.

## Kept registrations

`FOREGROUND_ACTIVITY_TRACKER`, `SKILL_TRIGGER_SERVICE`, `SKILL_INVOCATION_RECORDER`, `SKILL_REGISTRY_STORE`, `SKILL_TASK_GRADE_STORE`, `SKILL_MD_MIGRATION_STATE_STORE`, `SKILL_REGISTRY_CATALOG_SERVICE`, `SKILL_ENHANCER_SERVICE`, `SPEC_HARVESTER_SERVICE`, `SUBAGENT_METRICS_EXTRACTOR`, `SKILL_SCORECARD_SERVICE`, `NETWORK_BACKOFF`, `LANE_RESOLVER_SERVICE`, `LANE_RUNNER_SERVICE`, `SESSION_VERDICT_STORE`; plus the event store, telemetry seam, trajectory extractor, repropagation port, and findings port. Also retained temporarily: `SKILL_CANDIDATE_STORE`, `SKILL_JUDGE_SERVICE`, `SKILL_QUEUE_STORE`, `SKILL_BUDGET_STORE` (see Blocked).

## Removed exports

Removed all barrel re-exports from candidate, cleanup, lifecycle/promotion, old invocation tracker, synthesis outcome, synthesizer, suggestion, clustering/dedup, judge, curator, queue/budget/drain/workers, archaeology writer, replay/trigger/judge gates, digest, diagnostics, and event-wire modules. Removed the pipeline-only constants and types exported from `lib/types` and the unused `cosineSimilarity` export.

## Kept exports with external importers

- `SkillSynthesisService` class export: `libs/backend/thoth-runtime/src/lib/types.ts:7`, `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:22` (type imports). Its DI registration was still removed.
- `SkillSynthesisSettings` type: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:37`.
- `registerSkillSynthesisServices`: `apps/ptah-electron/src/di/phase-2-libraries.ts:88`, `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:26`, and host smoke specs.
- `resolveSkillsRoot`: `apps/ptah-extension-vscode/src/activation/plugin-activation.ts:17`.
- `LaneRunnerService`, `LaneRunRequest`, `LaneRunResult`: `tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.ts:25-29`.
- `SKILL_SYNTHESIS_TOKENS` and other preserve-list exports remain for the host/runtime consumers. The grouped external search found no live importer of removed pipeline class or constant exports.

## Host token audit

No expected-resolvable list or container smoke spec referenced a removed registration, so no host list edit was needed. The only external hit for a removed token was `apps/ptah-electron/src/activation/wire-runtime.spec.ts:247`, which registers its own fake `SKILL_SYNTHESIS_SERVICE`; no production container resolution depends on our removed registration. `apps/ptah-electron/src/di/phase-2-libraries.ts:395` contains an outdated comment about the synthesis service; production boot edits are outside this batch.

## Blocked

- `SpecHarvesterService` injects `SKILL_CANDIDATE_STORE` at `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:93`; `SkillScorecardService` also injects it at `skill-scorecard.service.ts:40`. The event store exposes usage counts but no token/cost aggregates, so the scorecard's existing aggregate behavior cannot be moved to it within the assigned files. Candidate store registration remains. Scorecard source/spec were not changed.
- `SkillEnhancerService` injects `SKILL_JUDGE_SERVICE` at `skill-enhancer.service.ts:238`; judge registration remains. The judge in turn injects `LANE_RUNNER_SERVICE` at `skill-judge.service.ts:138`.
- `LaneRunnerService` injects `SKILL_BUDGET_STORE` at `lanes/lane-runner.service.ts:369` and optionally `SKILL_QUEUE_STORE` at `:382`; both registrations remain.
- Batch 61 cannot delete `skill-synthesis.service.ts` while the two external type imports named above remain. Those files are outside this batch's ownership; the public class export remains until their owners remove the imports.

## Decisions

- Retained the four pipeline registrations injected by preserved services. Removing them would make retained services fail to resolve. This is reversible when their constructors are changed by a later batch.
- Retained the `SkillSynthesisService` public class export because two external type importers still use it; its registration was removed as requested. This is reversible once those imports are cut.
- Kept scorecard behavior unchanged because the event store lacks the aggregate API it needs, and extending that store is outside the assigned file list. This is reversible after its read API is added.

## Verification and remaining work

Static source and external-reference searches were performed. Tests, typecheck, lint, build, Nx, Jest, and diagnostics were not run under the batch's hard rule. The orchestrator must verify the changed project. Pipeline dependency cuts and external type-import cleanup remain for later ownership.
