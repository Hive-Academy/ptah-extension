# Cross-vendor review — TASK_2026_318

Date: 2026-08-28
Reviewer: `codex` CLI agent (independent, no shared context)
Test runner: `ollama cloud` Ptah CLI agent (independent)
Orchestrated from the Ptah session as Round 1, Batch B.

## Verdict

**PARTIAL.** The stated defect is fixed. Two adjacent defects remain, both
recorded as follow-up TASK_2026_332.

## The stated defect is fixed

`CodeExecutionMCP` was a second, unlocked writer on `.mcp.json`. Both
read-modify-write operations are now inside `withMcpConfigLock`:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:299-317` — register
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts:353-370` — unregister

Raw `fs.readFileSync` and `fs.writeFileSync` calls still appear at `:305`,
`:316`, `:356` and `:368`. All four now sit inside the critical section, so they
are correct.

### Complete census of `.mcp.json` accessors outside `harness-sync`

| File                                                                                       | Access                     |
| ------------------------------------------------------------------------------------------ | -------------------------- |
| `libs/backend/vscode-lm-tools/.../http-mcp-server.service.ts:305,316,356,368`              | read and write, all locked |
| `libs/backend/vscode-lm-tools/.../namespace-builders/harness-namespace.builder.ts:811-814` | read only                  |
| `libs/backend/rpc-handlers/src/lib/harness/io/harness-fs.service.ts:237-239`               | read only                  |

No unlocked writer remains.

### The deadlock question

The lock is **not** re-entrant. `libs/backend/harness-sync/src/lib/targets/mcp/mcp-config-lock.ts:63-71`
and `libs/backend/harness-sync/src/lib/lock/file-lock.ts:80-95` implement a keyed
promise queue with no ownership tracking, so nesting the same path would
deadlock. The Electron calls are **not** nested: `http-mcp-server.service.ts:101-110`
and `apps/ptah-electron/src/activation/wire-runtime.ts:268-304` start independent
operations that queue behind each other. No deadlock exists today.

`propagateHarness` is still un-awaited at `wire-runtime.ts:302`. Its failures are
caught at `apps/ptah-electron/src/activation/plugin-activation.ts:457-472`, and
the lock removes the lost-update consequence, so this is now benign.

## Two open findings — moved to TASK_2026_332

1. **Fire-and-forget workspace re-pointing has no operation-level queue.**
   `http-mcp-server.service.ts:101-110`, `:201-210`, `:318-319`, `:343-372`.
   Rapid A→B→C workspace changes can make two operations both capture A, then
   independently write B and C, stranding a live `ptah` entry in B. A `stop()`
   arriving immediately after a switch can finish unregistering A while an
   outstanding event writes B back with a dead port. The per-file lock does not
   help here, because the two writes target different files.

2. **The lock proceeds unlocked after its timeout.**
   `mcp-config-lock.ts:48-70` and `file-lock.ts:187-215`. After two seconds of
   cross-process contention, acquisition returns `UNLOCKED` and the mutation
   runs anyway. A slow Electron and VS Code overlap therefore reintroduces the
   original lost-update failure this task set out to remove. The bound is a
   liveness choice, so the fix is a decision about what to do on timeout, not a
   longer timeout.

## Verification

`@ptah-extension/vscode-lm-tools` — 43/43 suites, 871/871 tests, 0 failed.
`@ptah-extension/harness-sync` — 39/39 suites, 314/314 tests, 0 failed.
`typecheck` passed for all six projects in the batch.

## Test gaps recorded (carried into TASK_2026_332)

- `http-mcp-server.service.spec.ts` — exercise rapid A→B→C changes, and a switch
  immediately followed by `stop()`, with a deliberately deferred lock. Assert no
  intermediate or stopped workspace retains a `ptah` entry.
- `http-mcp-server.service.spec.ts:99-102` — the lock is replaced by a
  straight-through mock. Add a real-lock concurrency test proving a simultaneous
  harness mutation and `CodeExecutionMCP` mutation preserve both writers' keys.
- `http-mcp-server.service.spec.ts:613-629` — the unregister test only asserts
  that the lock was called. It should assert the read and the write happen inside
  the critical section, as the register test does at `:594-610`.

## Outcome

Status moved `in_review` → `done`. Residual findings live in TASK_2026_332.
