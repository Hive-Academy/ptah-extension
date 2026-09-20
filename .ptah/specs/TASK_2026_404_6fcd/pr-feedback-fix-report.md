## Summary

1. FIXED — `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`, `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-stats.component.ts`, and `libs/frontend/notification-center/src/lib/notification-center.component.ts` now use `text-base-content-muted` for all six real-text offenders.
2. FIXED — `libs/frontend/notification-center/src/lib/notification-center.component.ts`, `notification-center.store.ts`, `notification-center.component.spec.ts`, and `notification-center.injector.spec.ts` scope the store to the component and pin the production injector topology.
3. FIXED — `libs/frontend/notification-center/src/lib/notification-center.store.ts` and `notification-center.injector.spec.ts` clear and republish identical live-region announcements across isolated bursts.
4. FIXED — `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts` and `.spec.ts` memoize the message-derived cost calculation by messages-array reference while preserving the existing output.
5. FIXED — `.ptah/specs/TASK_2026_404_6fcd/implementation-plan-r2-notifications.md` escapes every pipe in the focus-outcome table cell.
6. FIXED — `.ptah/specs/TASK_2026_404_6fcd/implementation-report-notification-center.md` documents `terminalTurnPulses` and `takeTerminalTurnPulses()` plus the queue/drain behavior.

## Item 2 — the injector defect

I chose the component-scoped store route. The production usage search found that only `NotificationCenterComponent` injects `NotificationCenterStore`; the other references are tests. Both shells mount one notification center and provide `NOTIFICATION_FOCUS_ROUTER` above it. Providing the store on `NotificationCenterComponent` therefore creates it in the correct descendant injector chain, preserves one store per mounted center, and avoids moving two shell bindings into separate environment-injector configuration.

The regression in `libs/frontend/notification-center/src/lib/notification-center.injector.spec.ts` mounts a shell-like host component whose component injector provides `NOTIFICATION_FOCUS_ROUTER`, mounts the real notification component below it, resolves the store through that component, and activates a prompt. This reproduces the production topology instead of placing the router token in the TestBed environment injector.

Before the fix, this exact assertion failure was observed:

```text
FAIL notification-center libs/frontend/notification-center/src/lib/notification-center.injector.spec.ts (15.532 s)
  ● NotificationCenterComponent injector topology › resolves the shell focus router from the notification component store

    expect(received).resolves.toEqual(expected) // deep equality

    - Expected  - 2
    + Received  + 2

      Object {
    -   "outcome": "focused",
    -   "success": true,
    +   "outcome": "missing",
    +   "success": false,
      }

      77 |     } as PendingNotificationEntry;
      78 |
    > 79 |     await expect(store.activatePrompt(entry)).resolves.toEqual({
         |                                                        ^
      80 |       success: true,
      81 |       outcome: 'focused',
      82 |     });

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
Snapshots:   0 total
```

## Tests added

- `libs/frontend/notification-center/src/lib/notification-center.injector.spec.ts:76` — item 2; proves a store resolved by the real notification component can see a focus router provided by its shell-like component ancestor.
- `libs/frontend/notification-center/src/lib/notification-center.injector.spec.ts:98` — item 3; drives two isolated one-completion bursts with the same phrase and proves the live-region DOM transitions from the phrase to empty and back to the same phrase.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts:246` — item 4; proves an unrelated tab-object replacement retains the memoized calculated summary, while a new messages-array reference recomputes it.

## Verification

`npx nx run ptah-extension-webview:test --skip-nx-cache`

```text
NX   Successfully ran target test for project ptah-extension-webview
Test Suites: 9 passed, 9 total
Tests:       152 passed, 152 total
Snapshots:   0 total
```

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

@ptah-extension/notification-center: Test Suites: 4 passed, 4 total; Tests: 22 passed, 22 total
@ptah-extension/chat-state: Test Suites: 19 passed, 19 total; Tests: 404 passed, 404 total
@ptah-extension/chat-streaming: Test Suites: 24 passed, 24 total; Tests: 1 skipped, 506 passed, 507 total
@ptah-extension/core: Test Suites: 30 passed, 30 total; Tests: 729 passed, 729 total
@ptah-extension/chat: Test Suites: 86 passed, 86 total; Tests: 2 skipped, 1332 passed, 1334 total
@ptah-extension/chat-ui: Test Suites: 29 passed, 29 total; Tests: 203 passed, 203 total
@ptah-extension/canvas: Test Suites: 9 passed, 9 total; Tests: 162 passed, 162 total

Aggregate: 201 suites passed; 3,358 tests passed; 3 skipped.
NX   Successfully ran target test for 7 projects
```

The successful test run also printed the repository's existing forced-worker-exit warning after the `chat-state` suite; no suite failed.

`npx nx run-many -t typecheck -p @ptah-extension/notification-center @ptah-extension/chat @ptah-extension/chat-ui --skip-nx-cache`

```text
NX   Running target typecheck for 3 projects:
- @ptah-extension/notification-center
- @ptah-extension/chat
- @ptah-extension/chat-ui
NX   Successfully ran target typecheck for 3 projects
```

`npx nx run-many -t lint -p @ptah-extension/notification-center @ptah-extension/chat @ptah-extension/chat-ui --skip-nx-cache`

```text
NX   Running target lint for 3 projects:
- @ptah-extension/notification-center
- @ptah-extension/chat
- @ptah-extension/chat-ui
@ptah-extension/notification-center: All files pass linting
@ptah-extension/chat-ui: 3 problems (0 errors, 3 warnings)
@ptah-extension/chat: 17 problems (0 errors, 17 warnings)
NX   Successfully ran target lint for 3 projects
```

All warnings are pre-existing max-lines, non-null-assertion, unused-symbol, or empty-function findings outside the changed lines. Lint remained at 0 errors.

`npx nx run degradation-audit:lint --skip-nx-cache`

```text
degradation-audit: scanned 2884 file(s)
degradation-audit: TOTAL 302 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

The audit total remained at 302.

## Not fixed

None. All six requested items were fixed and all required verification commands passed.
