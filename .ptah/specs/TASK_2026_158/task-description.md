# Requirements Document — TASK_2026_158

**Title**: Task specs as the evaluation substrate for subagents — metrics persistence, exact attribution, Library scorecards, and metrics-aware enhancement
**Type**: FEATURE (Full workflow) | **Priority**: P1-High | **Size**: L
**Depends on**: TASK_2026_157 (task-specs lib, frontmatter contract, SQLite task index migration 0029)

---

## Introduction

Ptah already produces three high-quality evaluation signals about its own subagents, but they have never been joined:

1. **Graded quality** — `.ptah/specs/TASK_*` folders: per-batch executor verdicts in `tasks.md`, review findings in `code-logic-review.md`/`test-report.md`, task-level `status`/`executor` in `task.md` frontmatter, and the SQLite derived task index (migration 0029, `@ptah-extension/task-specs`).
2. **Usage + success rate** — `skill_invocation_events` (migration 0021, extended by 0027 with `reconciled_at`/`verdict_source`), slug-keyed, `source:'subagent'` events recorded via `SkillTriggerService.onPostToolUse` → `SkillInvocationRecorder`, reconciled by `SpecHarvesterService`. **No token/cost/duration columns exist.**
3. **Tokens/cost/duration per agent** — computed transiently by `getAgentCostBreakdown` (`libs/shared/src/lib/utils/subagent-cost.utils.ts`) from `streamingState` for display only. **Never persisted per subagent slug.**

Because these signals are disjoint, the auto-enhancer (`SkillEnhancerService.generateCandidate`) optimizes agent definitions with generic best practices and text findings only — it cannot target the two things the user actually cares about: **success rate** and **token consumption**. And the Library (Clones) tab shows eligibility counters but no evidence of how each agent actually performs.

**Business value**: This task closes the loop that makes Ptah's "skills that improve themselves" pitch real for **agents**: every orchestrated task becomes a graded benchmark run, every subagent gets an individual scorecard, and enhancement becomes a measurable optimization instead of a stylistic rewrite. This is a differentiating premium capability for the Thoth Skills tab in both VS Code and Electron.

### Current attribution weakness (root problem for R-group B)

`SpecHarvesterService.harvest()` reconciles optimistic `succeeded:true` subagent events against graded batch verdicts by **slug + time-window heuristic** (`windowStart`/`windowEnd` on `reconcileSubagentEvent`). Two concurrent tasks using the same agent slug (a real usage pattern — the user runs concurrent agents on one checkout) can cross-attribute verdicts. TASK_2026_157's task index and `executor` frontmatter now make an exact `task_id` join possible.

---

## Scope Verdict (MUST / SHOULD / DEFER)

| Group | Scope                                                            | Verdict                 | Justification                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | ---------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Persist per-invocation metrics (tokens/cost/duration/tool count) | **MUST**                | Foundation for C and D; without persisted metrics nothing else in this task is possible.                                                                                                                                                                                                                                                                                                                                                                                                    |
| B     | Exact `task_id` attribution replacing slug+time-window heuristic | **MUST**                | Data-integrity prerequisite: scorecards and enhancer prompts built on cross-attributed verdicts would be misleading. Window heuristic remains as documented fallback for events with no task context.                                                                                                                                                                                                                                                                                       |
| C     | Per-subagent scorecard in the Library tab                        | **MUST**                | The user-visible deliverable ("evaluate each subagent individually").                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D     | Metrics-aware enhancer prompt for agents                         | **MUST**                | The explicit optimization ask ("optimize its definition for performance, success rate, and token consumption"). Small, prompt-level change once A–C exist.                                                                                                                                                                                                                                                                                                                                  |
| E     | Before/after outcome snapshots + measured-outcome judge criteria | **DEFER (recommended)** | Requires clone-history schema additions plus a multi-week observation window before any snapshot comparison is meaningful — no data exists yet to compare. Deferring keeps this task shippable and testable. This task MUST, however, persist enough raw data (A + B, timestamped, slug-keyed) that a follow-up task can compute before/after deltas retroactively from the enhancement timestamp already stored on clone history. One cheap hook is included (R14) so the door stays open. |

---

## Requirements

### R-group A — Persist per-invocation metrics

#### Requirement R1: Metrics columns on subagent invocation events

**User Story:** As the skill-synthesis subsystem, I want each `source:'subagent'` invocation event to carry input/output/cache tokens, cost (USD), duration (ms), and tool-call count, so that per-agent efficiency can be aggregated without re-parsing session transcripts.

**Acceptance Criteria**

1. WHEN a subagent run completes THEN the recorded `skill_invocation_events` row (or sibling metrics row — architect's call, see Open Questions) SHALL contain `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`, `duration_ms`, and `tool_count`, all nullable.
2. WHEN metrics are unavailable for a run (provider reports no usage, e.g. some Copilot/Codex/ollama paths) THEN the event SHALL still be recorded with NULL metrics and aggregation SHALL exclude NULLs from averages rather than treating them as zero.
3. WHEN the schema change ships THEN it SHALL be a forward-only migration appended to the `MIGRATIONS` tuple in `persistence-sqlite` (next free slot after 0029), with a spec test mirroring 0027's pattern (`PRAGMA table_info` shape assertions).
4. WHEN migrations run on an existing database THEN pre-existing rows SHALL remain valid with NULL metrics (no backfill required; files remain source of truth for quality, SQLite is a rebuildable index).

#### Requirement R2: Metrics capture at subagent completion

**User Story:** As a developer running orchestrated tasks, I want metrics captured automatically at subagent completion in every runtime that records subagent events, so that scorecards accrue without any manual step.

**Acceptance Criteria**

1. WHEN the `Task` tool completes and flows through `SkillTriggerService.onPostToolUse` → `SkillInvocationRecorder` THEN the per-agent metrics (matching `AgentCostBreakdown` semantics: tokens, cost, toolCount, plus duration) SHALL be attached to the recorded event keyed by `subagent_type` slug.
2. WHEN the metrics source is the execution tree THEN the shape SHALL stay consistent with `getAgentCostBreakdown` in `libs/shared/src/lib/utils/subagent-cost.utils.ts` (which remains pure/display-usable; no side effects added to shared utils).
3. WHEN metrics recording fails (e.g. malformed usage payload) THEN the invocation event SHALL still be recorded without metrics and a warning logged — metrics capture SHALL never break invocation counting or the enhance-eligibility signal (`getInvocationStats(slug).total`).
4. WHEN recording occurs THEN it SHALL be off the streaming hot path (fire-and-forget / post-completion), adding no user-perceivable latency to chat streaming.

### R-group B — Exact task↔invocation attribution

#### Requirement R3: `task_id` on invocation events

**User Story:** As the spec harvester, I want subagent invocation events stamped with the active `TASK_YYYY_NNN` id when one exists, so that graded verdicts join to exactly the runs they grade.

**Acceptance Criteria**

1. WHEN a subagent event is recorded during a session that has an active task context THEN the event SHALL carry a nullable `task_id` column (same migration as R1 or its sibling).
2. WHEN no task context exists (ad-hoc chat, runtimes without `.ptah/specs`) THEN `task_id` SHALL be NULL and the event SHALL behave exactly as today.
3. WHEN the architect designs the task-context source THEN it SHALL NOT violate hexagonal boundaries: `skill-synthesis` may depend on `task-specs` (existing, acyclic); `agent-sdk` SHALL NOT import `skill-synthesis`; frontend SHALL NOT import backend.

#### Requirement R4: Harvester reconciles by exact task_id first

**User Story:** As a user running two concurrent tasks that both delegate to `backend-developer`, I want each task's verdict applied only to that task's runs, so that one failed task doesn't poison the other's success rate.

**Acceptance Criteria**

1. WHEN `SpecHarvesterService.harvest()` reconciles a spec's batch verdicts THEN events with a matching `task_id` SHALL be reconciled by exact id (slug + task_id), ignoring the time window.
2. WHEN events lack `task_id` (legacy rows, ad-hoc runs) THEN the existing slug + `windowStart`/`windowEnd` heuristic SHALL apply as fallback, and the row's `verdict_source` SHALL distinguish exact vs heuristic attribution (e.g. `spec:TASK_X` vs `spec-window:TASK_X`).
3. WHEN two specs complete with overlapping time windows and the same executor slug THEN task_id-stamped events SHALL each receive their own task's verdict (regression test required for the concurrent-task scenario).
4. WHEN reconciliation runs twice for the same spec THEN it SHALL remain idempotent (existing `.harvested.json` marker + `reconciled_at` guard preserved).

### R-group C — Per-subagent scorecard in the Library tab

#### Requirement R5: Scorecard aggregation API

**User Story:** As the Library tab, I want a backend aggregation that returns a scorecard per agent slug, so that clone cards can show evidence instead of just eligibility counters.

**Acceptance Criteria**

1. WHEN the scorecard is requested for an agent slug THEN the response SHALL include: total invocations, reconciled success rate (graded events only, distinct from optimistic `succeeded`), avg + total tokens (by class), avg cost, avg duration, avg tool count, and the N most recent spec verdicts (task_id, COMPLETE/FAILED, timestamp).
2. WHEN recent review findings exist for the slug (`SpecFindingsPort.getRecentFindings`) THEN the scorecard SHALL include a truncated findings excerpt consistent with the existing `MAX_FINDINGS_CHARS` discipline.
3. WHEN the RPC surface is extended THEN it SHALL reuse the existing `skillSynthesis.*` namespace where possible; ANY new namespace SHALL follow the dual-registration rule (`libs/shared/.../rpc.types.ts` + `ALLOWED_METHOD_PREFIXES` in `libs/backend/vscode-core/src/messaging/rpc-handler.ts`). All RPC inputs Zod-validated in `rpc-handlers`.
4. WHEN no metrics rows exist for a slug THEN the scorecard SHALL return a well-typed empty/partial state, never an error.

#### Requirement R6: Scorecard UI on agent clone cards

**User Story:** As a Ptah user browsing the Thoth Skills tab Library, I want each agent clone card to show its scorecard (success rate, token/cost profile, recent verdicts), so that I can judge which agents perform well and which need enhancement.

**Acceptance Criteria**

1. WHEN an agent clone card renders in `skill-synthesis-ui` THEN it SHALL surface: reconciled success rate, invocation count, avg tokens, avg cost, and a compact recent-verdicts indicator (e.g. last 5 COMPLETE/FAILED).
2. WHEN the runtime has no `.ptah/specs` (harvester no-op) THEN the card SHALL degrade gracefully to usage-only metrics (invocations, tokens, cost) with no spec-verdict section and no errors — required in BOTH VS Code and Electron.
3. WHEN metrics are NULL/absent THEN the UI SHALL show an explicit "no data yet" state, not zeros.
4. WHEN implemented THEN components SHALL follow house Angular rules: signals + `inject()`, `ChangeDetectionStrategy.OnPush`, no backend lib imports, any findings text rendered through `libs/frontend/markdown` (never raw `[innerHTML]`).

#### Requirement R7: Scorecard detail view

**User Story:** As a user evaluating a specific agent, I want to expand a card into a detail view listing recent graded runs (task, verdict, tokens, cost, duration), so that I can see the evidence behind the aggregate numbers.

**Acceptance Criteria**

1. WHEN a scorecard is expanded THEN a list of the most recent graded invocations SHALL be shown with task_id, verdict, tokens, cost, and duration per row.
2. WHEN an invocation was attributed heuristically (window fallback) THEN it SHALL be visually distinguishable from exact-attributed rows.
3. WHEN the list is empty THEN the detail view SHALL explain how data accrues (run orchestrated tasks) rather than showing a bare empty state.

### R-group D — Metrics-aware enhancer

#### Requirement R8: Scorecard-injected enhancement prompt for agents

**User Story:** As the auto-enhancer, I want the agent-kind `generateCandidate` prompt to include the agent's scorecard — failure patterns from spec findings, success rate, and token-heaviness — so that the enhanced definition targets measured weaknesses, not just generic authoring style.

**Acceptance Criteria**

1. WHEN `SkillEnhancerService.generateCandidate` runs for `kind='agent'` and a scorecard exists THEN the prompt SHALL include: reconciled success rate, avg/total token profile, avg cost, and recent failure-linked findings, with explicit instructions to reduce token consumption and address recurring failure patterns while preserving the agent's role and triggers.
2. WHEN no scorecard data exists THEN the enhancer SHALL fall back to today's behavior (kind-specific best practices + `getRecentFindings`) unchanged.
3. WHEN the scorecard block is injected THEN it SHALL be size-bounded (consistent with the existing 4000-char findings cap) so enhancement prompts don't themselves become token-heavy.
4. WHEN enhancement eligibility is computed THEN existing gates (`MIN_INVOCATIONS_TO_ENHANCE`, `ENHANCE_COOLDOWN_MS`, judge gate) SHALL remain unchanged — this task changes prompt content, not gating policy.

#### Requirement R9: Judge context enrichment (bounded)

**User Story:** As the judge gate, I want the agent-enhancement verdict prompt to see the same scorecard context the enhancer saw, so that it can reject candidates that ignore the measured problems.

**Acceptance Criteria**

1. WHEN `SkillJudgeService` evaluates an agent enhancement candidate THEN the judge prompt MAY include the scorecard summary as context; the five scoring criteria and `minJudgeScore` semantics SHALL NOT change in this task (measured-outcome criteria are R-group E, deferred).
2. WHEN the judge LLM call fails THEN existing fail-OPEN behavior SHALL be preserved.

### R-group E hook (deferred group, minimal enabler only)

#### Requirement R10 (SHOULD): Enhancement-event timestamp queryability

**User Story:** As a future before/after evaluation task, I want each agent enhancement event queryable by slug + timestamp against the metrics table, so that pre/post windows can be computed retroactively.

**Acceptance Criteria**

1. WHEN an agent clone is enhanced THEN the enhancement timestamp SHALL be retrievable per slug from existing clone-history storage (verify; add only if a gap exists — no new snapshot schema in this task).
2. WHEN A/B data is later needed THEN raw per-invocation metrics rows (R1) SHALL be sufficient to compute before/after aggregates without schema changes.

---

## Non-Functional Requirements

### Performance

- Metrics recording adds no synchronous work to the streaming hot path; recording failures never block or delay chat output (R2.4).
- Scorecard aggregation is a SQL aggregate over indexed columns (extend existing `idx_skill_inv_events_*` family as needed); Library tab render with 200 clones SHALL not regress perceptibly (aggregation on demand or batched per visible cards — architect decides).
- Harvest remains O(specs × batches); exact-id reconciliation must not scan the full events table per batch (index on `(skill_slug, task_id)` or equivalent).

### Reliability & Data Integrity

- Files remain source of truth; the SQLite index (including new metrics columns) is rebuildable/degradable. Loss of the DB loses telemetry history but never breaks skills, agents, or tasks.
- Migrations forward-only, appended to the MIGRATIONS tuple, each with a shape spec test.
- Reconciliation stays idempotent under repeated harvests and concurrent tasks.
- Graceful degradation in every runtime without `.ptah/specs` (CLI-only, fresh Electron): all features reduce to usage-only telemetry, zero errors.

### Security & Validation

- Zod validation for all new RPC inputs at the `rpc-handlers` boundary; trust internal types past it.
- Findings text shown in UI routes through the `libs/frontend/markdown` DOMPurify chokepoint.
- No raw `error.message` leakage over RPC; `catch (error: unknown)` + narrowing everywhere.

### Architecture Compliance

- Hexagonal: services use `IFileSystemProvider`/ports, no `node:fs` in new service code paths that live in ported libs (note: `spec-harvester` currently uses `node:fs/promises` directly — do not expand that pattern; architect to decide whether B-work refactors it).
- Dependency directions: `skill-synthesis → task-specs` (existing), `rpc-handlers → skill-synthesis`, frontend ↔ backend isolation via `libs/shared` only. `agent-sdk` MUST NOT import `skill-synthesis`.
- Angular: signals, OnPush, zoneless-safe in libs.
- No trademarked AI product names added to non-JS shipped files (marketplace scanner constraint).

---

## Out of Scope

- R-group E proper: before/after outcome snapshots, delta computation, measured-outcome judge criteria, enhancement-effect reporting UI (follow-up task; R10 keeps the door open).
- Evaluating **orchestration skills** beyond what already flows through skill invocation events — this task's evaluation substrate work is agent-focused; skill-kind scorecards may reuse the same aggregates for free but no skill-specific UI work is committed.
- Changing enhancement gating policy, judge criteria/weights, promotion/dedup/curator behavior.
- Backfilling metrics for historical invocation events or historical spec folders.
- CLI-agent (ptah-cli junior helper) telemetry — only `Task`-tool subagents keyed by `subagent_type` are in scope.
- License/premium gating changes.

---

## Risks

| Risk                                                                                        | Probability | Impact | Mitigation                                                                                                                                         |
| ------------------------------------------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metrics unavailable or inconsistent across providers (Claude vs Copilot vs Codex vs ollama) | High        | Medium | Nullable columns + NULL-excluding aggregates (R1.2); scorecard "no data" states (R6.3).                                                            |
| Task-context plumbing to the recorder crosses a hexagonal boundary awkwardly                | Medium      | High   | Flagged as the top architect open question; `skill-synthesis → task-specs` edge already exists; worst case a port in `platform-core`/shared token. |
| Concurrent-task attribution regressions (the exact bug B fixes)                             | Medium      | High   | Dedicated regression test for overlapping windows + same slug (R4.3); `verdict_source` disambiguation for auditability.                            |
| Library tab performance with 200 clones × scorecard queries                                 | Medium      | Medium | Aggregate in SQL, index properly, lazy-load detail view (R7).                                                                                      |
| Enhancer prompt bloat degrading enhancement quality                                         | Low         | Medium | Size-bounded scorecard block (R8.3).                                                                                                               |
| Schema churn if E lands later with different needs                                          | Low         | Low    | R1 stores raw per-invocation rows (not pre-aggregates), which any future delta computation can consume (R10.2).                                    |

---

## Dependencies

- **TASK_2026_157 artifacts**: `@ptah-extension/task-specs` (`parseTaskFile`, frontmatter `status`/`executor`, scanner), SQLite task index (migration 0029), `ITaskIndexNotifier` seam, tasks RPC namespace.
- **Existing skill-synthesis machinery**: `SkillInvocationRecorder` / `SkillTriggerService.onPostToolUse` (Task-tool branch), `SpecHarvesterService` + `spec-extractor` (frontmatter-only after 157), `SkillEnhancerService`, `SkillJudgeService`, `SpecFindingsPort`, `CloneSummary` eligibility fields.
- **Shared**: `subagent-cost.utils.ts` (`AgentCostBreakdown` shape), execution-tree types, `skillSynthesis.*` RPC types.
- **Persistence**: migrations 0021/0027 (event schema baseline), MIGRATIONS tuple.

---

## Open Questions for the Architect

1. **Capture point (R2)**: attach metrics inside the existing `onPostToolUse` Task-tool branch (does the tool-result payload carry usage there in all runtimes?) vs. a SubagentStop-adjacent seam vs. deriving from the finalized execution tree keyed by `subagent_type` — and which signal exists in VS Code vs Electron vs CLI?
2. **Schema shape (R1)**: widen `skill_invocation_events` with nullable columns vs. a sibling `skill_invocation_metrics` table keyed by event id. Widening is simpler; sibling isolates churn if E adds more fields later.
3. **Task-context source (R3)**: where does the active `TASK_YYYY_NNN` come from at recording time — chat-session task bridge state, an orchestration-skill-written marker, or the task index's in-progress row? Must not require `agent-sdk → skill-synthesis`.
4. **Scorecard delivery (R5/R6)**: one batched RPC for all visible clones vs. per-card fetch; and whether the aggregate lives in `skill-synthesis` (owning the store) exposed via `rpc-handlers`.
5. **Harvester fs usage**: does R4 work justify migrating `spec-harvester.service.ts` off direct `node:fs/promises` onto `IFileSystemProvider`, or is that deferred cleanup?
6. **Cost normalization**: cost is USD from Claude-side pricing; for providers with no cost signal, display tokens-only — confirm scorecard visual treatment with ui expectations in `skill-synthesis-ui`.
