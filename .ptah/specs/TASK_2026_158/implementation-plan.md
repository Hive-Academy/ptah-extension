# Implementation Plan — TASK_2026_158

Task specs as the evaluation substrate for subagents: metrics persistence, exact attribution, Library scorecards, metrics-aware enhancement.

**Requirements**: R1–R10 (groups A–D MUST, E deferred except R10 enabler) — see `task-description.md`.
**Status of this plan**: architecture specification (WHAT/WHY). Team-leader decomposes into atomic tasks.

---

## 1. Codebase Investigation Summary

All claims below verified by direct file reads on 2026-07-15.

### Signal sources (verified)

| Signal                | Location                                                                                                                                                                                                                                                         | Verified fact                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------- |
| Invocation events     | `libs/backend/persistence-sqlite/src/lib/migrations/0021_skill_invocation_events.ts` + `0027_skill_event_reconciliation.ts`                                                                                                                                      | Columns: `id, skill_slug, session_id, context_id, source, succeeded, is_error, invoked_at, reconciled_at, verdict_source`. No metrics, no task_id. Max migration = **0029** (`migrations/index.ts:243-247`); next free slot = **0030**.                                                                                                                                                                           |
| Event write path      | `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts:29-57` → `skill-candidate.store.ts:407-431` (`recordSkillEvent`)                                                                                                                              | Slug                                                                                                                                                                                                                                                                                                                                                                                                              | session | 2s-bucket dedup in recorder; store INSERT is a plain single-row insert. |
| Subagent capture seam | `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:261-284` (`onSubagentStop`)                                                                                                                                                              | **The only reliable seam.** In-code comment (lines 262-270) confirms the `Task` PostToolUse branch (lines 356-371) never fires for agent runs — subagents run in nested SDK sessions. `SubagentStopPayload` (`agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts:8-16`) carries `subagentSessionId, parentSessionId, workspaceRoot, agentId, agentType, transcriptPath, timestamp` — **no usage data**. |
| Transcript reader     | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:124-156` (`readJsonlMessages`)                                                                                                                                                           | Returns `SessionHistoryMessage[]` with `timestamp`, `message.usage` (`input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens` — `history.types.ts:72-77`), `message.model`, and `ContentBlock` (`type:'tool_use'` countable). 50MB guard throws `SdkError`. skill-synthesis already imports `JsonlReaderService` (existing acyclic edge).                                              |
| Pricing               | `libs/shared/src/lib/utils/pricing.utils.ts`                                                                                                                                                                                                                     | `findModelPricing(modelId)` (line 224), `calculateMessageCost` (line 280) — pure, shared. `AgentCostBreakdown`/`MessageTokenUsage` shapes in `subagent-cost.utils.ts:20-33` (stays pure, untouched).                                                                                                                                                                                                              |
| Harvester             | `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:89-126` + `skill-candidate.store.ts:443-481` (`reconcileSubagentEvent`)                                                                                                                          | Joins by slug + `invoked_at BETWEEN windowStart AND windowEnd` + `reconciled_at IS NULL`, newest-first, one row per batch verdict. `spec.taskId` is already available in `harvest()` (from `HarvestedSpec`), it is simply not passed down. Idempotency = `.harvested.json` marker + `reconciled_at` guard.                                                                                                        |
| Task-specs            | `libs/backend/task-specs/CLAUDE.md`, `task-index.store.ts`                                                                                                                                                                                                       | `skill-synthesis → task-specs` edge exists (spec-extractor uses `parseTaskFile`). Task index (migration 0029) keyed `(workspace_root, folder_name)`; folder name is the canonical task id.                                                                                                                                                                                                                        |
| Enhancer              | `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:346-433` (`generateCandidate`)                                                                                                                                                                   | Prompt already composes usage stats + trajectory + `SpecFindingsPort.getRecentFindings(slug)` (optional token `SPEC_FINDINGS_TOKEN`). `MAX_FINDINGS_CHARS = 4000` discipline in harvester. Gates: `MIN_INVOCATIONS_TO_ENHANCE` (line 46), `ENHANCE_COOLDOWN_MS` (line 44), judge gate (line 174).                                                                                                                 |
| Judge                 | `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:49`                                                                                                                                                                                                 | `judge(row, candidateBody, settings)` — five criteria, fails OPEN.                                                                                                                                                                                                                                                                                                                                                |
| R10 enabler           | `skill-registry.store.ts:154-168` (`markEnhanced(kind, slug, lastEnhancedAt, hash)`), `last_enhanced_at` column (line 200); `UserLayerMirrorService.listHistory(kind, slug)` returns per-`ts` snapshot entries (used in `skills-synthesis-rpc.handlers.ts:1276`) | Enhancement timestamps ARE already queryable per slug — **no schema gap** (D7).                                                                                                                                                                                                                                                                                                                                   |
| RPC surface           | `libs/shared/src/lib/types/rpc.types.ts:1388-1516`, `rpc/rpc-skill-clone.types.ts`, `rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` + `.schema.ts`                                                                                              | `skillSynthesis:` prefix already in `ALLOWED_METHOD_PREFIXES` — new methods in this namespace need **RpcMethodMap entries + Zod schemas + handler registration only**, no `rpc-handler.ts` change. `CloneSummary` assembled in `toCloneSummary` (handlers:1268-1297).                                                                                                                                             |
| UI                    | `libs/frontend/skill-synthesis-ui/` — `skill-clones-view.component.ts`, `skill-clones-state.service.ts`                                                                                                                                                          | Library tab = clones list signal + lazy `loadDetail(slug, kind)`. Signals + OnPush + `@ptah-extension/markdown` mock pattern already in place. Ships VS Code + Electron.                                                                                                                                                                                                                                          |

---

## 2. Architectural Decisions

### D1 — Metrics storage: widen `skill_invocation_events` (migration 0030), no sibling table

**Decision**: `0030_skill_event_metrics.ts` appended to the `MIGRATIONS` tuple. Eight nullable columns on `skill_invocation_events` + one composite index.

```sql
-- 0030_skill_event_metrics.ts  (static SQL, no ${} interpolation)
ALTER TABLE skill_invocation_events ADD COLUMN input_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN output_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN cache_creation_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN cost_usd REAL;
ALTER TABLE skill_invocation_events ADD COLUMN duration_ms INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN tool_count INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN task_id TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_task
  ON skill_invocation_events(skill_slug, task_id);
```

Spec test `0030_skill_event_metrics.spec.ts` mirrors 0027's `PRAGMA table_info` shape-assertion pattern (R1.3). Pre-existing rows stay valid with NULL metrics (R1.4) — `ALTER TABLE ADD COLUMN` with no default is exactly that.

**Rationale**: one row per invocation is the natural grain; the harvester's reconcile `UPDATE`, the scorecard aggregates, and future E-group delta computation (R10.2) all consume the same rows with zero JOINs. SQLite `AVG()` ignores NULLs natively, satisfying R1.2 for free.
**Rejected — sibling `skill_invocation_metrics` table**: adds a JOIN to every aggregate and a second insert/update path for no isolation benefit — E-group needs raw rows, not different columns; nullable widening on a low-write-rate telemetry table has no churn cost. Precedent: 0027 already widened this same table in place.
**Rejected — `task_id` in a separate migration**: R3.1 explicitly allows same migration; two migrations for one feature is churn.

### D2 — Capture point: SubagentStop hook + transcript-derived metrics, computed inside skill-synthesis

**Decision**: new `SubagentMetricsExtractor` service in `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts`, called from `SkillTriggerService.onSubagentStop` (already fire-and-forget `void this.recordInvocation(...)` — R2.4 satisfied structurally). It reads `payload.transcriptPath` via the already-injected-adjacent `JsonlReaderService` (`SDK_TOKENS.SDK_JSONL_READER`, already a constructor dep of the trigger service) and computes:

- **tokens**: sum of `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}` over assistant messages — same semantics as `AgentCostBreakdown.tokens` (R2.2);
- **cost_usd**: per assistant message via shared `findModelPricing(message.model)` + token math; `null` when no message carries a priceable model (Copilot/Codex/ollama paths — R1.2);
- **duration_ms**: last message timestamp − first message timestamp (transcript-local, no registry dependency);
- **tool_count**: count of `content` blocks with `type === 'tool_use'` — matches `countToolCalls` semantics in `subagent-cost.utils.ts:121-133`;
- **task_id**: see D3.

Flow in `onSubagentStop` (async, off hot path): `extract(transcriptPath)` inside `try/catch` → on any failure (missing file, 50MB `SdkError`, malformed JSONL) metrics = all-null and a `logger.warn` — then `recordInvocation` proceeds exactly as today (R2.3: metrics failure never breaks invocation counting). `RecordSkillEventInput` and `SkillCandidateStore.recordSkillEvent` gain optional `metrics`/`taskId` fields (contract §4.1). Recorder dedup key unchanged.

**Hexagonal compliance (R2, R3.3)**: dependency direction is `skill-synthesis → agent-sdk` (existing, per skill-synthesis CLAUDE.md); `agent-sdk` is untouched and imports nothing from skill-synthesis. Shared utils stay pure (R2.2).

**Rejected — extend `SubagentStopPayload` with usage in agent-sdk**: the SDK hook input carries no usage; agent-sdk would have to parse the transcript inside the hook handler (hooks must return fast) and would duplicate JsonlReader logic at the wrong layer.
**Rejected — execution-tree walk (frontend `streamingState`)**: frontend must not be the source of backend telemetry (frontend↔backend isolation), and it does not exist in the headless CLI runtime. `getAgentCostBreakdown` stays display-only.
**Rejected — `SubagentRegistryService` record (vscode-core)**: `SubagentRecord` holds lifecycle state only, no token usage (verified `subagent-state-store.ts`), and durable persistence is explicitly absent there.
**Rejected — enriching the PostToolUse `Task` branch**: it never fires for agent runs (verified in-code comment, trigger service lines 262-270); the branch stays as-is as a dedup-guarded fallback.

### D3 — task_id attribution: extract from the subagent transcript's first user message

**Decision**: pure function `extractTaskIdFromPrompt(text: string): string | null` (exported for unit tests, lives next to the extractor). The orchestration workflow always embeds the task folder in the subagent prompt ("Task Folder: `…/.ptah/specs/TASK_YYYY_NNN`"). Deterministic rule:

1. first match of `/[\\/.]?ptah[\\/]specs[\\/](TASK_\d{4}_\d{3})\b/i` (specs-path-anchored — immune to incidental task-id mentions like `depends_on` references);
2. else, if exactly ONE distinct `\bTASK_\d{4}_\d{3}\b` appears in the first user message, use it;
3. else `null`.

Applied by `SubagentMetricsExtractor` to the first `role:'user'` message of the transcript it is already reading. No task context → `task_id = NULL`, behavior identical to today (R3.2).

**Rationale**: zero cross-boundary plumbing — no agent-sdk change, no frontend involvement, no session-state registry to keep alive across restarts; works in every runtime that records subagent events (VS Code, Electron, CLI) and for orchestrations started from chat OR the Tasks board, and survives session resume.
**Rejected — in-memory session→task registry fed by the `tasks:` start RPC**: misses orchestrations launched directly in chat (the common path today), loses state on host restart mid-task, and needs new coupling from rpc-handlers into skill-synthesis mutable state.
**Rejected — task index "single in-progress row" inference**: ambiguous under concurrent tasks — the exact bug group B exists to fix.
**Rejected — harvester-only back-fill**: at harvest time two concurrent same-slug runs are indistinguishable without a record-time stamp; that IS the window heuristic.
Note: `skill-synthesis → task-specs` remains used only for `parseTaskFile` (existing); no task-index query is needed for attribution.

### D4 — Harvester: exact task_id reconciliation first, window fallback second

**Decision**: `SkillCandidateStore.reconcileSubagentEvent` input gains `taskId: string` (the spec's task id — the harvester already has `spec.taskId` in scope at the call site, `spec-harvester.service.ts:100-107`). New selection logic, one batch verdict still flips one row (cardinality parity with today):

1. **Exact pass**: newest un-reconciled row `WHERE skill_slug = ? AND source='subagent' AND task_id = ? AND reconciled_at IS NULL` (ignores the window, R4.1) → `verdict_source = 'spec:TASK_X'`. Uses `idx_skill_inv_events_task`, no full-table scan (NFR).
2. **Fallback**: only when no exact row matched — today's window query **restricted to `task_id IS NULL` rows** (a stamped row must never be stolen by another task's window) → `verdict_source = 'spec-window:TASK_X'` (R4.2 audit disambiguation).

Idempotency unchanged: `.harvested.json` marker + `reconciled_at IS NULL` guard (R4.4). **Required regression test** (R4.3): two specs, overlapping file mtimes windows, same executor slug, task_id-stamped events → each receives its own verdict; plus a legacy-rows test proving window fallback still works and gets `spec-window:` provenance.

**Harvester fs usage (open question 5)**: deferred — group B touches only the reconcile call path and the store; migrating `spec-harvester.service.ts` off `node:fs/promises` onto `IFileSystemProvider` is orthogonal cleanup, listed as an explicit non-goal (and per NFR, the pattern is not expanded — no new `node:fs` call sites are introduced by this task's service code; the new extractor uses `JsonlReaderService`, which owns its own I/O in agent-sdk).

### D5 — Scorecard data flow: `SkillScorecardService` + two new `skillSynthesis:` RPC methods, separate DTO

**Decision**:

- **Aggregation lives in skill-synthesis** (it owns `skill_invocation_events` via `SkillCandidateStore`). Store gains two query methods (contract §4.2): `getScorecardAggregates(slugs)` — ONE `GROUP BY skill_slug` query for the batched path — and `listGradedInvocations(slug, limit)` for the detail view. New `SkillScorecardService` composes aggregates + recent verdicts + (detail only) `SpecFindingsPort.getRecentFindings`.
- **RPC**: two new methods in the existing `skillSynthesis:` namespace (prefix already in `ALLOWED_METHOD_PREFIXES` at `vscode-core/src/messaging/rpc-handler.ts:46` — **no runtime-guard change needed**; still requires RpcMethodMap entries in `libs/shared/src/lib/types/rpc.types.ts` + Zod schemas in `skills-synthesis-rpc.schema.ts` + handler registration, and the existing `verifyRpcRegistration` check keeps both sides honest):
  - `skillSynthesis:getScorecards` `{ slugs: string[] }` → `{ scorecards: Record<string, AgentScorecard> }` — **batched** (one call for all visible clones; 200-clone Library render = 1 RPC + 1 GROUP-BY + ≤N tiny indexed verdict queries only for slugs with graded events). Per-card fetch rejected (200 RPC round-trips).
  - `skillSynthesis:getScorecardDetail` `{ slug, limit? }` → recent graded invocations + findings excerpt — **lazy**, fetched only on card expansion (R7, NFR perf).
- **DTO: new `AgentScorecard` / `ScorecardInvocationRow` in `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts`** (contract §4.3) rather than widening `CloneSummary`.
- **Findings excerpt (R5.2)** rides on the detail response only, truncated to the existing `MAX_FINDINGS_CHARS` (4000) discipline — `getRecentFindings` re-reads spec folders from disk and must not run 200× per Library render.
- Empty/partial states are well-typed (R5.4): a slug with no rows yields `{ totalInvocations: 0, graded: 0, … all-null averages }`, never an error. NULL-excluding averages come from SQL `AVG` semantics (R1.2).

**Rejected — extend `CloneSummary`**: `toCloneSummary` already does an async history read per row; folding metrics in would force scorecard computation on every `listClones` (including the Sessions/Recommended views that don't render scorecards) and couple two payload lifetimes. Cards merge `CloneSummary` + `AgentScorecard` by slug client-side.
**Rejected — new RPC namespace**: unnecessary; would trigger the dual-registration burden for zero gain.

### D6 — Enhancer + judge injection: bounded scorecard block, gates untouched

**Decision**:

- `SkillEnhancerService` gains an optional constructor dep on `SkillScorecardService` (same-lib, plain `@inject(SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE, { isOptional: true })`, mirroring the `SpecFindingsPort` optional pattern at lines 103-104). In `generateCandidate`, **only for `kind === 'agent'`** and only when the scorecard has data (`graded > 0` or any non-null metric), a size-bounded block (≤ 1,200 chars — well inside the 4,000-char findings discipline, R8.3) is appended:

```
Measured scorecard for this agent (from graded orchestration runs):
- Reconciled success rate: 71% (5/7 graded runs; 12 total invocations)
- Avg tokens/run: in=48.2k out=6.1k cacheRead=210k | avg cost $0.41 | avg duration 4m12s | avg tools 23
- Recent verdicts: FAILED(TASK_2026_155), COMPLETE(TASK_2026_154), ...
Optimize explicitly for: (1) fixing the recurring failure patterns in the graded findings above,
(2) reducing token consumption (trim redundant instructions, avoid re-reading files, prefer targeted reads),
while preserving the agent's role, triggers, and frontmatter routing description.
```

- No scorecard data → prompt byte-identical to today (R8.2). Eligibility gates (`MIN_INVOCATIONS_TO_ENHANCE`, `ENHANCE_COOLDOWN_MS`, judge gate) untouched (R8.4).
- **Judge (R9)**: `SkillJudgeService.judge` gains an optional trailing `context?: string` parameter appended to the verdict prompt as background; the five criteria, averaging, `minJudgeScore`, and fail-OPEN behavior are unchanged (verified `judge()` signature at line 49; measured-outcome criteria are E-group, deferred). Enhancer passes the same scorecard block it injected.

### D7 — R10 enabler: verified, no schema change

`skill_registry.last_enhanced_at` per `(kind, slug)` (written by `markEnhanced`, `skill-registry.store.ts:154-168`) plus `UserLayerMirrorService.listHistory(kind, slug)` per-`ts` snapshot entries give queryable enhancement timestamps per slug (R10.1 — gap check: NO gap, nothing to add). Raw per-invocation metrics rows (D1) are timestamped (`invoked_at`) and slug-keyed, so a future E-group task computes before/after aggregates with plain `WHERE skill_slug=? AND invoked_at < / >= lastEnhancedAt` — no schema change (R10.2). This decision is documentation + a store-level spec test asserting the query path, nothing more.

### D8 — Graceful degradation (R6.2/R6.3, NFR)

- **No `.ptah/specs`** (fresh Electron, CLI-only): harvester already no-ops (`readSpecs` catch → `[]`); scorecard aggregates still work from usage-only rows — `recentVerdicts: []`, `gradedSuccessRate: null`, findings `null`. Card renders usage-only section, no spec-verdict block, zero errors.
- **No token data** (provider reports no usage): all metric columns NULL → SQL `AVG` returns NULL → DTO nulls → UI renders explicit "no data yet" (never zeros, R6.3). Cost-less providers show tokens-only when tokens exist but pricing doesn't (open question 6: tokens and cost are independent nullable fields in the DTO; UI treats them independently).
- **No SQLite** is out of scope for this table (skill-synthesis already requires the shared connection; unchanged).

### D9 — Scorecard UI shape (R6/R7)

`SkillClonesStateService` gains `scorecards = signal<Record<string, AgentScorecard>>({})`, populated by one `getScorecards(slugs)` call after `refreshClones()` (agent-kind slugs only). Card (agent clones): reconciled success-rate badge, invocation count, avg tokens, avg cost, compact last-5 verdict dots (COMPLETE/FAILED). Expansion loads `getScorecardDetail` lazily: rows show task_id, verdict, tokens, cost, duration; **heuristically attributed rows (`verdict_source` starting `spec-window:`) get a distinct visual marker** (R7.2); empty detail explains how data accrues (R7.3). Findings excerpt rendered through `@ptah-extension/markdown` (DOMPurify chokepoint), never raw `[innerHTML]`. Signals + `inject()` + OnPush throughout (house rules, R6.4).

---

## 3. Batch Plan (dependency-ordered)

Executor legend: **BE** = backend-developer, **FE** = frontend-developer, **ST** = senior-tester. CLI-delegation notes use the restricted policy (ollama-cloud ptah-cli `pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9`; copilot SMALL only; NO codex).

### Batch 1 — Migration 0030 + store metrics plumbing (**BE**)

**Scope**: D1 + write-path halves of D2/D3/D4.
**Files**:

- CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0030_skill_event_metrics.ts` + `.spec.ts` (PRAGMA shape test mirroring 0027)
- MODIFY `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` (append `{ version: 30, … }`)
- MODIFY `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` — `recordSkillEvent` optional `metrics`/`taskId` params; `reconcileSubagentEvent` exact/fallback per D4; NEW `getScorecardAggregates(slugs)`, `listGradedInvocations(slug, limit)`
- MODIFY `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts` — pass-through fields
  **Tests**: store spec — metrics round-trip, NULL-metrics insert, NULL-excluding AVG, exact-vs-window reconcile, **R4.3 concurrent-task regression** (two overlapping windows, same slug, distinct task_ids), fallback never touches stamped rows, idempotent re-reconcile.
  **CLI delegation**: the 0030 `.spec.ts` shape test is a self-contained SMALL task (copilot or ptah-cli) — pattern-copy of 0027's spec.

### Batch 2 — SubagentMetricsExtractor + trigger wiring (**BE**, depends on 1)

**Scope**: D2 + D3 record-time capture.
**Files**:

- CREATE `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts` (+ `.spec.ts`) — transcript parse (tokens/cost/duration/tool_count) + exported pure `extractTaskIdFromPrompt`
- MODIFY `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` — `onSubagentStop` calls extractor before `recordInvocation`; failure → null metrics + warn, event still recorded
- MODIFY `libs/backend/skill-synthesis/src/lib/di/{tokens,register}.ts`
  **Tests**: fixture transcripts — full usage, usage-less (Copilot-style), malformed lines, >50MB throw path, multi-model cost, task-id extraction (specs-path anchored; multiple-mention ambiguity → null; single bare mention → id). Trigger spec: recording proceeds when extractor throws (R2.3).
  **CLI delegation**: fixture-JSONL authoring is a good SMALL ptah-cli task; keep wiring + assertions with BE.

### Batch 3 — Harvester exact-id reconciliation (**BE**, depends on 1)

**Scope**: D4 call-path.
**Files**: MODIFY `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts` (pass `spec.taskId` into each `reconcileSubagentEvent`), `spec-harvester.service.spec.ts`.
**Tests**: harvest stamps `spec:` vs `spec-window:` provenance correctly; marker idempotency preserved; degradation with no `.ptah/specs`.

### Batch 4 — Scorecard service + RPC surface (**BE**, depends on 1; parallel with 2/3)

**Scope**: D5.
**Files**:

- CREATE `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts` (+ spec)
- MODIFY `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts` (`AgentScorecard`, `ScorecardInvocationRow`, params/results), `libs/shared/src/lib/types/rpc.types.ts` (two RpcMethodMap entries + the `true` registry entries)
- MODIFY `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` + `skills-synthesis-rpc.schema.ts` (Zod: `slugs: z.array(z.string().min(1)).max(500)`, `limit: z.number().int().min(1).max(100).optional()`)
- MODIFY skill-synthesis `di/{tokens,register}.ts`, `index.ts` exports
  **Tests**: handler spec (Zod rejection, empty-slug list, no-data slug → typed empty scorecard, no raw `error.message` leakage); `verifyRpcRegistration` stays green. **Note**: `skillSynthesis:` prefix already allowlisted — no `rpc-handler.ts:46` edit; call this out in the task so nobody "helpfully" adds one.

### Batch 5 — Library scorecard UI (**FE**, depends on 4)

**Scope**: D9 (R6, R7).
**Files**:

- MODIFY `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts` (typed wrappers), `skill-clones-state.service.ts` (scorecards signal + lazy detail)
- MODIFY `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` (+ spec); optionally CREATE presentational `scorecard-badge.component.ts` / `scorecard-detail.component.ts` atoms
  **Tests**: no-data state ("no data yet", not zeros), spec-less runtime renders usage-only (R6.2), heuristic-attribution marker, findings through markdown lib, OnPush/signals compliance.
  **CLI delegation**: presentational atom scaffolding (badge + verdict dots with given inputs) is a SMALL copilot-suitable task; state-service wiring stays FE.

### Batch 6 — Metrics-aware enhancer + judge context (**BE**, depends on 4)

**Scope**: D6 + D7 (R8, R9, R10).
**Files**: MODIFY `skill-enhancer.service.ts` (+ spec), `skill-judge.service.ts` (+ spec), `di/tokens.ts`.
**Tests**: agent-kind prompt contains bounded scorecard block when data exists; byte-identical fallback when not (R8.2); ≤1,200-char bound (R8.3); gates untouched (R8.4); judge optional-context appended, criteria/fail-OPEN unchanged (R9); R10 query-path spec test (`last_enhanced_at` + metrics rows → pre/post window computable).

### Batch 7 — Cross-cutting QA (**ST**, depends on 2/3/5/6)

**Scope**: end-to-end verification sweep: concurrent-task attribution scenario against a real temp SQLite DB + fixture spec folders; degradation matrix (no specs / no usage / no pricing); Library render with 200 synthetic clones (batched RPC count = 1); `npm run typecheck:all`, `lint:all`, affected tests; confirm no new `node:fs` in ported service paths beyond the documented harvester exception.

---

## 4. Contract Sketches

### 4.1 Recording (skill-synthesis)

```typescript
// skill-invocation-recorder.ts
export interface SubagentRunMetrics {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly costUsd: number | null;
  readonly durationMs: number | null;
  readonly toolCount: number | null;
}

export interface RecordSkillEventInput {
  // …existing fields unchanged…
  readonly metrics?: SubagentRunMetrics | null; // subagent source only
  readonly taskId?: string | null; // TASK_YYYY_NNN or null
}

// subagent-metrics-extractor.ts
export interface ExtractedSubagentRun {
  readonly metrics: SubagentRunMetrics;
  readonly taskId: string | null;
}
export function extractTaskIdFromPrompt(text: string): string | null; // pure, exported
@injectable()
export class SubagentMetricsExtractor {
  async extract(transcriptPath: string): Promise<ExtractedSubagentRun>; // throws → caller nulls
}
```

### 4.2 Store (skill-candidate.store.ts)

```typescript
reconcileSubagentEvent(input: {
  slug: string;
  taskId: string;            // NEW — spec.taskId
  succeeded: boolean;
  isError: boolean;
  windowStart: number;       // fallback only
  windowEnd: number;
  verdictSource: string;     // base 'spec:TASK_X'; store writes 'spec-window:TASK_X' on fallback
  reconciledAt: number;
}): boolean;

getScorecardAggregates(slugs: readonly string[]): Map<string, ScorecardAggregate>;
// single GROUP BY over idx_skill_inv_events_slug; AVG() NULL-excluding by SQL semantics

listGradedInvocations(slug: string, limit: number): GradedInvocationRow[];
// WHERE skill_slug=? AND source='subagent' AND reconciled_at IS NOT NULL ORDER BY reconciled_at DESC
```

Aggregate SQL sketch (one statement, all slugs):

```sql
SELECT skill_slug,
       COUNT(*)                                                     AS total,
       SUM(CASE WHEN reconciled_at IS NOT NULL THEN 1 ELSE 0 END)   AS graded,
       SUM(CASE WHEN reconciled_at IS NOT NULL AND succeeded = 1
                THEN 1 ELSE 0 END)                                  AS graded_succeeded,
       AVG(input_tokens)  AS avg_input,  SUM(input_tokens)  AS sum_input,
       AVG(output_tokens) AS avg_output, SUM(output_tokens) AS sum_output,
       AVG(cache_read_tokens) AS avg_cache_read,
       AVG(cost_usd) AS avg_cost, AVG(duration_ms) AS avg_duration,
       AVG(tool_count) AS avg_tools
FROM skill_invocation_events
WHERE source = 'subagent' AND skill_slug IN (…)
GROUP BY skill_slug;
```

### 4.3 Shared RPC DTOs (`rpc/rpc-skill-clone.types.ts`)

```typescript
export interface AgentScorecard {
  slug: string;
  totalInvocations: number;
  gradedCount: number;
  gradedSuccessRate: number | null; // null when gradedCount === 0 (never fake 0%)
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  avgCacheReadTokens: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  avgCostUsd: number | null; // tokens and cost independently nullable (D8)
  avgDurationMs: number | null;
  avgToolCount: number | null;
  recentVerdicts: Array<{ taskId: string; succeeded: boolean; reconciledAt: number }>; // ≤5
}

export interface ScorecardInvocationRow {
  taskId: string | null;
  succeeded: boolean;
  exactAttribution: boolean; // verdict_source 'spec:' vs 'spec-window:'
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  invokedAt: number;
  reconciledAt: number;
}

export interface SkillSynthesisGetScorecardsParams {
  slugs: string[];
}
export interface SkillSynthesisGetScorecardsResult {
  scorecards: Record<string, AgentScorecard>;
}
export interface SkillSynthesisGetScorecardDetailParams {
  slug: string;
  limit?: number;
}
export interface SkillSynthesisGetScorecardDetailResult {
  slug: string;
  rows: ScorecardInvocationRow[];
  findingsExcerpt: string | null; // MAX_FINDINGS_CHARS-bounded, detail-only (D5)
}
```

RpcMethodMap additions (`rpc.types.ts`): `'skillSynthesis:getScorecards'` and `'skillSynthesis:getScorecardDetail'` entries + registry `true` flags. **No `ALLOWED_METHOD_PREFIXES` change** (prefix exists).

Zod (rpc-handlers `skills-synthesis-rpc.schema.ts`):

```typescript
export const getScorecardsParamsSchema = z.object({
  slugs: z.array(z.string().min(1).max(200)).max(500),
});
export const getScorecardDetailParamsSchema = z.object({
  slug: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(100).optional(),
});
```

### 4.4 Judge (skill-judge.service.ts)

```typescript
async judge(
  row: SkillCandidateRow,
  candidateBody: string,
  settings: SkillSynthesisSettings,
  context?: string,   // NEW, optional — appended as background; criteria unchanged
): Promise<PromotionDecision>;
```

---

## 5. Risks & Mitigations

| Risk                                                           | Mitigation                                                                                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript lacks usage / model (Copilot/Codex/ollama)          | All-null metrics + NULL-excluding aggregates (D1); UI "no data yet" (D8).                                                                             |
| Transcript missing or >50MB (`SdkError`) at SubagentStop       | Extractor failure is caught; event recorded metric-less + warn (R2.3, Batch 2 test).                                                                  |
| Prompt contains multiple TASK ids (e.g. `depends_on` mentions) | Specs-path-anchored regex first; ambiguity → NULL → window fallback (D3, deterministic + tested).                                                     |
| Window fallback steals a stamped concurrent event              | Fallback restricted to `task_id IS NULL` rows (D4) + R4.3 regression test.                                                                            |
| Library perf with 200 clones                                   | One batched RPC + one GROUP BY; detail + findings lazy (D5); ST perf check (Batch 7).                                                                 |
| Enhancer prompt bloat                                          | ≤1,200-char scorecard block, findings still 4,000-cap (D6, R8.3, tested).                                                                             |
| Silent RPC crash from missed registration                      | No new prefix needed; `verifyRpcRegistration` assertion in Batch 4 tests.                                                                             |
| Cost accuracy across providers                                 | `cost_usd` nullable + computed only from priceable models; tokens shown independently (open question 6 resolved: tokens-only display when cost null). |

## 6. Non-Goals (explicit)

- R-group E beyond R10: before/after snapshots, delta computation, measured-outcome judge criteria, effect-reporting UI.
- Orchestration-skill-kind scorecard UI (aggregates work for free; no skill-specific UI committed).
- Backfilling metrics/task_id for historical events or historical specs.
- CLI-agent (ptah-cli junior helper) telemetry — only `Task`-tool subagents keyed by `subagent_type`.
- Migrating `spec-harvester.service.ts` off `node:fs/promises` (documented deferral, D4).
- Gating/judge-criteria/promotion/dedup/curator policy changes; license gating changes.
- Changes to `agent-sdk`, `subagent-cost.utils.ts`, or the execution-tree types (all read-only references).

## 7. Team-Leader Handoff

- **Executors**: Batches 1–4, 6 → backend-developer; Batch 5 → frontend-developer; Batch 7 → senior-tester. CLI-delegable SMALL slices flagged inline (Batch 1 spec test, Batch 2 fixtures, Batch 5 presentational atoms) — ollama-cloud ptah-cli primary, copilot small-only, codex forbidden.
- **Complexity**: L overall — Batch 1 ~3h, Batch 2 ~3h, Batch 3 ~1.5h, Batch 4 ~3h, Batch 5 ~4h, Batch 6 ~2h, Batch 7 ~2h.
- **Critical verification points for developers**: (1) all imports named here exist — `JsonlReaderService` (`SDK_TOKENS.SDK_JSONL_READER`), `findModelPricing`/`calculateMessageCost` (shared pricing.utils), `SPEC_FINDINGS_TOKEN` optional-inject pattern, `parseTaskFile`; (2) migration is APPENDED, never edits 0021/0027/0029; (3) no `agent-sdk → skill-synthesis` import may appear; (4) no `ALLOWED_METHOD_PREFIXES` edit; (5) `catch (error: unknown)` + narrowing everywhere; (6) Angular work is signals + OnPush + markdown-lib rendering only.
