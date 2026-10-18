# Batch 5 report

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\shared\src\lib\types\advanced-settings.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\shared\src\lib\types\advanced-settings.types.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\platform-core\src\file-settings-keys.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\platform-core\src\file-settings-keys.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-5-report.md`

## Task evidence

- **5.1:** Added `compaction.idleCompactionEnabled` as a live, default-true boolean in `context-budgets`, with the plan's exact label and help. Added `compaction.idleCompactionMinTokens` as a live integer token setting with the plan's label, range 100,000–5,000,000, and default 200,000. The shared spec now pins 29 unique keys, the numeric range row, and the boolean key row.
- **5.2:** Added both keys alongside the compaction budgets in `FILE_BASED_SETTINGS_KEYS`. Platform-core specs assert membership, routing, and exact defaults. The existing exhaustive advanced-defaults fixture was also updated to include both keys.

## Verification

`NX_NO_CLOUD=true` was set. Exactly the requested two-project Nx test command was run, with one permitted rerun after fixing the platform-core pinned fixture. Initial filtered output confirmed `Running target test for 2 projects` and showed one failed platform-core suite (one failed test). Final filtered output:

```text
 NX   Running target test for 2 projects:
 NX   Successfully ran target test for 2 projects
```

**Final run passed.** Scoped `ptah_get_diagnostics` after the final edit reported zero TypeScript errors and warnings.

## Decisions

- The plan specifies exact copy for the boolean and a label/unit, but no help sentence for the numeric setting. I used `Ptah compacts an idle chat once it reaches this size.` as the required descriptor help. The alternatives were repeating the range or leaving help blank; the existing descriptor pattern requires one plain sentence and renders the range separately. This copy is reversible.
- Defaults remain derived from `ADVANCED_SETTINGS` by the existing platform-core mapping; the new file-key entries control write routing. The alternatives were duplicate default literals in source or the existing derived table. The latter follows `file-settings-keys.ts` and is reversible.

## Plan validation risks

| Listed risk | Batch 5 handling |
| --- | --- |
| A2 coordinator-origin `/compact` may become prompt text | Out of Batch 5 scope; P1 live probe gates Batch 10. |
| Direct-construction specs may break on constructor parameters | No constructor changed in Batch 5; later batches own optional parameters. |
| Shared spec pins 27 advanced settings | Updated to 29 and added explicit numeric and boolean rows; final test passed. |
| Service spec size exceeds lane ceiling | No service spec changed; Batches 7 and 8 own the split. |
| Router admission race | No router change; Task 12.1 owns the deferred-profile test. |
| `postCompactSeen` clearing on late compacting frame | No coordinator change; Tasks 1.1, 1.2, and 12.1 own this. |
| Pending send promise survives session release | No send-path change; Tasks 7.1 and 8.1 own the liveness veto. |
| Timer handles leak or keep Node alive | No timer introduced; Tasks 2.2 and 8.1 own verification. |
| Large session-lifecycle manager | Not touched; Task 9.2 owns thin delegates. |
| UI completion evidence | Descriptor rows added; Phase 3 visual review owns screenshots. |
| Settings write path | Both keys are in the file-based allow-list and tested for routing/defaults; later provider and UI batches own the full trace. |

The validation note that boolean `compaction.*` values do not enter `budgetDefault` is respected: only the existing budget-key list is checked there. Batch 6 owns its construction spec. Other assumptions A1–A5 and their live probes are outside the assigned files.
