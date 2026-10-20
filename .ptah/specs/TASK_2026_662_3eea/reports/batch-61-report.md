# Batch 61 report

## Deleted manifest

Deleted all 96 files from the batch 61.0 manifest, relative to `libs/backend/skill-synthesis/src/lib/`:

- `archaeology/regex-demotion.spec.ts`
- `archaeology/session-archaeologist.degraded.spec.ts`
- `archaeology/session-archaeologist.service.spec.ts`
- `archaeology/session-archaeologist.service.ts`
- `archaeology/transcript-window.reader.spec.ts`
- `archaeology/transcript-window.reader.ts`
- `cleanup/session-transcript-locator.spec.ts`
- `cleanup/session-transcript-locator.ts`
- `cleanup/skill-backlog-cleanup.integration.spec.ts`
- `cleanup/skill-backlog-cleanup.service.spec.ts`
- `cleanup/skill-backlog-cleanup.service.ts`
- `cleanup/skill-backlog-cleanup.store.spec.ts`
- `cleanup/skill-backlog-cleanup.store.ts`
- `cleanup/skill-backlog-cleanup.types.ts`
- `digest/digest.types.ts`
- `digest/skill-gap-curator.service.spec.ts`
- `digest/skill-gap-curator.service.ts`
- `digest/win-rate.spec.ts`
- `eligibility/session-work-evidence.spec.ts`
- `eligibility/session-work-evidence.ts`
- `gates/cluster-holdout-end-to-end.spec.ts`
- `gates/cluster-holdout.spec.ts`
- `gates/cluster-holdout.ts`
- `gates/judge-lens.ts`
- `gates/judge-panel.service.spec.ts`
- `gates/judge-panel.service.ts`
- `gates/replay-validator.service.spec.ts`
- `gates/replay-validator.service.ts`
- `gates/trigger-eval.service.spec.ts`
- `gates/trigger-eval.service.ts`
- `gates/verdict-fallback.spec.ts`
- `lifecycle/adoptable-slug.spec.ts`
- `lifecycle/adoptable-slug.ts`
- `lifecycle/centroid-order.ts`
- `lifecycle/curator-report.ts`
- `lifecycle/skill-backlog-purge-state.store.spec.ts`
- `lifecycle/skill-backlog-purge-state.store.ts`
- `lifecycle/skill-retirement.service.spec.ts`
- `lifecycle/skill-retirement.service.ts`
- `lifecycle/skill-umbrella-merge.service.spec.ts`
- `lifecycle/skill-umbrella-merge.service.ts`
- `queue/skill-budget.store.spec.ts`
- `queue/skill-budget.store.ts`
- `queue/skill-drain.boot-deferral.spec.ts`
- `queue/skill-drain.budget.spec.ts`
- `queue/skill-drain.failures.spec.ts`
- `queue/skill-drain.fairness.spec.ts`
- `queue/skill-drain.gates.spec.ts`
- `queue/skill-drain.idempotency.spec.ts`
- `queue/skill-drain.network-backoff.spec.ts`
- `queue/skill-drain.service.ts`
- `queue/skill-drain.test-support.ts`
- `queue/skill-drain.tier-throughput.spec.ts`
- `queue/skill-queue.store.claim.spec.ts`
- `queue/skill-queue.store.reap.spec.ts`
- `queue/skill-queue.store.rekey.spec.ts`
- `queue/skill-queue.store.reopen-payload.spec.ts`
- `queue/skill-queue.store.spec.ts`
- `queue/skill-queue.store.ts`
- `queue/skill-queue.types.ts`
- `queue/stage-handlers.service.ts`
- `candidate-body.ts`
- `cosine-similarity.spec.ts`
- `cosine-similarity.ts`
- `diagnostics.service.spec.ts`
- `diagnostics.service.ts`
- `diagnostics.types.ts`
- `event-wire.ts`
- `prefilter-corpus-measurement.spec.ts`
- `r10-enhancement-window.spec.ts`
- `skill-candidate.row-mappers.ts`
- `skill-candidate.store.spec.ts`
- `skill-candidate.store.ts`
- `skill-cluster-dedup.service.spec.ts`
- `skill-cluster-dedup.service.ts`
- `skill-clustering.service.spec.ts`
- `skill-clustering.service.ts`
- `skill-curator.service.spec.ts`
- `skill-curator.service.ts`
- `skill-invocation-tracker.spec.ts`
- `skill-invocation-tracker.ts`
- `skill-md-generator.roots.spec.ts`
- `skill-md-generator.spec.ts`
- `skill-md-generator.ts`
- `skill-promotion.repropagation.spec.ts`
- `skill-promotion.service.spec.ts`
- `skill-promotion.service.ts`
- `skill-suggestion.store.spec.ts`
- `skill-suggestion.store.ts`
- `skill-synthesis.pause-resume.spec.ts`
- `skill-synthesis.service.enqueue.spec.ts`
- `skill-synthesis.service.spec.ts`
- `skill-synthesis.service.ts`
- `skill-synthesis.stage-handlers.spec.ts`
- `skill-synthesizer.service.spec.ts`
- `skill-synthesizer.service.ts`

## Kept (live importer)

None of the manifest files has a live TypeScript importer after the registration and public export cleanup. The direct relative-import scan across retained `libs`, `apps`, and `tools` TypeScript files reported `LIVE_IMPORTS 0`. `queue/queue-db.test-support.ts` remains because the retained invocation-event-store spec imports it. `skill-judge.service.ts` remains; its panel files had no retained importer.

## Step 1 edits

- Updated the parse-fallback, environment-immutability, and network-backoff lane-runner specs to pass the current constructor arguments. Assertions were unchanged.
- Removed `makeBudgetStub` and its `SkillBudgetStore` import from `lanes/lane-runner.test-support.ts`.

## Registration and exports

- Removed candidate, budget, and queue store class registrations and imports from `di/register.ts`. Kept `di/tokens.ts` intact for batch 62.
- Added explicit unregistered-token assertions for those stores in `di/register.spec.ts`.
- Removed the deleted `SkillSynthesisService` export from `src/index.ts`.

## Step 3 edits

- Removed `skillSynthesis` and its type import and null initializer from `ThothRuntimeRefs`.
- Removed the unused optional synthesis field and type import from CLI `ThothRefs`, and removed its obsolete smoke-spec fixtures.
- Changed Electron `BootRefs` to extend `ThothRuntimeRefs` directly.
- Removed the obsolete Thoth runtime spec assertion and null fixture.
- Searched the requested host/runtime paths for `refs.skillSynthesis`, `skillSynthesis: null`, and `.skillSynthesis`; no live reader or initializer remains. Settings and RPC namespace flags were left intact.

## Final sweep

- The requested seven-symbol search returned 56 lines and found no executable references to deleted classes outside `di/tokens.ts`. Remaining hits are comments/documentation in retained TypeScript source and the intentionally retained token declarations. `registerSkillSynthesisServices` hits refer to the retained registration function, not the deleted `SkillSynthesisService` class.
- No test, typecheck, lint, build, Nx, Jest, or compiler diagnostic command was run, per the hard rule. Static and runtime validation remains with the orchestrator.

## Decisions

- Deleted `gates/judge-panel.service.ts` and its spec because no retained service imports the panel; kept `skill-judge.service.ts` for enhancer preview. Reversible by restoring the panel files if a new consumer is introduced.
- Kept `di/tokens.ts` and the spec that checks its token descriptions because batch 62 owns token removal. Reversible during batch 62.
- Treated filename matches in unrelated modules and comments as references only when an actual TypeScript import resolved to a manifest file. The exact relative-import scan found none. Reversible by restoring a deleted file if an importer is later identified.

## Not done

- Automated checks and diagnostics were prohibited by the batch instructions.
