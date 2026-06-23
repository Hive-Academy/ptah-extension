# @ptah-extension/skill-synthesis

[Back to Main](../../../CLAUDE.md)

## Purpose

Track 2 of TASK_2026_HERMES. Records each successful AI session; when a stable trajectory repeats 3 times the workflow is promoted to a permanent `SKILL.md` under `~/.ptah/skills/<slug>/`. Cosine-similarity dedup against the active set keeps the library focused; over the residency budget (`maxActiveSkills`, default 200) the weakest skills are demoted to `dormant` residency (kept on disk + in the DB, skipped at the junction layer) rather than rejected. Authored skills (`clone_status='authored'`) are first-class: never re-synthesized and never demoted to dormant.

## Boundaries

**Belongs here**:

- Candidate store, invocation tracker, trajectory extractor
- Promotion service + judge LLM caller
- Skill MD generator + migration utility
- Dedup (cosine clustering) + curator

**Does NOT belong**:

- DB connection (via `persistence-sqlite`)
- LLM execution (via `agent-sdk`'s `InternalQueryService` / `JsonlReaderService`)
- RPC surface (`SkillsSynthesisRpcHandlers` in `rpc-handlers`)

## Public API

Services: `SkillCandidateStore`, `SkillMdGenerator`, `SkillPromotionService`, `SkillInvocationTracker`, `SkillSynthesisService`, `SkillSynthesizerService`, `TrajectoryExtractor`, `SkillClusterDedupService`, `SkillJudgeService`, `SkillCuratorService`.
Helpers: `migrateSkillMdFiles`, `cosineSimilarity`.
DI: `SKILL_SYNTHESIS_TOKENS`, `INTERNAL_QUERY_SERVICE_TOKEN`, `SkillSynthesisDIToken`, `registerSkillSynthesisServices`.
Constants/types: `JUDGE_DEFAULT_MODEL_ID`, `MIN_TURNS_FOR_TRAJECTORY`, `SkillId`, `CandidateId`, `SkillStatus`, `SkillCandidateRow`, `SkillInvocationRow`, `SkillSynthesisSettings`, `NewCandidateInput`, `RegisterCandidateResult`, `PromotionDecision`, `SkillMdInput`, `MaterializedSkill`, `ExtractedTrajectory`, `RecordInvocationInput/Result`, `CuratorReport`.

## Internal Structure

- `src/lib/skill-candidate.store.ts` — SQLite-backed candidate rows
- `src/lib/trajectory-extractor.ts` — reads JSONL via `JsonlReaderService`
- `src/lib/skill-cluster-dedup.service.ts` — cosine-similarity clustering against active skills
- `src/lib/skill-promotion.service.ts` + `skill-judge.service.ts` — judge LLM gate before promotion
- `src/lib/skill-md-generator.ts` + `skill-md-migration.ts`
- `src/lib/skill-curator.service.ts` — LRU enforcement
- `src/lib/cosine-similarity.ts`
- `src/lib/di/{tokens,register}.ts`

## Dependencies

**Internal**: `@ptah-extension/persistence-sqlite`, `@ptah-extension/agent-sdk` (JsonlReader + InternalQuery), `@ptah-extension/memory-contracts`
**External**: `tsyringe`, `zod`

## Guidelines

- Trajectory extraction requires ≥ `MIN_TURNS_FOR_TRAJECTORY` turns.
- Judge calls go through `INTERNAL_QUERY_SERVICE_TOKEN` (injected) — do not invoke SDK directly.
- Residency budget = `maxActiveSkills` (default 200): the residency-cap demotion in `SkillPromotionService` flips the weakest resident to `dormant` (never rejects). The dormant set is fed to the junction layer's `disabledSkillIds` channel at the Electron activation seam (`apps/ptah-electron/src/activation/plugin-activation.ts`) — `agent-sdk`'s `SkillJunctionService` MUST NOT import `skill-synthesis` (hexagonal isolation).
- Authored guard: `SkillRegistryStore.listAuthoredSlugs()` + `SkillCandidateStore.getDominantSkillSlugForSessions()` drive the never-re-synthesize guard in `analyzeSession` and `runSuggestionPass`, and the dormancy exemption in promotion. Registry injected `{isOptional:true}` so non-Electron runtimes no-op.
- All boundary inputs validated via zod schemas in `rpc-handlers`; this lib enforces invariants in service constructors.

## Cross-Lib Rules

Used by `rpc-handlers`. No frontend imports.
