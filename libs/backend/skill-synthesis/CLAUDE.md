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
- `src/lib/lanes/` — the lane contract: `lane.types.ts` (capability record + failure kinds), `skill-lane-config.ts` (the `skillSynthesis.<lane>.*` settings sub-tree), `lane-auth-resolver.port.ts` (local mirror of `IProviderAuthResolver`), `lane-resolver.service.ts` (lane id → `{auth snapshot, model}`)
- `src/lib/archaeology/` — the session archaeologist's structured verdict (migration `0034`): `session-verdict.types.ts`, `SessionVerdictStore`
- `src/lib/queue/` — the durable synthesis queue (migration `0032`): `SkillQueueStore` (enqueue / CAS claim / heartbeat / reap), `SkillBudgetStore` (per-UTC-day token ledger), `SkillDrainService` (the gated, round-robin drain), `ForegroundActivityTracker` (ms since the last chat turn), and the row/stage/status types
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
- **The `unscored` verdict and where `judge_status` is enforced.** `judge_score: null` IS the `unscored` verdict — it is not a low score and never `0`. It replaces the three fail-OPEN `{passed: true, score: 10}` paths, so a candidate whose judge call failed reads back as "we do not know", carries the reason, and stays retry-eligible; promotion treats `unscored` as neither pass nor block. Migration `0033` deliberately ships `judge_status` with **NO `CHECK` constraint** (SQLite cannot widen a CHECK via `ALTER TABLE`, and phases 3/4 add scoring paths), so **the `JudgeStatus` TypeScript union in `types.ts` is the ONLY enforcement there is.** `SkillCandidateStore` is therefore the enforcing gate on both edges: `recordJudgeVerdict` throws on a non-member status, on `scored` with a non-finite score, and on any non-`scored` status carrying a number; `toCandidateRow` maps `null`/`''` to `null` ("never judged") and downgrades any unrecognised stored string to `'unscored'` with a warn. Do not add a second validation layer above the store, and do not catch and downgrade. The nine judge columns are written as ONE fixed UPDATE, never a dynamic fragment — a partial write leaves the previous pass's per-criterion scores beside a new headline score. The `0033` columns live directly on `SkillCandidateRow` (`JudgedCandidateRow` is a deprecated alias); `unjudgedVerdictFields()` supplies the never-judged block.
- Queue semantics (`src/lib/queue/`): **enqueue is idempotent, claiming is the at-most-once primitive.** `enqueue` is a plain INSERT whose `UNIQUE(session_id, stage)` violation becomes a guarded re-open gated on `turn_count` — never `INSERT OR IGNORE`, never UPSERT. `tryClaim` returning `null` means another worker won; that is success, not an error, and it must never throw. A stage that runs long MUST call `touchClaim(id)` between passes or `reapStale` will reclaim it mid-flight.
- Drain semantics (`SkillDrainService`): **`drain()` never throws** — every gate and every failure resolves to a `DrainSummary`. Gate order is a contract, not an implementation detail: `skillSynthesis.enabled` → daily token budget → battery → foreground backoff → abort, then reap → round-robin → CAS claim → stage dispatch. `enabled` is first because the Electron tray's "Pause background learning" writes that key, so paused must mean "reads nothing, spends nothing". Selection NEVER orders globally by `enqueued_at`: it walks eligible workspaces least-recently-drained first and bumps the cursor of every workspace it visited, including one that yielded nothing for the current tier. The token budget is a HARD stop checked twice — once per tick and once per item — and above 80 % of it the eligible window is ordered cheap-stages-first. `staleClaimTtlMs` must stay `>= 3 ×` the longest stage timeout (`assertStaleClaimTtl`, warns and continues). Stage handlers register via `registerStageHandler(stage, handler)`; an item whose stage has no handler in this host is marked `skipped`, never re-claimed forever. `skill-synthesis` still NEVER imports `cron-scheduler` — `onBattery` is a `drain()` parameter that `thoth-runtime` supplies from `IPowerMonitor`.
- **Lane semantics (`src/lib/lanes/`).** Every background LLM call runs on a **lane** — a declared-capability record (`provider`, `model`, `defaultTier`, `structuredOutput`, `toolUse`, `timeoutMs`, `maxInputChars`, `maxPasses`) read from `skillSynthesis.<lane>.*`. Four lanes: `archaeologist`, `synthesis`, `judge`, `replay`. Three rules that are contracts, not preferences:
  1. **No provider is privileged.** Lanes differ ONLY by capability fields. If any code path names a provider id, it is wrong — pinned mechanically by `lane-resolver.providers.spec.ts`, which is parameterized over `ANTHROPIC_PROVIDERS` and whose body contains zero provider-id literals. R6 (a small-context or non-tool-use model looping to timeout) is mitigated by `toolUse: 'none'` collapsing the pass loop — a capability guard, never a judgement about a vendor.
  2. **A lane MUST NOT mutate global `AuthEnv` or `process.env`.** `LaneResolverService` obtains an `OneShotAuthOverride` **snapshot** through the shared `IProviderAuthResolver` (token `Symbol.for('SdkProviderAuthResolver')`, injected `{isOptional:true}`) with `scope: 'lane'`, and passes it as `input.auth`. Never route a lane through `ProviderModelsService.setModelTier` / `applyPersistedTiers` — the latter writes `this.authEnv[k]` **and** `process.env[k]` unconditionally with no scope guard and would repoint the user's live chat session mid-conversation (R1). `'lane'` is inert with respect to globals by construction, because `setModelTier` guards its writes with `scope === 'mainAgent'`.
  3. **`LaneAuthOverride.env` is `Readonly<Record<string, string | undefined>>`, and the `| undefined` is load-bearing (R2).** The resolver blanks the chat provider's keys by ASSIGNING `undefined`, never `delete`-ing, because the consumer rebuilds the subprocess env as `{ ...process.env, ...override }`. Anything that drops undefined-valued keys — a JSON round-trip, `structuredClone`, a Zod parse, a truthiness filter — silently re-leaks foreground credentials into background work. Never serialize or normalize a lane env.
- **Lane resolution is three lines and has no provider branching** (`resolveLaneModel`): a pinned `model` wins; otherwise with NO provider configured it returns `resolveJudgeModel(settings.judgeModel, ws)` — byte-identical to today's call, which is the untouched-existing-installs guarantee; otherwise it returns the **bare tier alias**, which resolves through both `ANTHROPIC_DEFAULT_<TIER>_MODEL` and the provider entry's `defaultTiers` (a pinned dated Claude id would 404 against a non-Anthropic endpoint). Every lane defaults to `provider: ''` / `model: ''` = "inherit".
- **Unresolvable lane auth STALLS; it never falls back** (Q2). `ProviderAuthError` on a configured provider yields `{ok:false, kind:'auth-unresolvable'}` with a 30-min backoff and a user-facing reason; the queue row returns to `queued`. This is a deliberate divergence from the memory curator, which DOES fall back to the active provider (`sdk-internal-query.curator-llm.ts:84-91`) — falling back here would put background work straight onto the foreground quota, the exact defect phase 1 exists to remove. Any NON-auth error is rethrown rather than buried in a queue `reason`; the drain's own catch is where a real defect belongs.
- **`skill-synthesis` keeps ZERO direct SDK imports.** `IInternalQuery`, `LaneAuthOverride` and `ILaneAuthResolver` are LOCAL structural mirrors, not imports, because `agent-sdk` depends back on this side of the graph. Widening `IInternalQuery` is safe only while the concrete `InternalQueryService` still accepts the wider shape — it forwards field-by-field to `SdkQueryRunner.runOneShot`, which already declares `auth` and `outputFormat`.
- **`lane` must stay in `PROVIDER_SCOPED_TIER_PATTERN`** (`platform-core/src/file-settings-keys.ts`). A scope missing from that alternation fails in the WRITE direction only: reads fall through to `defaultTiers` and look correct, so nothing surfaces until a lane tier is persisted and silently discarded. Pinned by a round-trip spec in `file-settings-manager.spec.ts`.
- Residency budget = `maxActiveSkills` (default 200): the residency-cap demotion in `SkillPromotionService` flips the weakest resident to `dormant` (never rejects). The dormant set is fed to the junction layer's `disabledSkillIds` channel at the Electron activation seam (`apps/ptah-electron/src/activation/plugin-activation.ts`) — `agent-sdk`'s `SkillJunctionService` MUST NOT import `skill-synthesis` (hexagonal isolation).
- Authored guard: `SkillRegistryStore.listAuthoredSlugs()` + `SkillCandidateStore.getDominantSkillSlugForSessions()` drive the never-re-synthesize guard in `analyzeSession` and `runSuggestionPass`, and the dormancy exemption in promotion. Registry injected `{isOptional:true}` so non-Electron runtimes no-op.
- All boundary inputs validated via zod schemas in `rpc-handlers`; this lib enforces invariants in service constructors.

## Cross-Lib Rules

Used by `rpc-handlers`. No frontend imports.
