# Batch 36b round 2 report

## Files

Changed this round:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-op.schema.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.durability.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-36b-round2-report.md` (this report)

Existing round 1 changes retained on disk without edits this round:

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.spec.ts`

## Evidence

- `outcome-write-pipeline.ts:425-429`: the drain checks `next.entries[processed]` when a journal snapshot exists and `queue[processed]` otherwise. It breaks before parsing when the active source has no item. The existing invalid-head permanent rejection remains at `:429-440`.
- `outcome-write-op.schema.ts:5-30`: `ReportSchema` and `OutcomeWriteOpSchema` moved here. `outcome-write-pipeline.ts:25,34,172-176` imports the schema, keeps `OutcomeWriteOp` exported in its original module, and supplies the schema to journal validation. `src/index.ts` was untouched.
- `outcome-write-pipeline.durability.spec.ts:25-56`: the new spec uses `jest.spyOn(store, 'insertIfAbsent')` to enqueue three rows during the first insert, drains four turns, checks all four rows, and checks the rejected ledger is empty. On round 1, the journal snapshot had only the first entry, but the three queued rows kept the loop running. It parsed `undefined` as the second and third journal candidates and wrote false `invalid-op` / `queue:1` and `queue:2` ledger entries, so the empty-ledger assertion fails.
- Round 1 validation and specs remain at `key-value-outcome-journal.ts:107-110`, `key-value-outcome-journal.spec.ts:29-47`, and `outcome-write-pipeline.durability.spec.ts:58-105`.

## Checks

- `npx prettier --check` on the three files changed this round: `Checking formatting...` / `All matched files use Prettier code style!` (exit 0).
- `npx eslint` on the three files changed this round: no output, no max-lines warning (exit 0). With the same `max-lines` rule options and a diagnostic threshold of 1, ESLint reports **694 counted lines** for `outcome-write-pipeline.ts`; the configured maximum is 700. Physical file length is 737 lines.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts --max-warnings=-1 | Select-String 'FAIL|TOTAL'`: `degradation-audit: per-directory totals` / `degradation-audit: TOTAL 296 unsuppressed site(s)`; no `FAIL` (exit 0).
- `npx ts-node --transpile-only tools/di-lint/check-injects.ts | Select-Object -Last 5`: `di-lint OK: 1841 @inject sites all resolve to a registered token (811 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies` (exit 0).
- Scoped `ptah_get_diagnostics` for the three edited TypeScript files returned unavailable after 45 seconds; it reported all three unchecked. No Nx, Jest, or project-wide TypeScript check was run, as directed.

## Decisions

- Kept `RejectableOp` in the pipeline. Moving only the requested schemas yields 694 counted lines, preserves the current type ownership, and is reversible.

Verdict: the two round 2 fixes are in place and all four required CLI checks pass; test execution remains with the team leader.
