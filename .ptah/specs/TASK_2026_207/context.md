# Context — M3 harness `IGNORED_DIRS` copy has no drift detection

## Origin

`TASK_2026_173` Batch 9 register, item 1 of 17 (`tasks.md` Task 9.3 table). Raised by Batch 5 review,
Failure Mode 4 / Issue 2. Filed per NFR-9 — deliberately not fixed in TASK_2026_173.

## Finding (from the register)

> Drift detection between `libs/shared/src/lib/constants/workspace-scan.constants.ts` and
> `apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs`'s hand-maintained
> `IGNORED_DIRS` copy. The `.mjs` harness cannot import the TS constant without dragging itself into the
> build graph and forfeiting the "zero product-code change" property that makes the M3 before/after
> numbers comparable — so the copy is justified, but its only safeguard today is a comment banner. A
> text/AST-level test that fails CI when the two lists diverge turns that comment's promise into an
> enforced invariant. Tooling-only: drift corrupts a future measurement, never production behaviour.

`measurements.md` §M3 independently confirms the copy exists and is flagged: "The script's exclusion
list is a hand-maintained third copy living in the e2e harness ... It now carries an explicit warning
pointer at `workspace-scan.constants.ts`. Flagged as a known follow-up, not silently accepted."

## Fix

Add a CI-enforced test (text or lightweight AST parse, not a build-graph import) that reads both
`workspace-scan.constants.ts`'s `TREE_HIDDEN_DIRS`/`WATCH_IGNORED_DIRS` source and the `.mjs` harness's
`IGNORED_DIRS` literal, and fails when the two sets diverge. Keeps the harness free of the TS build
graph (preserving the "zero product-code change" measurement property) while making the drift-safety
comment an enforced invariant instead of a promise.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 1; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/measurements.md` §M3 "Honest caveats";
`apps/ptah-electron-e2e/src/specs/editor/perf-m3-watcher-churn.script.mjs`;
`libs/shared/src/lib/constants/workspace-scan.constants.ts`.
