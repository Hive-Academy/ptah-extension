# Batch 4 report

## Task 4.1 — proposal store

Implemented `HarnessProposalStore` with the `IHarnessProposalStore` save/get contract. It uses the host `WORKSPACE_PROVIDER` root for reads and writes, hashes the session ID for the filename, validates disk records with `HarnessProposalSchema`, checks stored session and root identity, merges updates with `mergeHarnessConfigUpdates`, and writes through a temp file and rename. A missing workspace throws `HarnessProposalWorkspaceError`. Invalid records are logged and treated as absent. Access prunes valid records whose `updatedAt` is over 30 days old, with prune failures logged without failing the request.

R6: a static per-file promise queue serializes writes in one process; a bounded `wx` lock serializes processes. The store re-reads after lock acquisition, recovers expired locks, rejects on lock timeout, and releases its lock in `finally`.

R7: both paths use `PLATFORM_TOKENS.WORKSPACE_PROVIDER.getWorkspaceRoot()`; no caller root or session workspace resolver is used.

Task 1.2 deviation: the stored `configUpdates` is the merged, normalized output of `mergeHarnessConfigUpdates`, then the complete record is parsed with `HarnessProposalSchema` before writing. The read-back test pins this behavior.

## Task 4.2 — tests

Added a real temp-directory spec covering concurrent partial writes, sequential merge, session isolation, restart read-back, corrupt and mismatched records, retention, held and stale locks, missing workspace, and normalized record round-trip. Focused command:

`npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts --coverage=false --maxWorkers=2`

Result: `Test Suites: 1 passed, 1 total`; `Tests: 12 passed, 12 total`.

## Task 4.3 — registration

Registered `HarnessProposalStore` under `PLATFORM_TOKENS.HARNESS_PROPOSAL_STORE` in `registerHarnessServices`, beside the config store. Exported it from the config barrel, which exports its sibling store. R8: `di-lint OK: 1823 @inject sites all resolve to a registered token (792 tokens)`.

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/config/index.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/libs/backend/rpc-handlers/src/lib/harness/di.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-647-setup-hub-chat-sessions/.ptah/specs/TASK_2026_652_7284/batch-4-report.md`

## Verification

Required project-scoped command: `npx nx run-many -t typecheck,test,lint -p @ptah-extension/rpc-handlers --parallel=1 && npx nx run di-lint:lint`. Nx reported `Running targets typecheck, test, lint for project @ptah-extension/rpc-handlers failed`, confirming exactly one project. Test summary: `Test Suites: 77 failed, 74 passed, 151 total`; `Tests: 5 skipped, 2147 passed, 2152 total`. The 77 suite failures reported Jest `Configuration error` / `createNoMappedModuleFoundError` before test execution. Because the command stopped at the test failure, its chained lint and DI lint did not run in that invocation.

Separate scoped checks: `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1` passed; `npx nx lint @ptah-extension/rpc-handlers --parallel=1` passed with 0 errors and 50 warnings; `npx nx run di-lint:lint` passed with the registration result above. No workspace-wide command was run.

## Not done

- The complete project test target did not pass because 77 suites fail on Jest module mapping configuration. The new focused spec passes. No unrelated Jest configuration was changed.
