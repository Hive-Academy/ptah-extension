# Batch 7 report — Nullable success-rate formatter guard

Task folder: `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea`
Batch: 7 (Phase A, Wave A-W1) — Task 7.1 "Null-narrowing `formatSuccessRate`"
Status: implemented. No check was run by this executor (the orchestrator runs the batch gate
`npx nx run-many -t test typecheck -p @ptah-extension/skill-synthesis-ui --parallel=1`).

## Files created/modified

| Absolute path | Change |
| --- | --- |
| `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-action-gating.ts` | Modified `formatSuccessRate` (now at `:251`): `typeof` narrowing guard, `No grade` for null/NaN. Signature unchanged. |
| `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-action-gating.spec.ts` | Added spec case for null and NaN (`:316-327`); existing number case kept (`:309-314`). |

No other file was touched. No stubs, TODOs or placeholders. LF endings preserved.

## Task 7.1 evidence

Precondition verified before the edit: `clone-action-gating.ts:241-244` (old numbering) read
`Number.isFinite(clone.successRate)` and then did arithmetic on the field. `Number.isFinite` has the
signature `(number: unknown) => boolean`, so it narrows nothing: once batch 8 widens
`CloneSummary.successRate` to `number | null`, `Math.round(clone.successRate * 100)` no longer
compiles. Current DTO verified: `libs/shared/src/lib/types/rpc/rpc-skill-clone.types.ts:25` is
`successRate: number` (batch 8 owns the widening).

Implementation (`clone-action-gating.ts:251-260`):

```ts
export function formatSuccessRate(clone: CloneSummary): string | null {
  if (clone.invocationCount <= 0) {
    return null;
  }
  const rate: number | null = clone.successRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    return 'No grade';
  }
  return `${Math.round(rate * 100)}%`;
}
```

Quality requirements, each with its evidence:

- **`typeof` guard that narrows.** `const rate: number | null = clone.successRate` then
  `typeof rate !== 'number'` — TypeScript narrows `rate` to `number` in the fall-through, so
  `Math.round(rate * 100)` compiles. The local `number | null` annotation makes the guard
  non-vacuous today (the field is still `number`) and keeps the body compiling unchanged after the
  batch 8 widening, with no edit needed then.
- **`null` renders "No grade".** Null rate → `'No grade'` (`:257`). The exact string matches the plan
  (implementation-plan.md §2: "if graded count is zero return `null`, display **No grade**") and the
  batches.md edge case "`successRate=null` renders 'No grade'".
- **Existing number callers stay valid.** Signature is unchanged:
  `formatSuccessRate(clone: CloneSummary): string | null`. Both callers
  (`clone-card.component.ts:499-506`, `clone-detail-drawer.component.ts:603-610`) pass a
  `CloneSummary` and branch on `success !== null`; both compile untouched, and every input possible
  today (the DTO field is `number`) produces the same output as before the batch.
- **Spec case for null, NaN and a number.** New test at `clone-action-gating.spec.ts:316-327`
  asserts `null → 'No grade'` and `NaN → 'No grade'`; the retained test at `:309-314` asserts the
  number case (`0.5 → '50%'`) and the recorded-nothing case (`invocationCount 0 → null`).

Why the spec uses `Object.assign(clone({ invocationCount: 4 }), { successRate: null })`:
`CloneSummary.successRate` is still `number` until batch 8, so a plain literal with
`successRate: null` does not typecheck against the DTO, and a cast would need the forbidden
`as unknown as`. `Object.assign` returns `CloneSummary & { successRate: null }`, whose `successRate`
collapses to `number & null` (=`never`), which is assignable to `number` — cast-free, and it sets the
runtime value to null. The idiom already exists in this repo
(`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:216` and 11 more).
Once batch 8 widens the DTO, `clone({ successRate: null })` becomes directly typable and batch 23
(which owns this file and spec again) can simplify it.

## Risks and how each was handled

| Listed risk / edge case (batches.md "Plan validation") | Handling |
| --- | --- |
| Edge case: "`successRate=null` renders 'No grade'. Tasks 7.1, ..." | Done in this batch for the clone-card/drawer Success metric path: null (and NaN) now yield the literal `'No grade'` instead of a hidden metric or a fabricated percentage. Scorecard badge/detail and outcome signals are task 11.1; card/drawer per-kind display is task 24.1. |
| Precondition: `Number.isFinite` + arithmetic does not narrow a nullable number | Replaced with the `typeof rate !== 'number'` narrowing guard; `Number.isFinite` kept only as the second, non-narrowing finiteness test after the union is already narrowed to `number`. |
| Ordering risk: must land before the shared `CloneSummary.successRate` widens (batch 8) | Only the two Batch-7-owned files changed; the DTO, handler and facade are untouched, so batch 8 can widen the field against a formatter that already narrows. The body needs no further edit after the widening. |
| Wave A-W1 runs batches 1 (PS), 2 (PC) and 7 (SU) in parallel | Batch 7 is file-disjoint from batches 1 and 2 and lives in a different Nx project; no shared file exists between them. |
| Flag UI ("No grade" text) | The string enters the rendered surface through the existing callers' `success !== null` branch. No null rate can reach the UI today (the DTO field is `number`), so no visible change occurs until batch 8+22 land; the Phase A visual review (before screenshots from base commit `271198ced`) should capture that. |
| Batch defaults (checks, git, stubs) | No test/typecheck/build/nx/jest command was run; no git command was run; `batches.md` and `task.md` untouched; no stubs or TODOs. |

## Decisions

| # | Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| 1 | Keep the `invocationCount <= 0` gate returning `null` (metric hidden). | (a) keep gate → `null`; (b) also render 'No grade' there | Batch 23 owns the gate's removal — its precondition requires the `invocationCount <= 0` guard still present, and the existing spec asserts the hidden-metric behavior. Changing it now would silently consume batch 23's scope. | Yes (git) |
| 2 | NaN renders 'No grade', not `null` and not `'NaN%'`. | 'No grade'; `null` (hide); `'NaN%'` | `Math.round(NaN * 100)` is `NaN`, so the old arithmetic would print `'NaN%'`; hiding would treat a broken value like a hidden metric. 'No grade' is the honest label for a non-grade and matches the batch's "spec case for ... NaN". | Yes (git) |
| 3 | Spec feeds null through `Object.assign` rather than a cast or a widened parameter type. | `Object.assign`; `as unknown as` (forbidden); structural input interface on the function | The public signature stays exactly `CloneSummary` (callers and file convention untouched); `Object.assign` is cast-free and an established repo spec idiom (canvas specs). | Yes (git) |
| 4 | Return type stays `string | null`. | `string \| null`; `string` (always render) | The `null` return still carries "no invocations recorded — hide the metric" for both callers, which branch on `success !== null`. Batch 23 revisits this when the gate goes. | Yes (git) |

## What could not be done

Nothing blocked. The batch gate (test + typecheck for `@ptah-extension/skill-synthesis-ui`) was not
run by this executor, per the lane rules — the orchestrator runs it.