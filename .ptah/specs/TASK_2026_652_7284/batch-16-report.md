# Batch 16 report

## Completion

- **16.3:** `HarnessSessionIdSchema` trims and bounds IDs before storage (`libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts:462,468`). The merge removes undefined-valued update keys without changing base or update (`libs/shared/src/lib/utils/merge-harness-config-updates.ts:3,22,28,56,63,70`). `HarnessConfigUpdatesSchema` rejects `null` section fields: section schemas use strict objects; their scalar, array, and record fields also reject `null`, including the preprocessed record fields because coercers leave non-array `null` invalid (`rpc-harness.schemas.ts:374-456,180-228`). No null handling was added to the merge.
- **16.1:** The store validates IDs before root lookup and file access, then serializes by file and uses the harness lock with 10 s stale and 12 s wait (`libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:21-23,59-90`). Per-file prune failures are logged and do not stop later files; expired invalid files are removed using mtime (`:152-194`). The class documents rejection types (`:37-46`). Constructor and injection remain unchanged.
- **16.4:** A regression checks undefined fields across persona, prompt, CLAUDE.md, agent overrides, and MCP tools, plus input immutability (`libs/shared/src/lib/utils/merge-harness-config-updates.spec.ts:119-146`). Existing cases remain passing.
- **16.2:** Store regressions cover a missing lock on release, trimmed and invalid IDs, old and recent corrupt records, and preservation of a label after an undefined update (`libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts:165-221`). The held and expired lock cases use the harness payload and a controlled clock (`:114-138`). Existing cases remain passing.

## Review findings

- **L1:** Harness lock release tolerates a missing lock; the new save/read regression passes.
- **L2 and S1:** The store's hand-written queue, stale recovery, and lock error are removed. It uses `serializeByKey` and `withFileLock`. The pre-existing harness-sync stale-break and owner-release race remains FU-1 as documented in `batches.md`; `file-lock.ts` was read and not edited.
- **L3:** Prune handles each record independently, deletes invalid records older than retention, and retains recent invalid records with a warning.
- **L4:** Save and get parse the ID before workspace lookup and file effects, then use the trimmed value for hash, record, and identity check.
- **L5:** Lock wait is 12 s, exceeding the 10 s stale threshold.
- **L7:** Undefined update values no longer replace stored section values; shared and store regressions pass.

## Verification

Ran the Batch 16 command once in the foreground (PowerShell used `Select-Object -Last 40` as the equivalent of `tail -40`):

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared @ptah-extension/rpc-handlers --parallel=1 2>&1 | tail -40`

Header: `Running targets typecheck, test, lint for 2 projects`. Initial result: **failed**, with `@ptah-extension/shared:test` and `@ptah-extension/rpc-handlers:test`; the four typecheck/lint targets succeeded. The failures were test code issues and were fixed. Focused reruns, one heavy command at a time:

- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/utils/merge-harness-config-updates.spec.ts --coverage=false --maxWorkers=2`: **passed**, 5/5 tests.
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts --coverage=false --maxWorkers=2`: **passed**, 16/16 tests.
- `npx nx run @ptah-extension/rpc-handlers:lint --parallel=1`: **passed**, 0 errors and 50 warnings across the project. No DI registration changed, so `di-lint:lint` did not apply.

The full two-project test targets were not rerun after the spec corrections. Nx Cloud reported its disabled free-plan organization, but local checks ran.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Advance mocked `Date.now()` per call in the held-lock test | Frozen clock or advancing clock | A frozen clock never reached the harness lock deadline; advancing time let the test finish quickly while the lock payload remained fresh (`harness-proposal-store.service.spec.ts:114-124`). | Yes |
| Spy on the underlying `fs/promises` module for rename | Namespace import or underlying module | The namespace import's getter cannot be spied on in Jest; the underlying module is used by the compiled import (`harness-proposal-store.service.spec.ts:165-174`). | Yes |
| Leave the harness-sync owner race to FU-1 | Change harness-sync or stay within Batch 16 | Batch boundary permits only five source/spec files and explicitly records FU-1 (`batches.md:376-377,432-476`). | Yes |

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/types/rpc/rpc-harness.schemas.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/merge-harness-config-updates.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/shared/src/lib/utils/merge-harness-config-updates.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-16-report.md`

The `ptah_get_diagnostics` attempt reported TypeScript checking unavailable after 45 seconds and 7,211 unchecked files. The scoped Nx typecheck targets passed before the test corrections; neither source file changed after that run.
