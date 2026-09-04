# Batch C2 — durable session removal before agent output deletion

## Defect and Root Cause

In `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`, `_deleteInternal(sessionId)` removed a session by staging the filtered session list and immediately deleting the session's per-agent output keys:

```ts
if (filtered.length !== all.length) {
  this.stage(filtered);
  for (const record of removed) {
    for (const ref of record.cliSessions ?? []) {
      await this.deleteAgentOutput(ref.agentId);
    }
  }
  ...
}
```

Because `this.stage(filtered)` only mutates the in-memory snapshot (`this.pendingAll`), the session deletion was not yet durable in storage when `deleteAgentOutput(ref.agentId)` ran. If a subsequent storage write failed during flush, the session record survived in storage while its `cliSessions` references now pointed to deleted `ptah.agentOutput:*` storage keys. This caused CLI agent cards to permanently lose output with no way to recover.

## What Was Changed and Why

1. In `libs/backend/agent-sdk/src/lib/session-metadata-store.ts`:
   - Updated `_deleteInternal` to call `await this.flush()` immediately after `this.stage(filtered)` and before iterating over `removed` records to delete output keys via `this.deleteAgentOutput(ref.agentId)`.
   - Verified that `flush()` does not enqueue onto `writeQueue`, preventing deadlocks when called inside `enqueueWrite`.
   - Verified that `enqueueWrite` propagates rejection from `flush()` up to the caller of `store.delete(sessionId)`. If the flush rejects, execution halts before `deleteAgentOutput` is called, ensuring no output keys are deleted when the session record survives in storage.
   - Documented the rationale and the intentional trade-off (one forced `storage.update` instead of riding the write queue's coalesced write for rare, destructive delete operations).

2. In `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts`:
   - Added unit test asserting that failing the metadata flush preserves the per-agent output keys, leaves the storage key untouched (never written to `undefined`), and propagates the rejection to the caller.
   - Added unit test asserting the exact ordering of `storage.update` calls on the happy path: the metadata key (`ptah.sessionMetadata`) is written to storage before the per-agent output key (`ptah.agentOutput:*`) is deleted.
   - Verified that existing delete tests continue to pass.

## Tests Added

In `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts` under `describe('bulk agent output')`:

- `keeps the per-agent output keys when the session list deletion flush fails`
- `makes session list durable before deleting per-agent output keys`

## Verification

### 1. Unit Tests

`npx nx run @ptah-extension/agent-sdk:test --skip-nx-cache` — **PASS (exit 0)**

```text
Test Suites: 1 skipped, 82 passed, 82 of 83 total
Tests:       1 skipped, 1356 passed, 1357 total
Snapshots:   0 total
Time:        14.175 s, estimated 28 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

### 2. Typecheck and Lint

`npx nx run-many -t typecheck lint -p @ptah-extension/agent-sdk --skip-nx-cache` — **PASS (exit 0)**

```text
 NX   Running targets typecheck, lint for project @ptah-extension/agent-sdk:

- @ptah-extension/agent-sdk



> nx run @ptah-extension/agent-sdk:typecheck

> tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json


> nx run @ptah-extension/agent-sdk:lint

Linting "@ptah-extension/agent-sdk"...

✖ 38 problems (0 errors, 38 warnings)

 NX   Successfully ran targets typecheck, lint for project @ptah-extension/agent-sdk
```

All 38 problems are pre-existing linter warnings in files outside this batch (0 errors).

No Git commit was created; changes remain in the working tree.
