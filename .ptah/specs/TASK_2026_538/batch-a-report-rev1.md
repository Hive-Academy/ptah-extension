## Changes

All paths are relative to `D:/projects/ptah-extension/.claude-worktrees/cursor-key-secrets`.

- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:319` — R1: only `setProviderKey` / `deleteProviderKey` are wrapped by the credential-safe catch. It logs a fixed message and returns `Failed to update the Cursor API key`. Plain-setting removal still follows successful secret storage. The outer catch (`:398`) again logs the original Error and returns its message for other failures.
- `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.set-config.spec.ts:237` and `:264` — covers credential-bearing failures in both secret operations, preserved plain settings on failure, and a workflows.disabled failure in a request that also successfully writes the Cursor key.
- `libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.ts:14` — R2: only undefined and the empty string return `none` without writes. Whitespace-only strings and non-string values are removed and return `cleared`, without calling any secret API. Valid migration and existing-secret behavior are preserved.
- `libs/backend/rpc-handlers/src/lib/migrations/cursor-api-key-migration.spec.ts:80` — updates empty/invalid-value expectations and verifies cleanup, untouched existing secrets, outcome-only logging, and idempotency for invalid leftovers.
- `.ptah/specs/TASK_2026_538/batch-a-report-rev1.md` — this revision report.

The secret-store catch deliberately uses an unbound catch clause: its error details are discarded to prevent credentials reaching logs or the RPC response. The outer bound catch remains `catch (error: unknown)`. All four edited TypeScript files use LF. No Batch B/C file was edited; no Git commands were run.

## Tests

- `keeps the plain copy and hides credential-bearing %s errors` — parameterized for both setProviderKey and deleteProviderKey; exact redacted response, fixed logger call, no secret in logger calls, and no plain-setting write.
- `preserves unrelated field errors in a request that also updates the Cursor key` — workflows.disabled fails after successful secret storage and plain-setting removal; response preserves the unrelated message and logger receives the original Error object.
- `returns none without writes for %p` — empty string only; separate absent-setting test remains.
- `clears invalid plain value %p without touching secrets` — whitespace-only string, null, number, boolean, and object; preserves an existing secret, logs only `cleared`, and returns `none` on the second run without another write.
- Existing #581 field-names-only logging, status-read, valid migration, existing-secret preservation, and migration-failure regressions remain.

## Not changed

- Finding 1: migration is awaited before RPC exposure in VS Code (`bootstrap.ts:109` before `:157`), before the command body in CLI (`with-engine.ts:321` before `:396`), and before workspace/window restore in Electron (`bootstrap.ts:218` before `:297`); existing Batch C startup ordering addresses the reported RPC race.
- Finding 4: missing AgentRpcHandlers coverage in application DI smoke specs is a pre-existing gap and remains outside this revision.

## Verification

Command: `npx nx run-many -t test lint typecheck -p @ptah-extension/rpc-handlers --skip-nx-cache`.

Only the rpc-handlers project was selected. PowerShell preserved the exit code and filtered the header/results plus the final 30 lines. Observed exit code: **0**. Run duration: **1m 30s**, cache skipped.

```text
NX   Running targets test, lint, typecheck for project @ptah-extension/rpc-handlers:
√  nx run @ptah-extension/rpc-handlers:typecheck
√  nx run @ptah-extension/rpc-handlers:test
√  nx run @ptah-extension/rpc-handlers:lint
NX   Successfully ran targets test, lint, typecheck for project @ptah-extension/rpc-handlers
```

Nx suppressed detailed output from its three successful tasks, so no test count is claimed. The command ran once; no voice-rpc.handlers failure occurred and no individual-spec rerun was needed.

`ptah_get_diagnostics` was called with only the four changed TypeScript paths. It reported `Unavailable — TypeScript check still running after 45s`; this is not claimed as a pass. The completed scoped Nx typecheck above passed.

## Lane-introduced constraints

none
