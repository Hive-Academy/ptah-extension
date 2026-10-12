# Phase 1 Fix Logic Re-review — `TASK_2026_623_3492`

## Result

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVED |
| Serious #1 | CLOSED |
| New findings | 0 |

The fix closes Serious #1. `limitsRows` still slices raw rows only for the table, while `laneListItems` derives ordered unique lanes from all raw `limits.rows` before applying the independent list cap (`libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.ts:384-403`). Thus a lane occurring only after the table-row cap remains visible in `list $limits`.

The score is in the 7–8 sound band: the changed data path, both cap boundaries, status propagation, and focused tests are evidenced. It is not 9–10 because this is a focused re-review; end-to-end host collection/normalization of `PtahUiLimitsInput` and consumers outside this commit were intentionally out of scope.

## Serious #1 Closure

- **Status: CLOSED.** Raw lane names are deduplicated in first-appearance order with `new Set(rows.map((row) => row.lane))` before any display clamp (`ptah-ui-resolver.ts:397-401`). Display clamping occurs only after deduplication (`ptah-ui-resolver.ts:401`), as required.
- The table remains independently capped to the first `maxTableRows` rows and retains its row-based `+N more` note (`ptah-ui-resolver.ts:384-393`). `$limits` scalars are untouched by this commit (`ptah-ui-resolver.ts:191-210`).
- `lanes.length === maxTableRows` returns every lane with no summary item (`ptah-ui-resolver.ts:400-403`), exercised by the regression at `ptah-ui-resolver.spec.ts:634-648`.
- For more lanes, the code lists `maxTableRows - 1` names plus `+<omittedLanes> more`; at `maxTableRows + 2`, the asserted count is `+3 more` (`ptah-ui-resolver.ts:400-403`, `ptah-ui-resolver.spec.ts:618-631`). The arithmetic also yields `+2 more` at exactly `maxTableRows + 1`.
- The cap-crossing regression supplies `maxTableRows` `codex` rows followed by `grok`, asserts both list items, and separately asserts that the table remains capped with `+1 more` (`ptah-ui-resolver.spec.ts:597-615`).

## Five Logic Questions

1. **Silent failure:** The prior silent omission is removed: list lanes come from every raw row, not the table slice (`ptah-ui-resolver.ts:391,397-403`). No new success-looking omission was evidenced in this changed path.
2. **Unexpected user action:** Requesting `list $limits` after one lane occupies the table row budget now returns the later lane as intended (`ptah-ui-resolver.spec.ts:597-606`).
3. **Wrong-answer input:** Repeated early-lane windows plus a distinct late lane now dedupe to both lanes; more than the lane cap produces an explicit `+N more` item rather than an unmarked truncation (`ptah-ui-resolver.ts:398-403`).
4. **Dependency failure or malformed shape:** Missing, pending, and unavailable inputs still resolve to their visible statuses before the new list projection (`ptah-ui-resolver.ts:382-383`); the pre-existing pending/unavailable regression remains at `ptah-ui-resolver.spec.ts:651-665`. This pure projection introduces no asynchronous dependency or timeout boundary.
5. **Requirement gap:** Decision #40 now specifies the formerly ambiguous list-cap interaction. A remaining out-of-scope uncertainty is whether upstream producers always populate a valid `PtahUiLimitRow`; this commit neither adds nor bypasses an external-input boundary.

## New Findings

None evidenced in the two files changed by `f0d5df3a4`.

## Verification

- TypeScript diagnostics for the changed resolver and spec: 0 errors, 0 warnings.
- Focused Jest run passed: 1 suite, 27 tests — `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts --coverage=false --maxWorkers=2`.
- No TODO, FIXME, stub, or placeholder was found in the changed resolver/spec; the sole `placeholder` search hit is an existing test description (`ptah-ui-resolver.spec.ts:378`).

## Decisions

- Applied decisions #34 and #40 literally: unique lanes are taken from all raw rows in first-appearance order, the list uses an item (not a table note) for omitted lanes, and table rows/notes and scalars retain their existing semantics.
- Treated the absence of an explicit `maxTableRows + 1` spec case as non-defective because the shared arithmetic is directly bounded by the tested exact-cap and `+2` cases: with one over cap, `listed` has `cap - 1` entries and `omittedLanes` is `2` (`ptah-ui-resolver.ts:400-403`).
- Did not re-review other Phase 1 code or report style concerns; scope was limited to `f0d5df3a4 -- libs/shared`.
