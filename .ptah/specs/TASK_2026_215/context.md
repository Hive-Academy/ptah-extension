# Context — `axe-core` is not a declared dependency

## Origin

`TASK_2026_173` Batch 9 register, item 9 of 17. Raised in Batch 7 report Round 2 §"axe" + review §C.
Filed per NFR-9 — declaring the dependency requires editing `package.json`, outside the
`libs/frontend/editor/**` constraint both Batch 6 and Batch 7 worked under.

## Finding (from the register)

> `axe-core` is not a declared dependency, so dialog accessibility is enforced by reviewers
> remembering to scan. Both Batch 6 and Batch 7 proved their a11y claims with `axe-core@4.12.1` reached
> **transitively** through `@axe-core/playwright`, via temporary specs deleted immediately after. A
> permanent spec importing it today would break silently on a dependency bump, and declaring it means
> editing `package.json` — outside the `libs/frontend/editor/**` constraint both batches worked under.
> Note the standing limit: axe has **no automated rule for focus trapping** and could not have caught
> Batch 7's Serious 2 — behavioural tests remain necessary alongside it.

## Fix

Add `"axe-core": "^4.12.1"` to `devDependencies` in the root `package.json`, and convert the deleted
probe spec(s) from Batch 6/7 into a permanent spec under `libs/frontend/editor`, so accessibility
scanning becomes a CI gate rather than a habit. Retain behavioural (non-axe) tests for focus trapping
and other rules axe cannot check.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 9; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-7-report.md` Round 2 §"axe" + review §C.
