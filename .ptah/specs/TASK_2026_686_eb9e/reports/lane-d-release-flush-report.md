# Lane D: release flush review

## Finding

Valid. `MessageDispatchService` compared `sendLock.state()` snapshots inside an Angular effect. A lock release followed by another state change before the effect ran could leave an idle tab's `queuedContent` unsent.

## Change

- `CommandCenterSendLockService` now exposes `onRelease(listener)` with an unsubscribe function. It emits the released root ID after an owner release, a matching `clearForRoot`, or `engage` replacing a lock for a different root. No-op operations emit nothing.
- `MessageDispatchService` subscribes during construction and unsubscribes through `DestroyRef`. Its listener waits one microtask, then rechecks the lock, queued content, and busy state before calling `sendQueuedMessage`. A pending microtask also skips work after service destruction.
- Lock specs cover each release path, wrong-token and unmatched-root no-ops, same-root engage, and unsubscribe. Dispatch specs cover same-tick queue/release and release/re-engage. The two existing release specs now await the microtask explicitly.

## Checks

- Chat-state Jest: 1 suite passed, 8 tests passed.
- Chat Jest: 1 suite passed, 6 tests passed.
- The first chat-state command could not filter output because `grep` is absent in PowerShell; its `Select-String` replacement passed. The first chat run had one old timing assertion failure; after updating that assertion to await the microtask, the scoped suite passed.
- `ptah_get_diagnostics` was called after edits and retried once. Both calls timed out after 45 seconds with all four files unchecked, so no TypeScript diagnostic result is available.

## Files changed

- `libs/frontend/chat-state/src/lib/command-center-send-lock.service.ts`
- `libs/frontend/chat-state/src/lib/command-center-send-lock.service.spec.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.command-center-lock.spec.ts`

## Decisions

- Emit notifications synchronously after the lock state changes; defer only the dispatch flush. This preserves every release transition while allowing same-tick re-engagement to suppress a flush. Reversible: yes.
- Skip a queued microtask after service destruction as well as unsubscribe future notifications. This avoids work from an already scheduled callback after teardown. Reversible: yes.
