# B12 lane report

## Files changed

- `libs/frontend/chat/src/lib/utils/turn-facts.utils.ts`: Added cache read and cache creation to turn token facts. Only messages whose complete usage passes the shared token helper contribute to the subtotal; an invalid or overflowing aggregate is unavailable.
- `libs/frontend/chat/src/lib/utils/turn-facts.utils.spec.ts`: Added aggregation and rendered component tests for both cache classes, partial coverage, invalid counts, overflow, missing usage, and zero cache usage.
- `libs/frontend/chat/src/lib/components/molecules/turn/turn-activity-panel.component.ts`: Shows the combined cache count after input/output when positive. Missing token usage displays —; existing `N of M messages` labels remain unchanged.

## Lane check

`npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="turn-facts.utils|turn-activity-panel" | Select-Object -Last 60` passed on the second run: 1 task succeeded. The first run exposed a TestBed setup issue in the new spec; it was fixed. Scoped Ptah diagnostics reported no errors in the three changed files. The diagnostic service also reported existing errors in sibling files outside this lane.

## Decisions

- Used `messageTokenTotal` to reject incomplete or invalid message usage and `isValidTokenCount` with the shared total helper to reject invalid turn aggregates.
- Treated absent optional cache fields as zero for a valid message, so the cache suffix appears only when the known cache subtotal is positive.
- Kept the established coverage label wording and treated a partial turn sum as a labelled subtotal over known messages.

## Not done

- No browser screenshot: the browser tool had no active app session, and this lane prohibits build, serve, and dev targets. Angular component tests rendered and checked the token rows.
