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
- `SkillSynthesizerService.buildSystemPrompt()` encodes skill-creator best practices (verb-first kebab name that never echoes the request; trigger-oriented `description` carrying ALL "when to use" info; concise imperative body with no frontmatter / no "When to use" section). Keep it aligned with `ptah-core/skills/skill-creator`.
- `SkillJudgeService` scores five criteria (novelty, actionability, scope, generalization, triggerClarity), averaged vs `minJudgeScore`; fails OPEN on LLM error. Runs at the promotion gate AND the suggestion-pass gate.
- `SkillSuggestionStore.updatePending(id, {name?, description?, body?})` edits a still-pending suggestion (immutable once accepted/dismissed); backs `skillSynthesis:updateSuggestion`. `skillSynthesis:getSuggestion` returns the full row incl. body.
- Invocation telemetry (`SkillTriggerService.onPostToolUse` → `SkillInvocationRecorder`, slug-keyed `skill_invocation_events`) records `Skill` tool use (`source:'tool-use'`), slash/skill expansion (`'prompt-expansion'`), AND **subagent runs** via the `Task` tool keyed on `subagent_type` (`'subagent'`). This usage signal is what makes agent/skill clones auto-enhance-eligible (`getInvocationStats(slug).total ≥ MIN_INVOCATIONS_TO_ENHANCE`). Without the `Task` branch, agent clones never accrue usage.
- `SkillEnhancerService.generateCandidate` injects kind-specific authoring best practices (skill-creator for skills, role/trigger guidance for agents, single-purpose for commands). `MIN_INVOCATIONS_TO_ENHANCE` + `ENHANCE_COOLDOWN_MS` are exported for the Library eligibility UI (surfaced on `CloneSummary.enhanceMinInvocations` / `enhanceCooldownUntil`).
- Judge calls go through `INTERNAL_QUERY_SERVICE_TOKEN` (injected) — do not invoke SDK directly.
- Residency budget = `maxActiveSkills` (default 200): the residency-cap demotion in `SkillPromotionService` flips the weakest resident to `dormant` (never rejects). The dormant set is fed to the junction layer's `disabledSkillIds` channel at the Electron activation seam (`apps/ptah-electron/src/activation/plugin-activation.ts`) — `agent-sdk`'s `SkillJunctionService` MUST NOT import `skill-synthesis` (hexagonal isolation).
- Authored guard: `SkillRegistryStore.listAuthoredSlugs()` + `SkillCandidateStore.getDominantSkillSlugForSessions()` drive the never-re-synthesize guard in `analyzeSession` and `runSuggestionPass`, and the dormancy exemption in promotion. Registry injected `{isOptional:true}` so non-Electron runtimes no-op.
- All boundary inputs validated via zod schemas in `rpc-handlers`; this lib enforces invariants in service constructors.

## Cross-Lib Rules

Used by `rpc-handlers`. No frontend imports.
