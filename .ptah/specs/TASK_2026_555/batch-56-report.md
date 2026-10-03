# Batch 56 — Settings RPC failure text and harness test isolation

Implemented A1, A2, B and C in the assigned worktree. Both requested Nx commands passed, with no cache hits. No dispatcher, shared types, resolver product code or external temporary folder was modified.

## A1 — ptahCli:list

- `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts:114`: retain `reportFailure`, then throw `RpcUserError('Could not load the CLI agents.', 'PERSISTENCE_UNAVAILABLE')`. The existing code denotes unavailable persisted registry data; the dispatcher already treats this error's text as public.
- `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.spec.ts:277`: changed **returns fixed public text at the RPC boundary for registry errors** to inject a secret-like error and assert fixed public text with neither the original message nor key in the RPC envelope.
- Same spec, `:723`: extended **%s logs and captures the error type only** to assert secret-like text is also absent from each result. Existing diagnostics assertions include Error messages and stacks.
- Verification: project typecheck, lint and test targets PASS.

## A2 — auth:testConnection

- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1160`: remove stale health error text from the available response.
- Same file, `:1177`: replace SDK health error text with **Could not test the connection.** in both nested health and top-level errorMessage. Preserve the existing **Connection test timed out** fallback when no health error exists. SDK health can contain raw exception messages (`sdk-agent-adapter.ts:539`), so sanitizing only the catch would leave a second leak.
- Same file, `:1194`: catch `unknown`, log only the error type, capture a newly constructed type-only diagnostic to Sentry, and return `{ success: false, health: null, errorMessage: 'Could not test the connection.' }`.
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts:1506`: added **keeps secret-like SDK error text out of results, logs and Sentry (%s)** for an initial throw, error health, available health with stale error text, and a throw on the final health read. Diagnostic assertions serialize Error messages and stacks (`:468`).
- Same spec, `:1595`: strengthened **returns failure with a timeout message after exhausting retries** to assert the unchanged exact timeout copy when SDK health has no error text.
- Verification: project typecheck, lint and test targets PASS.

## B — auth:setApiKey clear failures

- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1383`: catch `unknown` and replace raw logger/Sentry exceptions with type-only diagnostics. At `:1393`, empty or whitespace-only keys receive **Could not delete the stored key.**; nonblank key writes retain **Could not save the API key.**
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts:1821`: **returns fixed text and never the key or path when %s fails** covers saving, clearing an empty key and clearing a whitespace-only key. Each asserts the appropriate text and absence of secret/path data from results, logs and Sentry.
- Verification: project typecheck, lint and test targets PASS.

## C — harness spec isolation

- `libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.spec.ts:44`: create the temporary workspace's own `.ptah` marker instead of `.git`. The resolver scans all ancestors for `.ptah` before checking `.git` (`libs/backend/harness-sync/src/lib/workspace/workspace-root.ts:80`), so a local `.git` does not isolate this fixture.
- Same spec, `:102`: **never writes state.json — a derived decision is not a write** now explicitly asserts the resolver returns the newly created workspace before verifying the derived read leaves state.json absent. The shared fixture isolates the other tests in this file too.
- Verification: the complete project test target PASS, including this spec. A read-only `Test-Path` confirmed `%TEMP%/.ptah/harness` still exists. It was never deleted or modified by this work; fixture cleanup remains limited to the test's tracked temporary directories.

## Verification

| Command | Observed result |
| --- | --- |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers` | PASS, exit 0: `Successfully ran targets typecheck, lint for project @ptah-extension/rpc-handlers`; both tasks succeeded, 0/2 cache hits. |
| `npx nx run-many -t test -p @ptah-extension/rpc-handlers -- --maxWorkers=2` | PASS, exit 0: `Successfully ran target test for project @ptah-extension/rpc-handlers`; 0/1 cache hits, 1m 22s. No failures reported. Nx suppressed successful Jest output, so individual suite/test totals are not claimed. |
| `npx prettier --write` on the three changed spec files only | PASS, exit 0. |
| `ptah_get_diagnostics` scoped to all five changed TypeScript files | Unavailable: compiler check exceeded the tool's 45-second window; the tool reported five files unchecked. The explicit Nx typecheck subsequently passed. |

Nx emitted a non-blocking cloud warning: the organization is disabled for exceeding its free plan (401). Both commands nevertheless completed with exit 0 and successful local targets.

## Stack and conventions observed

This is the Node/TypeScript RPC handler library, not a Nest HTTP service. Root `package.json` specifies Node 24; the library manifest declares tsyringe 4 and Zod 4. Existing constructors use tsyringe token injection, and methods register through RpcHandler. `auth-rpc.schema.ts` contains the existing Zod boundary schemas. `project.json` declares Nx Jest, typecheck and lint targets; `jest.config.ts` uses ts-jest in a Node environment. Changes preserve existing wiring and validation contracts. `CONVENTIONS.md` sections 3, 7 and 8 and `eslint.config.mjs` supply barrel, error-boundary and dependency rules.

## Anything not done / deviations

- No requested item remains unimplemented.
- Handler-wide formatting was not run. Committed-version Prettier checks require git; the backend role prohibits running git, so no git commands were used. Handler edits were kept local. Only spec files were passed to Prettier.
- The scoped diagnostics tool did not finish within its window; its result is not represented as a pass. Required Nx verification passed independently.
- No broader dispatcher migration or unrelated follow-up was attempted. No shared contract changes were needed.

## Full list of files written

1. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\ptah-cli-rpc.handlers.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.spec.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\ptah-cli-rpc.handlers.spec.ts`
5. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\harness\selection\harness-skill-selection-rpc.service.spec.ts`
6. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\batch-56-report.md`

## Revision 1 (review findings 1, 3, 4)

### Finding 1 — nullable health contract

- `libs/shared/src/lib/types/rpc/rpc-auth.types.ts:50`: `AuthTestConnectionResponse.health` now permits `null`, matching the handler's caught-failure response. This is the one shared-file change explicitly authorized for this revision.
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1146`: the registered method now uses the shared `AuthTestConnectionResponse` instead of an inline `health: unknown` response.
- Checked consumers at `libs/frontend/core/src/lib/services/auth-state.service.ts:714`, `apps/ptah-cli/src/cli/commands/auth.ts:679`, and `apps/ptah-cli/src/cli/commands/init.ts:493`. They inspect success/error text or forward the response; none dereferences health. No consumer source edits were necessary. All four requested projects passed typecheck.

### Finding 3 — status-based final-read copy

- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.ts:1185`: top-level errorMessage depends exclusively on final SDK status: `error` returns **Could not test the connection.**, other non-available statuses return **Connection test timed out**, and `available` returns no errorMessage. The nested health errorMessage retains its existing fixed-text-or-undefined handling; SDK text never becomes public text.
- `libs/backend/rpc-handlers/src/lib/handlers/auth-rpc.handlers.spec.ts:1505`: added **reports an SDK error without a message as a connection failure, not a timeout**. It asserts the fixed connection-failure text and undefined nested health errorMessage. Existing tests cover an SDK error with text, successful health, thrown errors and initialization timeout.

### Finding 4 — preserve deliberate public errors

- `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts:115`: after `reportFailure`, rethrow existing `RpcUserError` instances unchanged. Other exceptions retain the generic fixed-text `PERSISTENCE_UNAVAILABLE` conversion.
- `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.spec.ts:278`: added **preserves an existing public RpcUserError after reporting the failure**. It asserts exact thrown-object identity, type-only logging, a Sentry capture, and preservation of the public message and `AUTH_REQUIRED` code in the RPC envelope. The existing raw-error redaction regression remains in place.

### Revision verification

- PASS, exit 0: `npx nx run-many -t typecheck,lint -p @ptah-extension/rpc-handlers @ptah-extension/shared @ptah-extension/core ptah-cli`. Observed: **Successfully ran targets typecheck, lint for 4 projects**; all eight tasks succeeded, 0/8 cache hits.
- PASS, exit 0: `npx nx run-many -t test -p @ptah-extension/rpc-handlers @ptah-extension/shared -- --maxWorkers=2`. Observed: **Successfully ran target test for 2 projects**. No failures reported; successful Jest suite/test counts were suppressed by Nx and are not claimed. The run was not repeated.
- PASS: Prettier write on the two changed handler spec files only. No handler-wide formatting or git commands were run.
- Scoped `ptah_get_diagnostics` returned unavailable after its 45-second compiler window, with five files unchecked; this is not claimed as a pass. The required Nx typechecks passed independently.
- Nx Cloud reported its non-blocking disabled-organization/free-plan warning (401) during static checks and a cloud warning during tests. Both commands completed successfully with exit 0.

### Scope and updated changed-file list

Exactly review findings 1, 3 and 4 were addressed. Review finding 2 (CLI exit-code semantics) remains an out-of-scope follow-up; no CLI behavior was changed. No consumer edits were required. The previously isolated harness spec is unchanged in this revision.

Full cumulative Batch 56 file list (six files written again or newly in this revision, plus the earlier harness spec):

1. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\ptah-cli-rpc.handlers.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\auth-rpc.handlers.spec.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\handlers\ptah-cli-rpc.handlers.spec.ts`
5. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\shared\src\lib\types\rpc\rpc-auth.types.ts`
6. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\.ptah\specs\TASK_2026_555\batch-56-report.md`
7. `D:\projects\ptah-extension\.claude-worktrees\task-555-settings-redesign\libs\backend\rpc-handlers\src\lib\harness\selection\harness-skill-selection-rpc.service.spec.ts` — earlier batch only.
