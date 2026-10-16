# Batch 15 - Task 15.3 fix round 3 (TL-27)

Executor: orchestrator (decision #77). Test-only change.

## Change

- `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\write\outcome-write-pipeline.backlog.spec.ts:320`
  - Before: `expect(store.receiptIds().sort()).toEqual(['report-4', 'report-5']);`
  - After: `expect([...store.receiptIds()].sort()).toEqual(['report-4', 'report-5']);`
- Reason: `receiptIds()` returns `readonly string[]` (`:282`), so `.sort()` failed ts-jest type checking (TS2339).

No other file changed. Batch 34/35 files untouched. Verification is the team-leader's joint Mode 2 round 3.
