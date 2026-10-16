# Batch 36b report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\key-value-outcome-journal.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.durability.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-36b-report.md`

## Fix

1. `key-value-outcome-journal.ts:31,76,105-108`: the generic journal accepts a typed Zod op schema and validates each stored entry with it. Failed entries are omitted and included in `droppedOnRead` at lines 110-115. The unchecked `entry.op as T` cast is gone. `outcome-write-pipeline.ts:43-67,195-200` supplies a discriminated schema for all five operation kinds and their required row, run ID, or report fields. The report kind must match its operation kind.
2. `outcome-write-pipeline.ts:448-465`: drain parses the head before applying it. An invalid head enters the existing rejected ledger as `invalid-op` with a sequence-based ID and `ZOD_VALIDATION` reason, increments `processed`, and allows the next op to run. `outcome-write-pipeline.ts:69-70,100-106,684-720` extends the rejected ledger for that internal kind. The warn carries only the ID and reason code.

The only existing constructor call site updated is `outcome-write-pipeline.ts:195-200`. The new journal spec passes its own schema at `key-value-outcome-journal.spec.ts:43-47`. Other generic journal callers continue to use the optional schema default, which preserves their string and number test data. Production pipeline construction always supplies the operation schema. No index export changed.

## Specs and baseline failure

- `key-value-outcome-journal.spec.ts:29-52` persists `{seq:1,op:null}`, an entry with no op, `{seq:3,op:5}`, and one valid budget stop. It expects three drops and only the valid entry. On `8cd5cc212`, `z.unknown()` accepts all three malformed ops, so `droppedOnRead` is zero and the entries assertion fails. Its constructor also had no schema parameter, so the test would need the new constructor API to compile against that revision.
- `outcome-write-pipeline.durability.spec.ts:25-76` injects a null head after pipeline construction, follows it with a valid completion, then bounds work to three drain turns. It asserts the valid row was applied, the journal emptied, and the invalid entry was recorded and warned once with code only. On `8cd5cc212`, drain sees the null head, breaks with zero processed, and schedules another drain from `finally`; the following row is never applied, the reject assertion fails, and the scheduler continues spinning.

## Verification

- `npx prettier --check` on all four changed source/spec files: `All matched files use Prettier code style!` (exit 0).
- `npx eslint` on all four changed source/spec files: `1 problem (0 errors, 1 warning)` (exit 0). The warning is `outcome-write-pipeline.ts:746 max-lines`, 711 lines against 700.
- Degradation audit: `degradation-audit: TOTAL 296 unsuppressed site(s)`; no `FAIL` (exit 0). An initial audit identified an orphaned marker added beside the reject branch; removing that misplaced marker restored the baseline.
- DI lint: `di-lint OK: 1841 @inject sites all resolve to a registered token (807 tokens); every container-constructed class names all required and non-equivalent defaulted dependencies` (exit 0).
- Scoped `ptah_get_diagnostics`: zero errors in the four changed files. It reported two errors in `libs/backend/lane-routing/src/lib/route-decide.service.ts`, which is owned by the concurrent lane and was not modified here.
- Per Decision #53, no Nx, Jest, or project-wide tsc was run.

## Decisions

- Kept the journal generic with an optional op schema. Requiring a pipeline schema from every generic test caller would force unrelated number/string tests to change; the pipeline's sole production constructor now supplies structural validation. This is reversible by making the schema required and updating those callers.

Verdict: S-1 fixed in the assigned files; light checks pass with one ESLint line-count warning, and tests remain for the team-leader to run.
