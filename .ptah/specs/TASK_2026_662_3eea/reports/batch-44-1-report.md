# Batch 44.1 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` and its spec: removed boot scanning, idle and turn analysis hooks, enqueue calls, synthesis events, and their state. Kept Skill, Task, subagent, and prompt expansion invocation capture, plus Stop-triggered spec harvesting.
- `libs/backend/skill-synthesis/src/lib/skill-registry-catalog.service.ts` and its spec: removed candidate lookup and linking. Sidecar clones still upsert registry rows, including origin, path, divergence, pending source hash, and authored/clone status. `linked` remains in the result contract and is always zero.
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts` and its spec: removed candidate store reads, candidate-backed trajectory selection, and automatic eligibility. Automatic proposal generation is disabled; manual proposal generation, judging, apply, one-shot enhancement, revert, scorecard evidence, and spec findings remain. Historical threshold and cooldown exports remain for Library status consumers.

## Constructor changes and outside call sites

- `SkillTriggerService`: removed synthesis service, session activity registry, session end registry, SQLite connection, JSONL reader, curator rate limiter, and session-id-resolved registry. Its retained parameters still have `@inject`.
  - Other direct constructors: `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.integration.spec.ts:136`; `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.boot-defer.spec.ts:168`.
  - Token/class registrations or value fakes: `libs/backend/skill-synthesis/src/lib/di/register.ts:98,160`; `apps/ptah-electron/src/activation/wire-runtime.spec.ts:295`; `apps/ptah-electron/src/activation/boot-order.spec.ts:208`; `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts:418,438,733,769`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:177,212`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime-edge.spec.ts:107,135`.
- `SkillRegistryCatalogService`: removed candidate store. Other direct constructor: `libs/backend/skill-synthesis/src/lib/skill-registry-reconcile-wiring.spec.ts:118`. Token/class registration: `libs/backend/skill-synthesis/src/lib/di/register.ts:103,178`. Catalog token value fake: `apps/ptah-electron/src/activation/plugin-activation.spec.ts:194`.
- `SkillEnhancerService`: removed candidate store and trajectory extractor. Class/token registration: `libs/backend/skill-synthesis/src/lib/di/register.ts:104,181`. Token value fakes: `libs/backend/skill-synthesis/src/lib/di/register.spec.ts:170-173`; `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:311-314,2296-2299`. No other direct constructor was found.

The outside files above were not edited. The two older trigger specs and registry reconciliation spec still construct the old signatures; the orchestrator owns their follow-up.

## What stays wired

The trigger still registers SDK subagent-stop, post-tool-use, prompt-expansion, and Stop callbacks. Telemetry reads only `skills.telemetry.enabled`, whose default is true; the legacy fallback is gone. The Stop callback still schedules the spec harvester. The foreground activity tracker is outside these three services and was not changed. Catalog sync still reads mirror sidecars and upserts registry entries. Manual enhancement retains the pause switch `skillSynthesis.enabled`, proposal cache, judge, apply, repropagation, and revert.

## Acceptance search

`rg -n "enqueue|analyzeSession|bootScan|onIdle|SKILL_SYNTHESIS_SERVICE|SkillSynthesisService|SkillCandidateStore|autoApply|skillInvocationTelemetry" <six scoped files>` returned no hits. Nothing remains to classify. `git diff --check` found no whitespace errors. No test, typecheck, lint, build, serve, or e2e command was run, per task rule.

## Decisions

- Kept exported historical threshold/cooldown constants because RPC Library status and the package index still consume them. Automatic eligibility returns false for compatibility with the curator until its later cut.
- Kept the in-memory candidate-shaped judge input used to evaluate a manually generated draft; it has no candidate store access or persisted candidate write.
- Preserved `CatalogSyncResult.linked` as a compatibility field while candidate linking is removed.

## Clarifications Needed

none
