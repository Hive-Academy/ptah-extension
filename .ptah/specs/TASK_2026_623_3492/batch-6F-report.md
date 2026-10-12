# Backend implementation — `TASK_2026_623_3492`, batch 6F

**Tasks completed**: 6F.1 (`list $limits` takes its lanes from every row, then applies the list cap)

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts
  - `limitsRows` now builds `listItems` with a new helper, `laneListItems(limits.rows)`. It reads ALL rows, not the rows already cut to the cap.
  - Lanes are deduped on the raw `row.lane` in the order each first appears. `clampHostValue` is applied only for display.
  - Cap: if there are `maxTableRows` lanes or fewer, every lane is listed. Otherwise the first `maxTableRows - 1` lanes are listed and the last item is `+<n> more`.
  - Unchanged: table `rows`, the table `+N more` note, `freshness`, the pending/unavailable status, and the `$limits` scalars.
  - The doc comment now describes the table projection, the list projection and the list cap.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.spec.ts
  - Added two local helpers (`limitRow`, `listTexts`) and three cases right after the existing row-cap case (`keeps the "as of" time beside the empty state and the row cap`).

**Stack observed**: TypeScript library `@ptah-extension/shared`, Jest via `libs/shared/jest.config.ts` (ts-jest). The resolver is a set of plain functions with no DI. The cap constant `SURFACE_LIMITS.maxTableRows` is already imported in the resolver.

## Test cases and evidence

1. `lists a lane whose windows all fall past the table row cap`
   - Input: `maxTableRows` rows for `codex` (windows `w0..`), then one `grok` row.
   - `list $limits` returns items `['codex', 'grok']`.
   - `table $limits` on the same input keeps `maxTableRows` rows, with description `as of 14:32; +1 more`.
2. `caps list $limits lanes with a final "+N more" item`
   - Input: `maxTableRows + 2` distinct lanes.
   - Items are exactly the first `maxTableRows - 1` lanes in input order, then `+3 more`. That is `maxTableRows` items in total.
3. `lists exactly maxTableRows lanes without a "+N more" item`
   - Input: exactly `maxTableRows` distinct lanes.
   - Items equal every lane, with no `+N more` item.

### Pre-fix failure (confirmed)

One scoped Jest run of only `ptah-ui-resolver.spec.ts`, with the new tests in place and the resolver unchanged:

```
  ● resolvePtahUi live sources › lists a lane whose windows all fall past the table row cap
    - Expected  - 1
    + Received  + 0
    -   "grok",
  ● resolvePtahUi live sources › caps list $limits lanes with a final "+N more" item
    - Expected  - 1
    + Received  + 1
    -   "+3 more",
    +   "lane-999",
Tests:       2 failed, 25 passed, 27 total
```

- Case (1) fails as expected: `grok` is missing.
- Case (2) also fails: the old code had no `+N more` list item.
- Case (3) passes before the fix. That is expected, because it is the boundary case that should behave the same before and after.
- The first attempt at this run stopped on a TS18048 compile error in the spec helper (`list.items` possibly undefined). I fixed it with `list.items ?? []` before the run above.

## Verification (sequential, from the worktree root)

1. `npx jest -c libs/shared/jest.config.ts libs/shared/src/mcp-apps-contracts/ptah-ui-resolver.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-pipeline.spec.ts libs/shared/src/mcp-apps-contracts/ptah-ui-compactness.spec.ts --coverage=false --maxWorkers=2 2>&1 | tail -n 40`
   ```
   Test Suites: 3 passed, 3 total
   Tests:       133 passed, 133 total
   ```
2. `npx nx typecheck @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
   - Result: `Successfully ran target typecheck for project @ptah-extension/shared`.
   - Nx Cloud printed a 401 "organization disabled" notice. It is unrelated to the check.
3. `npx nx lint @ptah-extension/shared --parallel=1 2>&1 | tail -n 20`
   - Result: `✖ 6 problems (0 errors, 6 warnings)`. These are the 6 baseline warnings: max-lines, preserve-caught-error and no-unused-vars in files this batch did not touch.

**Plan deviations**: none.

**Out-of-scope observations**: none beyond what batches.md already records: the `$agents`/`$runs` lists are cut to the first `maxTableRows` rows with no `+N more` list item.
