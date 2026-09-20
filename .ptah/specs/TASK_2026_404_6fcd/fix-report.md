## Summary

1. FIXED — moved chat/grid selection after the workspace switch in `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.ts`; updated `notification-focus-coordinator.service.spec.ts`.
2. FIXED — treated both `null` and `undefined` terminal reasons as non-terminal in `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts`; updated `compact-session-summary.spec.ts`.
3. FIXED — replaced every corrupted compact-session glyph with a Unicode escape in `compact-session-summary.ts` and `compact-session-stats.component.ts`; updated both corresponding specs. A signature scan of both compact-session folders found no remaining mojibake matches.
4. FIXED — made suspended `AudioContext` recovery non-blocking and replay the burst after `resume()` in `libs/frontend/notification-center/src/lib/notification-sound.service.ts`; updated `notification-sound.service.spec.ts`.
5. FIXED — allowed a valid closed-session identity to continue through canvas reopening in `notification-focus-coordinator.service.ts`; updated `notification-focus-coordinator.service.spec.ts`.
6. FIXED — replaced the coalescing single-value terminal pulse with a FIFO queue in `libs/frontend/chat-state/src/lib/tab-manager.service.ts` and drained it in `libs/frontend/notification-center/src/lib/notification-center.store.ts`; updated both specs.
7. FIXED — made `unreadCount` count rendered prompt sources once, including unavailable prompts, while retaining completion dedupe/dismissal semantics in `notification-center.store.ts`; updated `notification-center.store.spec.ts`.
8. FIXED — closed the panel after successful activation and exposed a keyboard-reachable, labelled completion dismiss button in `notification-center.component.ts`; updated `notification-center.component.spec.ts`.

## Defect 6 — finding

I first added `records two terminal turns emitted in one synchronous batch` in `notification-center.store.spec.ts`. Against the original single-value signal, the focused test failed: the expected ledger contained `session-1` and `session-2`, while the received ledger contained only `session-2`. This proved that Angular effect coalescing dropped the first completion.

I therefore changed `TabManagerService` to append terminal pulses to a readonly queue signal and added `takeTerminalTurnPulses()` to drain it. `NotificationCenterStore` now drains every queued pulse in order. The store regression and an additional producer-side test that synchronously finishes two sessions both pass.

## Tests added

- `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts:70` — defect 1: workspace switch happens before chat/grid view mutation and canvas focus.
- `libs/frontend/chat/src/lib/services/notification-focus-coordinator.service.spec.ts:88` — defect 5: a valid session with no open tab reaches canvas reopening with no stale tab id.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts:177` — defect 2: `terminalReason: null` selects the idle tone.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.spec.ts:183` — defect 3: compaction and completion icons equal the exact expected Unicode characters.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.spec.ts:26` — defect 3: missing cost renders the exact em dash.
- `libs/frontend/notification-center/src/lib/notification-sound.service.spec.ts:105` — defect 4: a context suspended after initial playback resumes and plays the next burst.
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts:147` — defect 6: two same-batch terminal pulses both reach the ledger.
- `libs/frontend/chat-state/src/lib/tab-manager.notification-pulse.spec.ts:135` — defect 6: two synchronous turn completions remain queued in order and drain exactly once.
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts:211` — defect 7: unavailable and two-tab fan-out prompts each contribute exactly one unread item.
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts:230` — defect 7: a dismissed completion contributes zero unread items.
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts:242` — defect 7: the same session/revision completion contributes one unread item.
- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts:158` — defect 8: successful completion and prompt activation each close the panel.
- `libs/frontend/notification-center/src/lib/notification-center.component.spec.ts:201` — defect 8: each completion exposes a keyboard-reachable dismiss button with an accessible label.

## Verification

`npx nx run-many -t test -p @ptah-extension/notification-center @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas --skip-nx-cache`

```text
NX   Running target test for 7 projects:
- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/canvas

notification-center: 3 suites passed; 20 tests passed
chat-state: 19 suites passed; 403 tests passed
chat-streaming: 24 suites passed; 506 tests passed, 1 skipped
core: 30 suites passed; 727 tests passed
chat: 86 suites passed; 1326 tests passed, 2 skipped
chat-ui: 29 suites passed; 201 tests passed
canvas: 9 suites passed; 162 tests passed

Aggregate: 200 suites passed; 3345 tests passed, 3 skipped (3348 total)
NX   Successfully ran target test for 7 projects
```

The successful Jest run also printed existing worker-force-exit/open-handle warnings for several projects; no suite or test failed.

`npx nx run-many -t typecheck -p @ptah-extension/notification-center @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas --skip-nx-cache`

```text
NX   Running target typecheck for 7 projects:
- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/canvas

NX   Successfully ran target typecheck for 7 projects
```

`npx nx run-many -t lint -p @ptah-extension/notification-center @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas --skip-nx-cache`

```text
NX   Running target lint for 7 projects:
- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/canvas

35 existing warnings, 0 errors
NX   Successfully ran target lint for 7 projects
```

`npx nx run degradation-audit:lint --skip-nx-cache`

```text
degradation-audit: scanned 2880 file(s)
degradation-audit: TOTAL 302 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

## Not fixed

None.
