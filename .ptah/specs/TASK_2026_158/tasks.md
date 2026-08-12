---
task: TASK_2026_158
title: Task specs as the evaluation substrate for subagents — metrics, attribution, scorecards, enhancer
type: FEATURE
total_batches: 7
status: done
depends_on: [TASK_2026_157]
---

# Development Tasks — TASK_2026_158

Decomposed from `implementation-plan.md` (D1–D9 locked; Checkpoints 1 & 2 APPROVED). Batches are dependency-ordered: schema/store first, capture/attribution/aggregation next, UI + enhancer after their backend deps, cross-cutting QA last. Executors are advisory; the orchestrator spawns.

**CLI delegation policy (restricted)**: ptah-cli "ollama cloud" (`pc-d8f4e156-fa15-4dc6-92ba-8e088e7e9ae9`) is the primary junior helper; copilot for SMALL tasks only; codex FORBIDDEN. Max 3 concurrent. The spawning sub-agent/orchestrator owns the quality of any CLI output. `**CLI Suitable**` flags below mark file-disjoint boilerplate slices — the orchestrator decides at spawn time.

**Quality bar (every batch)**: `npm run typecheck:all` + `lint:all` + affected Jest suites green; Zod at every new RPC boundary; `catch (error: unknown)` + `instanceof Error` narrowing; no raw `error.message` over RPC; Angular = signals + `inject()` + OnPush; migrations forward-only appended to the `MIGRATIONS` tuple (never edit 0021/0027/0029); no `agent-sdk → skill-synthesis` import; no `ALLOWED_METHOD_PREFIXES` edit (`skillSynthesis:` already allowlisted).

---

## Plan Validation Summary

**Validation Status**: PASSED

The architect verified every referenced symbol/location by direct file read on 2026-07-15 and pre-resolved the six open questions into D1–D9. No blockers. Assumptions carried forward as developer verification points (not new risks).

### Assumptions Verified (by architect, re-confirm during implementation)

- Next free migration slot is **0030** (max = 0029 at `migrations/index.ts:243-247`). Verify before creating the file.
- `onSubagentStop` (`skill-trigger.service.ts:261-284`) is the ONLY reliable subagent seam; the `Task` PostToolUse branch (356-371) never fires for agent runs (in-code comment 262-270). `SubagentStopPayload` carries `transcriptPath` but **no usage data**.
- `JsonlReaderService` (`SDK_TOKENS.SDK_JSONL_READER`) is already a constructor dep of the trigger service and an existing acyclic `skill-synthesis → agent-sdk` edge.
- `findModelPricing` / `calculateMessageCost` (`libs/shared/.../pricing.utils.ts`) are pure and shared; `subagent-cost.utils.ts` stays read-only/pure.
- `skill-synthesis → task-specs` edge exists (via `parseTaskFile`); `spec.taskId` is already in `harvest()` scope at `spec-harvester.service.ts:100-107`.
- `skillSynthesis:` prefix already in `ALLOWED_METHOD_PREFIXES` — new methods need RpcMethodMap entries + Zod schemas + handler registration ONLY.
- R10 (D7): enhancement timestamps already queryable (`skill_registry.last_enhanced_at` + `UserLayerMirrorService.listHistory`) — **no schema gap**, spec-test-only.

### Risks Identified (mitigations already in the plan)

| Risk                                                          | Severity | Mitigation                                                                                              | Task          |
| ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- | ------------- |
| Metrics unavailable across providers (Copilot/Codex/ollama)   | MED      | Nullable columns + NULL-excluding SQL `AVG`; UI "no data yet"                                           | 1.1, 4.1, 5.x |
| Concurrent same-slug task cross-attribution (the bug B fixes) | HIGH     | Exact `(slug, task_id)` reconcile + fallback restricted to `task_id IS NULL`; dedicated regression test | 1.3, 3.1      |
| Transcript missing / >50MB `SdkError` at SubagentStop         | MED      | Extractor failure caught → null metrics + `logger.warn`; event still recorded                           | 2.1, 2.2      |
| Prompt contains multiple TASK ids (`depends_on` mentions)     | MED      | Specs-path-anchored regex first; ambiguity → null → window fallback                                     | 2.3           |
| Library perf @200 clones                                      | MED      | One batched RPC + one `GROUP BY`; detail + findings lazy                                                | 4.1, 4.2, 7   |
| Enhancer prompt bloat                                         | LOW      | ≤1,200-char scorecard block, findings 4,000-cap                                                         | 6.1           |

### Edge Cases to Handle

- [ ] Provider reports no usage → all-null metrics row still inserted, excluded from averages (not zero) → Task 1.2, 4.1, 5.1
- [ ] Runtime without `.ptah/specs` (fresh Electron / CLI) → harvester no-op, scorecard = usage-only, no spec-verdict section, zero errors → Task 3.2, 5.2
- [ ] Legacy rows without `task_id` → window fallback with `spec-window:` provenance → Task 1.3, 3.1
- [ ] No-data slug scorecard → typed empty `{ totalInvocations: 0, … null averages }`, never an error → Task 4.1, 4.2
- [ ] Cost-less-but-token-bearing provider → tokens shown, cost independently null → Task 4.1, 5.1

---

## Batch 1: Migration 0030 + store metrics plumbing

**Status**: COMPLETE
**Recommended Executor**: backend-developer
**Execution Mode**: sequential
**Dependencies**: none (foundation; blocks Batches 2, 3, 4)
**Rationale**: Schema + store are the shared substrate every other backend batch reads/writes; tightly coupled edits to one store file plus a migration that must land atomically. Sequential single-owner keeps the SQL contract coherent.
**CLI Suitable**: yes (Task 1.4 only — the 0030 `.spec.ts` PRAGMA shape test is a self-contained pattern-copy of 0027; ptah-cli primary, copilot acceptable). Keep 1.1–1.3 with backend-developer.
**Scope**: D1 + the write-path halves of D2/D3/D4.

### Task 1.1: Create migration 0030 (widen `skill_invocation_events`)

- **File (CREATE)**: `libs/backend/persistence-sqlite/src/lib/migrations/0030_skill_event_metrics.ts`
- **File (MODIFY)**: `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` — append `{ version: 30, … }` to the `MIGRATIONS` tuple; do NOT edit 0021/0027/0029.
- **Implement**: 8 nullable `ALTER TABLE skill_invocation_events ADD COLUMN` statements (`input_tokens INTEGER`, `output_tokens INTEGER`, `cache_read_tokens INTEGER`, `cache_creation_tokens INTEGER`, `cost_usd REAL`, `duration_ms INTEGER`, `tool_count INTEGER`, `task_id TEXT`) + `CREATE INDEX IF NOT EXISTS idx_skill_inv_events_task ON skill_invocation_events(skill_slug, task_id)`. Static SQL only, no `${}` interpolation.
- **Acceptance**: Forward-only, appended (R1.3). Pre-existing rows remain valid with NULL metrics — no backfill (R1.4). Verify 0030 is the true next free slot before writing.
- **Tests**: covered by Task 1.4.

### Task 1.2: Extend `recordSkillEvent` write path with optional metrics + taskId

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (`recordSkillEvent`, ~407-431)
- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-invocation-recorder.ts` (~29-57) — pass-through of new fields; dedup key (slug|session|2s-bucket) UNCHANGED.
- **Implement**: `RecordSkillEventInput` gains `metrics?: SubagentRunMetrics | null` and `taskId?: string | null` (contract §4.1). INSERT writes the 8 new columns (NULL when absent). Add `SubagentRunMetrics` interface (readonly, all `number | null`) per §4.1.
- **Acceptance**: Metrics/taskId optional (subagent source only); NULL insert when absent; existing invocation counting + eligibility signal (`getInvocationStats(slug).total`) unaffected (R2.3).
- **Tests**: metrics round-trip; NULL-metrics insert; pre-existing insert path unchanged.

### Task 1.3: Rework `reconcileSubagentEvent` — exact task_id first, window fallback

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts` (`reconcileSubagentEvent`, ~443-481)
- **Implement** (contract §4.2, D4): input gains `taskId: string`. Selection: (1) **Exact pass** — newest un-reconciled `WHERE skill_slug=? AND source='subagent' AND task_id=? AND reconciled_at IS NULL` → `verdict_source='spec:TASK_X'` (ignores window, uses `idx_skill_inv_events_task`). (2) **Fallback** only when exact matched nothing — today's window query **restricted to `task_id IS NULL` rows** → `verdict_source='spec-window:TASK_X'`. One batch verdict still flips exactly one row (cardinality parity).
- **Acceptance**: R4.1 exact by (slug, task_id) ignoring window; R4.2 fallback + provenance disambiguation; R4.4 idempotent (`reconciled_at IS NULL` guard preserved); NFR — no full-table scan (indexed).
- **Tests**: covered by Task 1.4 (incl. R4.3 regression).

### Task 1.4: Store + migration spec tests

- **File (CREATE)**: `libs/backend/persistence-sqlite/src/lib/migrations/0030_skill_event_metrics.spec.ts` — `PRAGMA table_info` shape assertions mirroring `0027_*.spec.ts` (R1.3).
- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.spec.ts` (or add a sibling spec).
- **Add tests**: metrics round-trip; NULL-metrics insert; NULL-excluding `AVG` (average ignores nulls, not treated as 0 — R1.2); exact-vs-window reconcile; **R4.3 concurrent-task regression** — two specs with overlapping mtime windows, same executor slug, distinct `task_id`-stamped events → each row gets its own task's verdict; fallback never touches `task_id`-stamped rows; idempotent re-reconcile.
- **Acceptance**: affected Jest suites green against a real temp SQLite DB.

**Batch 1 Verification**: files exist; migration appended (not edited-in-place); typecheck + lint + persistence-sqlite & skill-synthesis affected suites green; concurrent-task regression proves no cross-attribution.

---

## Batch 2: SubagentMetricsExtractor + trigger wiring

**Status**: COMPLETE
**Recommended Executor**: backend-developer
**Execution Mode**: sequential
**Dependencies**: Batch 1 (needs `metrics`/`taskId` on the record path). Parallel-eligible with Batch 3 and Batch 4 once Batch 1 is COMPLETE.
**Rationale**: New service + a wiring edit into the live `onSubagentStop` fire-and-forget path; transcript-parse logic and its failure semantics are one coherent unit best owned by a single backend dev.
**CLI Suitable**: yes (fixture-JSONL authoring for the spec — full-usage, usage-less/Copilot-style, malformed, multi-model, task-id variants — is a SMALL ptah-cli task). Keep the extractor logic + trigger wiring + assertions with backend-developer.
**Scope**: D2 + D3 record-time capture.

### Task 2.1: Create `SubagentMetricsExtractor` (transcript → metrics)

- **File (CREATE)**: `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts` (+ `.spec.ts`)
- **Implement** (§4.1, D2): `@injectable() class SubagentMetricsExtractor { async extract(transcriptPath): Promise<ExtractedSubagentRun> }` using the already-injected `JsonlReaderService` (`SDK_TOKENS.SDK_JSONL_READER`). Compute: **tokens** = sum of `message.usage.{input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens}` over assistant messages (AgentCostBreakdown semantics); **cost_usd** per assistant message via shared `findModelPricing(message.model)` + token math, `null` when no priceable model; **duration_ms** = last − first transcript timestamp; **tool_count** = count of `content` blocks with `type==='tool_use'` (matches `countToolCalls`, `subagent-cost.utils.ts:121-133`); **task_id** via Task 2.3.
- **Acceptance**: R2.2 shape consistent with `getAgentCostBreakdown`; shared utils untouched/pure; `extract` throws on unrecoverable I/O (caller nulls — see 2.2). `catch (error: unknown)` narrowing.
- **Tests**: fixtures — full usage; usage-less (Copilot-style → all-null metrics); malformed lines; >50MB `SdkError` throw path; multi-model cost aggregation.

### Task 2.2: Wire extractor into `onSubagentStop` (failure-safe)

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts` (`onSubagentStop`, ~261-284)
- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/di/tokens.ts` + `di/register.ts` — register `SubagentMetricsExtractor`.
- **Implement**: inside the existing `void this.recordInvocation(...)` async path (already off the hot path — R2.4), call `extract(payload.transcriptPath)` inside `try/catch`; on ANY failure → metrics all-null + `logger.warn`, then `recordInvocation` proceeds exactly as today. Pass `metrics` + `taskId` through to `recordSkillEvent`.
- **Acceptance**: R2.3 — recording proceeds when extractor throws; R2.4 — no synchronous streaming work added. Do NOT enrich the PostToolUse `Task` branch (it never fires for agents).
- **Tests**: trigger spec — recording still occurs (invocation counted, event written metric-less) when extractor throws.

### Task 2.3: Pure `extractTaskIdFromPrompt`

- **File (MODIFY/CO-LOCATE)**: `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts` — export pure `extractTaskIdFromPrompt(text: string): string | null`.
- **Implement** (D3): applied to the first `role:'user'` message. Rule: (1) first match of `/[\\/.]?ptah[\\/]specs[\\/](TASK_\d{4}_\d{3})\b/i` (specs-path-anchored); (2) else if EXACTLY ONE distinct `\bTASK_\d{4}_\d{3}\b` appears → use it; (3) else `null`. No task context → `null` (R3.2, behavior identical to today).
- **Acceptance**: R3.1/R3.2; hexagonal — no `agent-sdk → skill-synthesis` import, no frontend, no session registry (R3.3).
- **Tests**: specs-path anchored wins over incidental `depends_on` mention; multiple distinct mentions → null; single bare mention → id; no mention → null.

**Batch 2 Verification**: extractor + wiring land; typecheck/lint; skill-synthesis affected suites green; failure-path test proves metrics capture never breaks invocation counting.

---

## Batch 3: Harvester exact-id reconciliation

**Status**: COMPLETE
**Recommended Executor**: backend-developer
**Execution Mode**: sequential
**Dependencies**: Batch 1 (needs the reworked `reconcileSubagentEvent` signature). Parallel-eligible with Batch 2 and Batch 4.
**Rationale**: A small, focused call-path change (pass `spec.taskId` down) plus its harvest-level regression tests; one file + its spec.
**CLI Suitable**: no (touches reconciliation provenance semantics — keep with backend-developer).
**Scope**: D4 call-path.

### Task 3.1: Pass `spec.taskId` into each reconcile call

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts` (~89-126; `spec.taskId` already in scope at 100-107)
- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts`
- **Implement**: thread `spec.taskId` into every `reconcileSubagentEvent({ …, taskId })` call so the store's exact-pass fires; `verdict_source` base `spec:TASK_X`, store writes `spec-window:TASK_X` on fallback (D4). Idempotency via `.harvested.json` marker + `reconciled_at` guard preserved (R4.4).
- **Acceptance**: R4.1–R4.4; harvest remains O(specs × batches), exact pass is indexed (NFR).
- **Tests**: harvest stamps `spec:` vs `spec-window:` provenance correctly; marker idempotency across repeated harvests.

### Task 3.2: Degradation — no `.ptah/specs`

- **File (MODIFY)**: `spec-harvester.service.spec.ts` (extend)
- **Implement/verify**: existing `readSpecs` catch → `[]` no-op path unchanged; confirm no new failure introduced by the taskId threading when there are no specs.
- **Acceptance**: D8 — runtime without `.ptah/specs` reconciles nothing, zero errors.
- **Note (deferred, do NOT do)**: migrating `spec-harvester.service.ts` off `node:fs/promises` onto `IFileSystemProvider` is an explicit non-goal (D4). Do not expand `node:fs` usage; introduce no new `node:fs` call sites.

**Batch 3 Verification**: harvester threads taskId; provenance + idempotency + degradation tests green; typecheck/lint.

---

## Batch 4: Scorecard service + RPC surface

**Status**: COMPLETE
**Recommended Executor**: backend-developer
**Execution Mode**: sequential
**Dependencies**: Batch 1 (aggregate/detail store queries). Parallel-eligible with Batches 2 and 3. Blocks Batches 5 and 6.
**Rationale**: New service composing SQL aggregates + verdicts + findings, plus dual-registration RPC (shared types + Zod + handler) — a coherent vertical slice best kept single-owner to keep the DTO/schema/handler triad in sync.
**CLI Suitable**: no (RPC dual-registration + Zod correctness are error-prone; keep with backend-developer).
**Scope**: D5.

### Task 4.1: Store scorecard queries

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts`
- **Implement** (§4.2): `getScorecardAggregates(slugs)` — ONE `GROUP BY skill_slug` over `WHERE source='subagent' AND skill_slug IN (…)` returning total, graded, graded_succeeded, and NULL-excluding `AVG`/`SUM` of token classes, cost, duration, tool_count (SQL sketch §4.2). `listGradedInvocations(slug, limit)` — `WHERE skill_slug=? AND source='subagent' AND reconciled_at IS NOT NULL ORDER BY reconciled_at DESC LIMIT ?`.
- **Acceptance**: R5.1/R5.4; NULL-excluding averages (R1.2); no-data slug → typed zero/null aggregate, never error.
- **Tests**: aggregate over mixed null/non-null rows; empty-slug list; no-data slug → typed empty.

### Task 4.2: `SkillScorecardService`

- **File (CREATE)**: `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts` (+ spec)
- **File (MODIFY)**: skill-synthesis `di/tokens.ts` (`SKILL_SCORECARD_SERVICE`), `di/register.ts`, `index.ts` exports.
- **Implement** (D5): compose aggregates + ≤5 recent verdicts into `AgentScorecard` for `getScorecards`; compose graded-invocation rows + (detail-only) truncated `SpecFindingsPort.getRecentFindings` excerpt (`MAX_FINDINGS_CHARS` = 4000) for `getScorecardDetail`. Findings re-read disk — detail-only, never 200× per Library render.
- **Acceptance**: R5.1/R5.2/R5.4; graceful empty states (D8); `catch (error: unknown)`.
- **Tests**: scorecard assembly; findings truncation; findings absent → `null`; no-data → typed empty.

### Task 4.3: RPC dual-registration + Zod

- **File (MODIFY)**: `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts` — `AgentScorecard`, `ScorecardInvocationRow`, and the four params/result interfaces (§4.3).
- **File (MODIFY)**: `libs/shared/src/lib/types/rpc.types.ts` — RpcMethodMap entries `skillSynthesis:getScorecards` + `skillSynthesis:getScorecardDetail` and the registry `true` flags.
- **File (MODIFY)**: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts` + `skills-synthesis-rpc.schema.ts` — register handlers; Zod: `getScorecardsParamsSchema` (`slugs: z.array(z.string().min(1).max(200)).max(500)`), `getScorecardDetailParamsSchema` (`slug: z.string().min(1).max(200)`, `limit: z.number().int().min(1).max(100).optional()`).
- **Acceptance**: R5.3 — reuse `skillSynthesis:` namespace; **do NOT edit `ALLOWED_METHOD_PREFIXES`** (prefix already allowlisted); `verifyRpcRegistration` stays green; no raw `error.message` over RPC.
- **Tests**: handler spec — Zod rejection (bad slugs, oversized list, bad limit); empty-slug list; no-data slug → typed empty scorecard; error-narrowing (no `error.message` leakage); `verifyRpcRegistration` green.

**Batch 4 Verification**: DTOs + RpcMethodMap + Zod + handlers + service land coherently; typecheck/lint; rpc-handlers & skill-synthesis affected suites green; no `rpc-handler.ts:46` edit.

---

## Batch 5: Library scorecard UI

**Status**: COMPLETE
**Recommended Executor**: frontend-developer
**Execution Mode**: sequential
**Dependencies**: Batch 4 (RPC methods + DTOs).
**Rationale**: Angular signals/OnPush state wiring plus card rendering + lazy detail — frontend-only, must consume the shared DTOs from Batch 4.
**CLI Suitable**: yes (Task 5.3 — presentational badge/verdict-dot atoms with fully specified inputs are SMALL copilot-suitable scaffolding). Keep state-service wiring + markdown routing with frontend-developer.
**Scope**: D9 (R6, R7).

### Task 5.1: RPC wrappers + scorecards signal

- **File (MODIFY)**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.ts` — typed `getScorecards(slugs)` / `getScorecardDetail(slug, limit?)` wrappers.
- **File (MODIFY)**: `libs/frontend/skill-synthesis-ui/src/lib/services/skill-clones-state.service.ts` — `scorecards = signal<Record<string, AgentScorecard>>({})` populated by one `getScorecards(slugs)` after `refreshClones()` (agent-kind slugs only); lazy `getScorecardDetail` on card expansion.
- **Acceptance**: R6/R7 data flow; one batched call for all visible clones; no backend lib imports (shared DTOs only).
- **Tests**: state service — scorecards populated from one call; detail loaded lazily; no-data slug handled.

### Task 5.2: Clone card scorecard rendering + degradation

- **File (MODIFY)**: `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts` (+ spec)
- **Implement** (D9): agent clone cards show reconciled success-rate badge, invocation count, avg tokens, avg cost, compact last-5 verdict dots (COMPLETE/FAILED). Expansion detail: rows with task_id, verdict, tokens, cost, duration; heuristically-attributed rows (`verdict_source` starting `spec-window:` → `exactAttribution:false`) get a distinct visual marker (R7.2); empty detail explains how data accrues (R7.3). Findings excerpt through `@ptah-extension/markdown` (DOMPurify), never raw `[innerHTML]`.
- **Acceptance**: R6.1–R6.4, R7.1–R7.3; NULL/absent metrics → explicit "no data yet" (never zeros, R6.3); spec-less runtime → usage-only, no spec-verdict section, zero errors, in BOTH VS Code + Electron (R6.2); signals + `inject()` + OnPush (R6.4).
- **Tests**: "no data yet" state; spec-less runtime usage-only; heuristic-attribution marker; findings routed through markdown; OnPush/signals compliance.

### Task 5.3: Presentational atoms (optional)

- **File (CREATE, optional)**: `scorecard-badge.component.ts` / `scorecard-detail.component.ts` under `skill-synthesis-ui/src/lib/components/clones/`.
- **Implement**: pure presentational (success-rate badge, verdict dots, detail rows) with `input()` signals, OnPush, no service coupling.
- **Acceptance**: no backend imports; house Angular rules.
- **Tests**: render with given inputs; empty/no-data inputs.

**Batch 5 Verification**: cards render scorecards; degradation matrix (no data / spec-less) green in VS Code + Electron; markdown chokepoint used; typecheck/lint; skill-synthesis-ui affected suites green.

---

## Batch 6: Metrics-aware enhancer + judge context

**Status**: COMPLETE
**Recommended Executor**: backend-developer
**Execution Mode**: sequential
**Dependencies**: Batch 4 (`SkillScorecardService`).
**Rationale**: Prompt-content change gated by `kind==='agent'` + optional scorecard dep, plus a bounded judge-context param — small, precise, gate-preserving; single backend owner.
**CLI Suitable**: no (prompt bounds + gate-preservation are correctness-sensitive).
**Scope**: D6 + D7 (R8, R9, R10).

### Task 6.1: Inject bounded scorecard block into agent-kind `generateCandidate`

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts` (+ spec) (`generateCandidate`, ~346-433)
- **File (MODIFY)**: skill-synthesis `di/tokens.ts` — optional inject of `SkillScorecardService` (mirroring `SPEC_FINDINGS_TOKEN` optional pattern, ~103-104).
- **Implement** (D6): only for `kind==='agent'` AND when scorecard has data (`graded > 0` or any non-null metric), append a ≤1,200-char block (success rate, avg/total token profile, avg cost/duration/tools, recent verdicts, explicit "reduce tokens + fix recurring failure patterns while preserving role/triggers/frontmatter routing"). No scorecard data → prompt byte-identical to today (R8.2).
- **Acceptance**: R8.1; R8.2 fallback identical; R8.3 ≤1,200 char bound (findings still 4,000-cap); R8.4 gates (`MIN_INVOCATIONS_TO_ENHANCE`, `ENHANCE_COOLDOWN_MS`, judge) UNCHANGED.
- **Tests**: agent-kind prompt contains bounded block when data exists; byte-identical fallback when not; ≤1,200-char assertion; gates untouched.

### Task 6.2: Judge optional context (bounded)

- **File (MODIFY)**: `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts` (+ spec) (`judge`, ~49)
- **Implement** (§4.4, D6): add optional trailing `context?: string` appended to the verdict prompt as background; enhancer passes the same scorecard block. Five criteria, averaging, `minJudgeScore`, and fail-OPEN behavior UNCHANGED (R9).
- **Acceptance**: R9.1/R9.2; measured-outcome criteria remain deferred (E-group).
- **Tests**: optional context appended; criteria/averaging/fail-OPEN unchanged; judge LLM failure still fails OPEN.

### Task 6.3: R10 enabler spec test (no schema change)

- **File (MODIFY/CREATE)**: store-level spec asserting the query path.
- **Implement** (D7): verify `skill_registry.last_enhanced_at` (`markEnhanced`) + `UserLayerMirrorService.listHistory(kind, slug)` give per-slug enhancement timestamps, and that raw metrics rows (timestamped `invoked_at`, slug-keyed) support `WHERE skill_slug=? AND invoked_at </>= lastEnhancedAt`. **No schema change** — confirm no gap (R10.1) and pre/post computability (R10.2).
- **Acceptance**: spec proves before/after windows are computable from existing columns; nothing added if no gap (there is none).
- **Tests**: query-path spec test.

**Batch 6 Verification**: enhancer + judge changes land; bound + fallback + gates-untouched + R9 + R10 tests green; typecheck/lint; skill-synthesis affected suites green.

---

## Batch 7: Cross-cutting QA sweep

**Status**: COMPLETE
**Recommended Executor**: senior-tester
**Execution Mode**: sequential
**Dependencies**: Batches 2, 3, 5, 6 (all feature work).
**Rationale**: End-to-end verification across the joined signal path — integration-level scenarios and workspace-wide gates that no single feature batch owns.
**CLI Suitable**: no.
**Scope**: end-to-end verification.

### Task 7.1: Integration + degradation matrix

- **Verify**: concurrent-task attribution against a real temp SQLite DB + fixture spec folders (two overlapping-window specs, same slug, distinct task_ids → no cross-attribution). Degradation matrix: no `.ptah/specs`; no usage/metrics; no pricing (tokens-only). Library render with 200 synthetic clones → batched RPC count == 1 (perf, NFR).
- **Acceptance**: all R-group ACs observably satisfied end-to-end; degradation = zero errors, "no data yet" (not zeros).

### Task 7.2: Workspace gates + architecture compliance

- **Run**: `npm run typecheck:all`, `npm run lint:all`, affected Jest suites.
- **Verify**: no new `node:fs` in ported service paths beyond the documented harvester exception; no `agent-sdk → skill-synthesis` import; no `ALLOWED_METHOD_PREFIXES` edit; `subagent-cost.utils.ts` / execution-tree types untouched; Zod at every new RPC boundary; markdown chokepoint used in UI.
- **Acceptance**: all gates green; architecture invariants confirmed.

**Batch 7 Verification**: full sweep green; QA sign-off for completion.

---

## Executor Summary

| Batch | Title                              | Executor           | Mode       | Depends on | CLI slice     |
| ----- | ---------------------------------- | ------------------ | ---------- | ---------- | ------------- |
| 1     | Migration 0030 + store plumbing    | backend-developer  | sequential | —          | 1.4 spec test |
| 2     | SubagentMetricsExtractor + trigger | backend-developer  | sequential | 1          | fixture JSONL |
| 3     | Harvester exact-id reconcile       | backend-developer  | sequential | 1          | —             |
| 4     | Scorecard service + RPC            | backend-developer  | sequential | 1          | —             |
| 5     | Library scorecard UI               | frontend-developer | sequential | 4          | 5.3 atoms     |
| 6     | Metrics-aware enhancer + judge     | backend-developer  | sequential | 4          | —             |
| 7     | Cross-cutting QA                   | senior-tester      | sequential | 2,3,5,6    | —             |

**Concurrency note for the orchestrator**: after Batch 1 is COMPLETE, Batches 2, 3, and 4 are file-disjoint and may run concurrently (respecting the max-3 CLI cap). Batch 5 waits on 4; Batch 6 waits on 4; Batch 7 waits on 2/3/5/6.
