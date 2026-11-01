# B6 lane report

## Files changed

- `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.ts`: derives expiry and display time from `WallClockService`, conditionally acquires the second cadence, and auto-denies once per request ID in a separate effect.
- `libs/frontend/chat-ui/src/lib/molecules/permissions/permission-request-card.component.spec.ts`: covers deadline denial, an already-expired mount, release, and no-timeout behavior. Tracks the interval created during the real clock acquire and verifies that exact handle is cleared.
- `libs/frontend/chat-ui/src/lib/molecules/question-card.component.ts`: derives countdown from the shared clock and absolute deadline, preserving `-1` for no timeout; removes the component interval and lifecycle cleanup.
- `libs/frontend/chat-ui/src/lib/molecules/question-card.component.spec.ts`: covers remount countdown, expiry release, an already-expired mount, and no timeout. Tracks each clock interval and its matching clear call.

## Lane check

Revision check passed (one run in this revision):

```text
npm run verify -- -t test -p @ptah-extension/chat-ui -- --testPathPatterns="permission-request-card|question-card" | Select-Object -Last 60
[verify 2026-10-30T20:25:01.441Z] lock slot 0 acquired after 463s: verify test (@ptah-extension/chat-ui)
NX   1 task: 1 succeeded
  Run duration:      5.0s
  Cache:             0/1 hit (0%)
  Critical path:     4.9s (1 task)
[verify 2026-10-30T20:25:12.295Z] lock released after 10.9s, exit code 0
```

The preceding run failed on six global `jest.getTimerCount()` assertions because Angular rendering retained unrelated timers. The revised specs capture the `setInterval` handle created inside each real `WallClockService.acquire` call and assert `clearInterval` receives that handle after expiry. They also assert no clock acquire for a zero deadline.

## Decisions

- The permission auto-deny effect is independent of clock acquisition so an already-expired mount can deny immediately.
- Each request ID is auto-denied once; the clock releases as soon as `expired()` becomes true.
- The question card retains its original floor-to-seconds display and `-1` no-timeout sentinel.
- Clock interval assertions identify the timer started by the real service rather than counting Angular's timers.

## Not done

- None.
