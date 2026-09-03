# Batch B5 Report — `pendingTaskIds` Buffer

## Files changed

1. `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.ts`
   - Added `private readonly pendingTaskIds` map (`toolCallId` → `{ taskId, at }`).
   - Added `markPendingTaskId(toolCallId, taskId)`.
   - Added single-consume `consumePendingTaskId(toolCallId): string | undefined`.
   - Cleared the map in `clear()`.
   - Evicted stale entries in `cleanupExpired()` using the existing `TTL_MS` constant and `lazyCleanup()` cadence.

2. `libs/backend/vscode-core/src/services/subagent-registry.service.ts`
   - In `setTaskId`, when the record is absent, buffered the taskId via `store.markPendingTaskId()` and kept the debug log with a `buffered: true` field.
   - In `register()`, consumed a buffered taskId when `registration.taskId` was absent, and spread `...(taskId ? { taskId } : {})` onto the record literal.

3. `libs/backend/vscode-core/src/services/subagent-registry/subagent-state-store.pending-task-id.spec.ts` (created)
   - Added five assertions that cover the buffer contract.

## Spec assertions

1. `setTaskId` before `register` writes the taskId onto the registered record and logs `buffered: true` at debug level.
2. The buffer is single-consume: a second `register` with the same `toolCallId` gets no taskId.
3. `registration.taskId` wins over a buffered value.
4. A pending taskId older than `TTL_MS` is removed by `lazyCleanup()`.
5. Normal order (`register` then `setTaskId`) writes the taskId directly and does not buffer anything.

## Verification results

- **Test**: `npx nx run-many -t test -p @ptah-extension/vscode-core` — 27 suites passed, 481 tests passed.
- **Lint**: `npx nx run-many -t lint -p @ptah-extension/vscode-core` — 0 errors, 11 warnings (all pre-existing, none in changed files).
- **Typecheck**: `npx nx run-many -t typecheck -p @ptah-extension/vscode-core` — passed.

## Deviation from plan

One intentional expansion: `cleanupExpired()` includes `pendingIdsRemoved` and `remainingPendingIds` in its existing info log object so the TTL sweep is visible alongside the existing registry and cleared-ID sweeps. No other behaviour differs from section 12.

## Left undone

Nothing.

DONE: B5 — added pendingTaskIds buffer with TTL sweep and pinned it with five specs, all tests/lint/typecheck green.
