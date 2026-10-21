# Batch 11 report — Nullable scorecard UI (Phase A "add beside old")

Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea`
Batch: 11 (Phase A, Wave A-W2) — Task 11.1 "Nullable scorecard UI: badge, detail, outcome signals"
Status: implemented. No check was run by this executor (the orchestrator runs the batch gate
`npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`).

## Files created/modified

| Absolute path | Change |
| --- | --- |
| `...\libs\frontend\skill-synthesis-ui\src\lib\components\clones\scorecard-badge.component.ts` | Doc block `:10-21`; `noGrade` constant `:88-89`; `successTone` `:96-100`; `successLabel` `:102-105`; `gradedRate()` narrowing helper `:107-119`. |
| `...\libs\frontend\skill-synthesis-ui\src\lib\components\clones\scorecard-badge.component.spec.ts` | Null-rate test now asserts `'No grade'` with `gradedCount: 0` fixture `:62-87`; null-scorecard-input test asserts `'No grade'` `:101-111`; new NaN test `:113-120`. |
| `...\libs\frontend\skill-synthesis-ui\src\lib\components\clones\scorecard-detail.component.ts` | `ScorecardDetailRow` boundary type `:17-27`; doc third rule `:53-56`; template pill classes `:116-122`; `rows` input `:169`; `gradedRows` computed via `verdictOf`/`toneOf` `:173-181`; helpers `:184-203`; `buildScorecardMetrics` `:209-211`; `totalTokens` `:243`. |
| `...\libs\frontend\skill-synthesis-ui\src\lib\components\clones\scorecard-detail.component.spec.ts` | Imports/helper widened to `ScorecardDetailRow` `:1-10`, `:26`; new FAILED test `:77-84`; new null test `:86-97`. |
| `...\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-outcome-signals.ts` | NULL-SAFE BOUNDARY doc `:9-14`; `NullableOutcomeRatio` `:28-37`; `AgentOutcomeSignalsInput` `:39-51`; signature `:66` and `resolveWindowDays` `:145`; run-count gate `:91`; `reviewed` `:101`; `hasRatio`/`isRecordedCount`/widened formatters `:154-187`. |
| `...\libs\frontend\skill-synthesis-ui\src\lib\components\clones\agent-outcome-signals.spec.ts` | Imports/helper widened to `AgentOutcomeSignalsInput` `:1-8`; new null-parts test `:60-77`; new null-run-count test `:79-83`. |

`SU` = `libs/frontend/skill-synthesis-ui/src/lib`. No other file was touched. No stubs, TODOs
or placeholders. LF line endings preserved.

## Task 11.1 evidence — null vs a value, per surface

| Surface | A value renders | Null/absent renders |
| --- | --- | --- |
| Badge success (`scorecard-badge.component.ts`) | `gradedSuccessRate: 0.5` → `50% ok` on `badge-success` (`>= 0.5`) or `badge-error` | `null`/absent/`NaN` → `No grade` on `badge-ghost`; tokens and cost keep their own `no data yet`; null scorecard input → `No grade` + `0 inv` |
| Detail row verdict (`scorecard-detail.component.ts`) | `succeeded: true` → `COMPLETE` pill, success tone; `succeeded: false` → `FAILED` pill, error tone | `succeeded: null` → `No grade` pill on a neutral card; the row text contains neither `FAILED` nor `COMPLETE` |
| Outcome signals (`agent-outcome-signals.ts`) | `{ numerator: 4, denominator: 5 }` → `80% (4/5)` | null/undefined ratio parts → `no verified runs` / `not reviewed yet`; null run count → `no data yet`; no value can reach the division and print `NaN%` |

Quality requirements, each with its evidence:

- **"No grade", never 0%/NaN.** Badge: `gradedRate()` (`scorecard-badge.component.ts:107-119`)
  returns null for a non-number or non-finite rate, and `successLabel()` maps that to the
  `noGrade` constant. Detail: `verdictOf` (`scorecard-detail.component.ts:184-196`) maps null to
  `NO_GRADE`. Signals: `hasRatio` (`agent-outcome-signals.ts:164-177`) is the only path to
  `formatPercent`, and it rejects null, undefined, non-finite and non-positive parts.
- **No causality claim when ungraded.** The detail row for `succeeded: null` renders only
  `No grade`; the spec asserts the row text contains neither `FAILED` nor `COMPLETE`
  (`scorecard-detail.component.spec.ts:86-97`). The neutral tone claims neither outcome.
  No surface adds "improved/regressed because" text.
- **No untrusted `[innerHTML]`.** The findings excerpt still renders only through
  `ptah-markdown-block` (`scorecard-detail.component.ts:157-164`), the DOMPurify chokepoint.
  No `[innerHTML]` was added anywhere.
- **`number | null | undefined` at the boundary, cast-free.** Badge input stays
  `AgentScorecard | null | undefined` (the DTO already types `gradedSuccessRate: number | null`).
  Detail exports `ScorecardDetailRow = Omit<ScorecardInvocationRow, 'succeeded'> & { succeeded: boolean | null }`.
  Signals exports `NullableOutcomeRatio` and `AgentOutcomeSignalsInput`. Each widening is a
  supertype of the shared DTO, so every existing caller stays assignable with no
  `as unknown as` and no `any`.
- **Spec cases for null and for a value.** Badge: `50% ok` (`:40-60`), `'No grade'` for null
  (`:62-87`) and for NaN (`:113-120`). Detail: COMPLETE (`:64-79`), FAILED (`:77-84` after the
  shift; new), `No grade` for null (`:86-97`; new). Signals: `80% (4/5)` (`:90-108` region),
  absence labels for null parts (`:60-77`; new), `no data yet` for a null run count
  (`:79-83`; new).
- **Narrowing guards that actually narrow.** Every guard follows the batch-7 idiom:
  `typeof x !== 'number'` first, `Number.isFinite` second. `Number.isFinite` accepts `unknown`
  and narrows nothing, so it runs only after the union is narrowed to `number`. The
  `hasRatio` predicate additionally narrows `NullableOutcomeRatio` to `OutcomeRatio`, which is
  what lets `formatPercent` keep its non-nullable parameter.

## Risks and how each was handled

| Risk / edge case | Handling |
| --- | --- |
| `successRate=null` renders "No grade" (batches.md edge case) | Done for all three 11.1 surfaces. Card/drawer per-kind display stays task 24.1 (batch 22); `clone-card.component.ts` and `clone-detail-drawer.component.ts` are untouched. |
| `Number.isFinite` + arithmetic does not narrow a nullable number | Every nullable number passes a `typeof` guard first (`gradedRate`, `hasRatio`, `isRecordedCount`). |
| Phase A ordering: the shared DTO still types fields as `number` until later batches | The widening lives in boundary types exported from the UI files, not in the DTO. The code compiles today and keeps compiling after batch 8 widens `CloneSummary`. `ScorecardInvocationRow[]` and `AgentOutcomeSignals` callers need no edit and no cast. |
| Wave parallelism with the backend lane | Only the 6 assigned SU files changed; no `libs/backend` or `libs/shared` file was touched. |
| Flag UI: no null can reach these surfaces today | The DTO still sends `number`/`boolean`, so visible output is unchanged until the later batches land; the null paths are ready and spec-pinned before the data can arrive. |
| Batch defaults (checks, git, stubs) | No test/typecheck/lint/nx/build/e2e command was run; no git command was run; `batches.md` and `task.md` untouched; no stubs or TODOs. |

## Decisions

| # | Decision | Options | Evidence |
| --- | --- | --- | --- |
| 1 | "Reuse `formatSuccessRate`" means reusing its label and its `typeof`-narrowing idiom, not a direct call. | (a) label + idiom; (b) direct call | A direct call is impossible: the helper takes a `CloneSummary` and its `invocationCount <= 0` gate returns `null` to HIDE a metric, while the badge shows `AgentScorecard.gradedSuccessRate` and the detail shows per-row verdicts. Building a `CloneSummary` to feed it would fabricate invocation data. The literal `'No grade'` and the `typeof rate !== 'number'` guard are the reusable parts, and both are reused. |
| 2 | Badge tokens and cost keep `no data yet`, not `No grade`. | (a) keep; (b) also switch | They are usage metrics, not grades. `formatSuccessRate` says nothing about them. The null-rate spec still asserts both labels (`scorecard-badge.component.spec.ts:78-83`). |
| 3 | The detail boundary widens `succeeded` through a local `ScorecardDetailRow`, not the shared DTO. | (a) local boundary type; (b) widen `ScorecardInvocationRow` (batch 8+ scope); (c) cast in specs | A truthiness test on `succeeded` would coerce `null` to FAILED — a verdict nobody recorded, which violates the no-causality rule. The local type keeps every existing `ScorecardInvocationRow[]` caller assignable (boolean → boolean \| null), so no consumer edit and no `as unknown as` in the specs. The DTO stays untouched for the batch that owns it. |
| 4 | Signals keeps its 646 absence labels (`no verified runs`, `not reviewed yet`, `no data yet`) instead of the literal `No grade`. | (a) keep 646 labels; (b) switch to `No grade` | implementation-plan.md line 108: "646 outcome signals remain visible". Those sentences are the established outcome-side statement of the same absence; changing the wording would silently consume the display copy that batch 22 owns. The boundary widening (`NullableOutcomeRatio`, `AgentOutcomeSignalsInput`) is what this batch adds, so a null part can never reach the division and print `NaN%`. |
| 5 | NaN renders exactly like null. | (a) same absence label; (b) different handling | Batch 7 set the precedent: a non-finite value is a broken grade, not a zero. Badge spec pins it (`:113-120`); `hasRatio` treats a non-finite part as no ratio. |
| 6 | `recentVerdicts[].succeeded` stays `boolean`. | (a) leave; (b) widen | No batch widens it. `listGradedInvocations` filters to `reconciled_at IS NOT NULL` rows, so every verdict dot is a graded run; widening it would imply a null path the backend never sends. |

## What could not be done

Nothing blocked. The batch gate (test + typecheck for `@ptah-extension/skill-synthesis-ui`) was not
run by this executor, per the lane rules — the orchestrator runs it.