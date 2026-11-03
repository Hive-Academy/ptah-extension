# Batch B fixes

## Files changed

- `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`
- `libs/frontend/chat/src/lib/services/session-auto-handoff-coordinator.service.spec.ts`

## Findings fixed

1. Retry gates now schedule one timer for the earliest pending gate. It is rescheduled as gates change, wakes the coordinator effect through a signal, and is cancelled on service destruction.
2. Dispatch reports flush outcomes for a specific queued slash-command head. A failed flush releases the fired claim and counts the failure. The coordinator waits while that head remains queued; a later successful flush reclaims the session so it cannot send a duplicate.
3. The coordinator gives up when the fifth attempt fails (`>= MAX_FAILED_ATTEMPTS`).

## Tests added or adjusted

- Fake-timer regression for a transient probe failure retrying after five seconds with no tab update.
- Streaming queue-head flush failure regression, including no duplicate send while restored text remains queued and after a later successful flush.
- Five-failure assertion now checks the exact probe count.

## Verification

- `npm run verify -- -p chat`: **exit 1**. It waited for the memory lock, acquired slot 1 after 44 seconds, then Nx failed to load its default and ESLint/Jest plugins because child-process spawn returned `EPERM`.
- Fallback `node ../../node_modules/jest/bin/jest.js --config libs/frontend/chat/jest.config.ts src/lib/services/session-auto-handoff-coordinator.service.spec.ts --runInBand --coverage=false`: **exit 1**. Suite could not start because esbuild child-process spawn returned `EPERM`; zero tests ran.
- `ptah_get_diagnostics` after edits: TypeScript check remained unavailable after 45 seconds; changed files were unchecked.

## Decisions

- Keep the failed queue-head identity until it leaves the queue, then allow the normal retry gate to send. This is reversible and follows `ConversationService.isQueuedCommand`, which already distinguishes the exact queued entry from identical text.
