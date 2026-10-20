# Batch 61.0 report

## Changes

- Moved `SkillCandidateStore.reconcileSubagentEvent` (candidate store:1376) and its reconciliation helpers into `SkillInvocationEventStore` (event store:195, helpers:243 and 274). The new store parses selected event IDs with a Zod row schema.
- Moved `SkillCandidateStore.getScorecardAggregates` (candidate store:1503), its empty aggregate helper, and aggregate row schema into `SkillInvocationEventStore` (event store:290 and 341). The original candidate methods remain temporarily because candidate pipeline specs still call them; that store and its specs are in the deletion manifest.
- Added `skill-invocation-event.store.spec.ts` with exact task attribution, fallback attribution, idempotence, and scorecard aggregate cases. The old candidate specs remain attached to the pipeline candidate store until batch 61 removes that file.
- `SpecHarvesterService` and its two specs now inject/construct `SkillInvocationEventStore`, matching its class registration in `di/register.ts`.
- `SkillScorecardService` and its spec now use `SkillInvocationEventStore.getScorecardAggregates`; the local win-rate shape no longer imports candidate-store types.
- `LaneRunnerService` no longer injects budget or queue stores, records usage in the budget ledger, retries by requeueing failed queue items, or accepts `queueItemId` in its request. Failure classification, retry timing, execution limits, and returned usage remain. Removed ledger/requeue cases from the three assigned lane specs and updated their constructor arguments.
- `di/register.ts` and its spec no longer register/expect the candidate, budget, and queue symbol aliases. Kept the judge and lane runner registrations. Did not alter `di/tokens.ts`.

## Batch 61 deletion manifest

Paths below are relative to `libs/backend/skill-synthesis/src/lib/`. These 96 files are pipeline-only after the kept service changes; delete them together with any host registration/export cleanup owned by batch 61.

- `archaeology/regex-demotion.spec.ts` — Pipeline session archaeology or its spec.
- `archaeology/session-archaeologist.degraded.spec.ts` — Pipeline session archaeology or its spec.
- `archaeology/session-archaeologist.service.spec.ts` — Pipeline session archaeology or its spec.
- `archaeology/session-archaeologist.service.ts` — Pipeline session archaeology or its spec.
- `archaeology/transcript-window.reader.spec.ts` — Pipeline transcript window reader or its spec.
- `archaeology/transcript-window.reader.ts` — Pipeline transcript window reader or its spec.
- `cleanup/session-transcript-locator.spec.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/session-transcript-locator.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/skill-backlog-cleanup.integration.spec.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/skill-backlog-cleanup.service.spec.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/skill-backlog-cleanup.service.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/skill-backlog-cleanup.store.spec.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/skill-backlog-cleanup.store.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `cleanup/skill-backlog-cleanup.types.ts` — Pipeline backlog cleanup implementation, type, or spec.
- `digest/digest.types.ts` — Pipeline digest curator, type, or spec.
- `digest/skill-gap-curator.service.spec.ts` — Pipeline digest curator, type, or spec.
- `digest/skill-gap-curator.service.ts` — Pipeline digest curator, type, or spec.
- `digest/win-rate.spec.ts` — Pipeline digest curator, type, or spec.
- `eligibility/session-work-evidence.spec.ts` — Pipeline work evidence gate or spec.
- `eligibility/session-work-evidence.ts` — Pipeline work evidence gate or spec.
- `gates/cluster-holdout-end-to-end.spec.ts` — Pipeline validation gate or spec.
- `gates/cluster-holdout.spec.ts` — Pipeline validation gate or spec.
- `gates/cluster-holdout.ts` — Pipeline validation gate or spec.
- `gates/judge-lens.ts` — Pipeline validation gate or spec.
- `gates/judge-panel.service.spec.ts` — Pipeline validation gate or spec.
- `gates/judge-panel.service.ts` — Pipeline validation gate or spec.
- `gates/replay-validator.service.spec.ts` — Pipeline validation gate or spec.
- `gates/replay-validator.service.ts` — Pipeline validation gate or spec.
- `gates/trigger-eval.service.spec.ts` — Pipeline validation gate or spec.
- `gates/trigger-eval.service.ts` — Pipeline validation gate or spec.
- `gates/verdict-fallback.spec.ts` — Pipeline validation gate or spec.
- `lifecycle/adoptable-slug.spec.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/adoptable-slug.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/centroid-order.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/curator-report.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/skill-backlog-purge-state.store.spec.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/skill-backlog-purge-state.store.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/skill-retirement.service.spec.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/skill-retirement.service.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/skill-umbrella-merge.service.spec.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `lifecycle/skill-umbrella-merge.service.ts` — Pipeline retirement, merge, or purge lifecycle code/spec.
- `queue/skill-budget.store.spec.ts` — Pipeline budget ledger or spec.
- `queue/skill-budget.store.ts` — Pipeline budget ledger or spec.
- `queue/skill-drain.boot-deferral.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.budget.spec.ts` — Pipeline budget ledger or spec.
- `queue/skill-drain.failures.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.fairness.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.gates.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.idempotency.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.network-backoff.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.service.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.test-support.ts` — Pipeline queue drain or spec.
- `queue/skill-drain.tier-throughput.spec.ts` — Pipeline queue drain or spec.
- `queue/skill-queue.store.claim.spec.ts` — Pipeline queue store/handler or spec.
- `queue/skill-queue.store.reap.spec.ts` — Pipeline queue store/handler or spec.
- `queue/skill-queue.store.rekey.spec.ts` — Pipeline queue store/handler or spec.
- `queue/skill-queue.store.reopen-payload.spec.ts` — Pipeline queue store/handler or spec.
- `queue/skill-queue.store.spec.ts` — Pipeline queue store/handler or spec.
- `queue/skill-queue.store.ts` — Pipeline queue store/handler or spec.
- `queue/skill-queue.types.ts` — Pipeline queue store/handler or spec.
- `queue/stage-handlers.service.ts` — Pipeline queue store/handler or spec.
- `candidate-body.ts` — Pipeline candidate representation/store or spec.
- `cosine-similarity.spec.ts` — Pipeline-only helper or measurement spec.
- `cosine-similarity.ts` — Pipeline-only helper or measurement spec.
- `diagnostics.service.spec.ts` — Pipeline diagnostics or spec.
- `diagnostics.service.ts` — Pipeline diagnostics or spec.
- `diagnostics.types.ts` — Pipeline diagnostics or spec.
- `event-wire.ts` — Pipeline-only helper or measurement spec.
- `prefilter-corpus-measurement.spec.ts` — Pipeline-only helper or measurement spec.
- `r10-enhancement-window.spec.ts` — Pipeline-only helper or measurement spec.
- `skill-candidate.row-mappers.ts` — Pipeline candidate representation/store or spec.
- `skill-candidate.store.spec.ts` — Pipeline candidate representation/store or spec.
- `skill-candidate.store.ts` — Pipeline candidate representation/store or spec.
- `skill-cluster-dedup.service.spec.ts` — Pipeline selection/promotion or spec.
- `skill-cluster-dedup.service.ts` — Pipeline selection/promotion or spec.
- `skill-clustering.service.spec.ts` — Pipeline selection/promotion or spec.
- `skill-clustering.service.ts` — Pipeline selection/promotion or spec.
- `skill-curator.service.spec.ts` — Pipeline selection/promotion or spec.
- `skill-curator.service.ts` — Pipeline selection/promotion or spec.
- `skill-invocation-tracker.spec.ts` — Pipeline invocation tracker or spec.
- `skill-invocation-tracker.ts` — Pipeline invocation tracker or spec.
- `skill-md-generator.roots.spec.ts` — Pipeline SKILL.md generator or spec.
- `skill-md-generator.spec.ts` — Pipeline SKILL.md generator or spec.
- `skill-md-generator.ts` — Pipeline SKILL.md generator or spec.
- `skill-promotion.repropagation.spec.ts` — Pipeline selection/promotion or spec.
- `skill-promotion.service.spec.ts` — Pipeline selection/promotion or spec.
- `skill-promotion.service.ts` — Pipeline selection/promotion or spec.
- `skill-suggestion.store.spec.ts` — Pipeline suggestion store or spec.
- `skill-suggestion.store.ts` — Pipeline suggestion store or spec.
- `skill-synthesis.pause-resume.spec.ts` — Pipeline orchestration/synthesis or spec.
- `skill-synthesis.service.enqueue.spec.ts` — Pipeline orchestration/synthesis or spec.
- `skill-synthesis.service.spec.ts` — Pipeline orchestration/synthesis or spec.
- `skill-synthesis.service.ts` — Pipeline orchestration/synthesis or spec.
- `skill-synthesis.stage-handlers.spec.ts` — Pipeline orchestration/synthesis or spec.
- `skill-synthesizer.service.spec.ts` — Pipeline orchestration/synthesis or spec.
- `skill-synthesizer.service.ts` — Pipeline orchestration/synthesis or spec.

## Kept list check

Retained lane runner, resolver, lane auth port/types/JSON, network backoffs, skill judge, foreground activity tracker, session verdict store/types, invocation event store, task grade store, enhancer, catalog/registry, scorecard, spec harvester/extractor, triggers, SKILL.md migration/state, repropagation port, trajectory extractor, outcome seam, model resolver, `di/tokens.ts`, and `di/register.ts`. Also retain `queue/queue-db.test-support.ts`: the new invocation event store spec imports its SQLite opener. `skill-invocation-recorder.ts` and `internal-query.interface.ts` remain kept.

`queueItemId` appears in pipeline `queue/skill-drain.failures.spec.ts` and a comment in `tools/mcp-bench/src/memory-skills/doubles/recorded-lane-runner.ts`; no kept production caller was found. Candidate/budget/queue tokens remain referenced by pipeline files listed above and by the untouched token declarations. No host source registration hit was found in the scoped token search.

## Blocked

- Strict batch ownership leaves sibling lane specs `lanes/lane-runner.parse-fallback.spec.ts`, `lanes/lane-runner.env-immutability.spec.ts`, and `lanes/lane-runner.network-backoff.spec.ts` with old positional constructors that pass a budget stub; they need an orchestrator-owned follow-up before checks. Pipeline specs in `archaeology/` and `gates/` also call the old constructor but are in the deletion manifest.
- `lanes/lane-runner.test-support.ts` still exports `makeBudgetStub` and imports `SkillBudgetStore` for those out-of-scope sibling specs. Remove that stub/import when the sibling specs are updated, before deleting the budget store.
- No test, typecheck, lint, build, Nx, or Jest command was run, as instructed. AST parsing of edited TypeScript files succeeded; static type and runtime behavior remain unverified here.

## Decisions

- Kept candidate-store method copies temporarily because existing candidate pipeline specs still invoke them; deleting the candidate store and specs removes the duplication. Reversible by deleting those pipeline files.
- Used the event store class token because `di/register.ts` registers it by class. Reversible by changing that registration and all consumers together.
- Retained `queue-db.test-support.ts` because the new kept event-store spec uses it. Reversible by giving the spec another database opener.
- Removed only the three pipeline symbol aliases from DI while leaving token declarations untouched as required. Reversible by restoring aliases if a retained host consumer is found.

