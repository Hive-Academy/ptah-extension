# CI contract guard fix

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\spec-harvester.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\reports\ci-contract-guard-fix-report.md` (this report)

## Exact before and after lines

Before:

```ts
import { CARRIER_FILE } from '@ptah-extension/shared';
          sourceFile: batch ? 'batches.md' : laneVerdict ? 'lane_outcome_records' : review?.file ?? null,
```

After:

```ts
import { BATCHES_FILE, CARRIER_FILE } from '@ptah-extension/shared';
          sourceFile: batch ? BATCHES_FILE : laneVerdict ? 'lane_outcome_records' : review?.file ?? null,
```

## Comment decision

Left the `batches.md` prose comment at line 7 unchanged. The guard's `stripComments` function removes block and line comments at `libs/backend/task-specs/src/lib/contract.guard.spec.ts:100-147`, and the offender scan applies it before matching filenames at lines 203-209.

## Other per-task filename literals

The only other `.md` mentions in `spec-harvester.service.ts` are `task.md` in comments at lines 3 and 323 and `tasks.md` in the comment at line 8. No other guard-owned filename literal appears in executable code, so no further replacement was needed.

## Decisions

- Imported `BATCHES_FILE` through the existing `@ptah-extension/shared` public alias import.
- Kept the change to the one production literal and left all comments untouched, as the guard ignores them.
- Ran no checks, as instructed.
