# Batch 8FA report

## Completed work

- **8FA.1 / TL-1 / logic M1:** `command-center-records.ts:55-68,116-149` now reads old root-keyed entries into a run-ID-keyed map, rejects invalid or unrelated keys, returns all runs for a root in start-time order, writes by run ID, and supports removal by run ID or root.
- **8FA.2 / TL-2 / logic M2 / style Moderate 5:** `command-center-records.ts:18` makes lane roles optional while requiring a non-empty role when present. The inferred type remains local to chat-state.
- **8FA.3 / TL-3 / logic M3:** `tab-manager.service.ts:75,1414-1427` records manifest removal after a marked root's confirmed tab removal. Cancel and workspace park return before this point; last-session data is untouched.

## Files changed

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/command-center-records.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/chat-state/src/lib/tab-manager.command-center.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-8FA-report.md`

## Specs

- `command-center-records.spec.ts:37-148`: workspace isolation and last-session compatibility; two role-less runs under one root after reread, sorted by start time; old root-key migration on write; corrupt and mismatched entry removal; absent, valid and empty role behavior; remove-by-run and remove-by-root preservation of siblings and other roots.
- `tab-manager.command-center.spec.ts:88-124,133-150,203-248`: confirmed close removes only the closed root's runs; cancel and workspace park retain runs; a failed manifest removal records `runManifest` without blocking close; unmarked close does not call the remover.

## Catch classification

- `command-center-records.ts:48`: existing read/parse fallback, unchanged; returns empty records after storage or JSON failure.
- `command-center-records.ts:82`: existing write failure path retains the exact `degradation-audit: reported —` marker; false reaches `recordCommandCenterWrite`, which warns and sets failure state.
- `tab-manager.service.ts:345,984,2991,3034`: existing catch sites, unchanged. The first and last warn, the refresh rejection warns, and the persistence catch warns or tracks its backoff state.
- No new catch or `.catch` site was added.

## Verification and limits

- Scoped `ptah_get_diagnostics`: no diagnostics in the four changed source/spec files. It reported 20 errors in other project files, outside this batch's ownership.
- `npx prettier --check`: **All matched files use Prettier code style!**
- Per lane rules, no Nx or Jest command was run. The team leader owns the scoped verification command.

## Decisions

- Re-key valid legacy records during read, then persist the new shape on the next write. This preserves the existing storage key and keeps valid records alongside corrupt entries; reversible through stored data migration.
- Use the existing `recordCommandCenterWrite` path for removal failures, so the user-facing failure signal is consistent with active-tab and last-session writes; reversible.
