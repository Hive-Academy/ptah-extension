# Context — TASK_2026_332

## Where this came from

The cross-vendor review of TASK_2026_318 on 2026-08-28. An independent `codex`
reviewer verified that every `CodeExecutionMCP` write on `.mcp.json` now sits
inside `withMcpConfigLock`, and produced a complete census of `.mcp.json`
accessors outside `harness-sync`. That part passed. The two defects below are
adjacent to the fix rather than part of it, so they were split out instead of
holding TASK_2026_318 open.

Full review: `.ptah/specs/TASK_2026_318/cross-vendor-review.md`.

## Defect 1 — re-pointing has no operation-level queue

TASK_2026_315 A3 (commit `3cfba7b`) added a `workspaceFoldersSubscription` so
the second workspace actually receives a `ptah` entry. That was the correct fix
for a real defect. It also made re-pointing asynchronous and fire-and-forget.

Sites:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:101-110`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:201-210`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:318-319`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:343-372`

Two failure scenarios:

1. The user changes workspace A to B to C quickly. Two operations both read the
   current workspace as A. They then write B and C independently. A live `ptah`
   entry is stranded in B, pointing at a server that no longer serves B.
2. `stop()` arrives immediately after a switch. The stop finishes unregistering
   A while an outstanding event writes B back, and the entry in B carries a dead
   port.

`withMcpConfigLock` cannot fix either one. The lock is keyed per file, and the
racing writes target different files. What is missing is a queue over the
re-pointing OPERATION, so that only the last requested workspace wins and a
`stop()` cancels anything still in flight.

## Defect 2 — the lock proceeds unlocked after its timeout

- `libs/backend/harness-sync/src/lib/targets/mcp/mcp-config-lock.ts:48-70`
- `libs/backend/harness-sync/src/lib/lock/file-lock.ts:187-215`

`acquireFileLock` retries with exponential backoff until `maxWaitMs`. On expiry
it returns `UNLOCKED`, and `withFileLock` runs the task anyway. Under
cross-process contention lasting more than two seconds — Electron and a VS Code
host reconciling the same workspace — both processes proceed unlocked and the
original lost-update failure returns.

This is a deliberate liveness choice. Blocking forever on a stale lock is worse
than a rare lost update, which is why the bound exists. So the fix is a decision,
not a constant:

- Fail the mutation and report it, instead of writing unlocked.
- Or write unlocked but log at WARN with the file and the wait duration, so a
  lost update leaves a trace.
- Or re-read and merge after the unlocked write, making the write idempotent per
  key rather than last-writer-wins.

Pick one deliberately. Silently writing unlocked is the only option that must not
survive.

## Verification

Both defects need tests, and the current spec cannot express them:
`http-mcp-server.service.spec.ts:99-102` replaces the lock with a
straight-through mock, so no concurrency is exercised at all.

Test gaps carried from the review:

1. Rapid A to B to C changes, and a switch immediately followed by `stop()`,
   both with a deliberately deferred lock. Assert no intermediate or stopped
   workspace retains a `ptah` entry.
2. A real-lock concurrency test proving a simultaneous harness mutation and
   `CodeExecutionMCP` mutation preserve both writers' keys.
3. `http-mcp-server.service.spec.ts:613-629` — the unregister test only asserts
   that the lock was called. Assert the read and the write happen inside the
   critical section, as the register test does at `:594-610`.

## Scope boundary

Do not change the refusal behaviour of the reconciler, and do not give
`.mcp.json` a second owner. The design note in `libs/backend/harness-sync/CLAUDE.md`
stands: one writer, one lock.
