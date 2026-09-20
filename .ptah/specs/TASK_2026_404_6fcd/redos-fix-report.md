## Fix

Line 541 changed from:

```text
/\b[A-Za-z]:[\\/](?:[^\s"'`]+[\\/])*([^\s\\/"'`]+)/g
```

to:

```text
/\b[A-Za-z]:[\\/](?:[^\s\\/"'`]+[\\/])*([^\s\\/"'`]+)/g
```

Line 542 changed from:

```text
/\/(?:Users|home)\/[^\s/]+\/(?:[^\s"'`]+\/)*([^\s/"'`]+)/g
```

to:

```text
/\/(?:Users|home)\/[^\s/]+\/(?:[^\s/"'`]+\/)*([^\s/"'`]+)/g
```

The new segment classes cannot consume their terminating separators, so each path segment has only one partition and the repeated groups cannot backtrack exponentially.

## Timing evidence

- Before the fix, the focused Jest run containing the 200-separator non-matching Windows subject did not complete and was terminated by the external timeout after 14.045 seconds (`exit 124`).
- After the fix, the same redaction operation completed in 0.144 ms and returned the subject unchanged. The focused spec completed successfully with `12 passed, 12 total` in 1.497 seconds.
- The regression test enforces a generous upper bound of 1,000 ms.

## Other patterns scanned

Searched both compact-session folders:

```text
libs/frontend/chat-ui/src/lib/molecules/compact-session
libs/frontend/chat/src/lib/components/molecules/compact-session
```

The search covered regex literals and specifically the repeated `(?:INNER+ SEP)*` shape. The only matches with that shape were the two expressions at lines 541 and 542 in `compact-session-summary.ts`; no additional vulnerable expressions were found.

## Verification

```text
$ npx nx run-many -t test -p @ptah-extension/notification-center @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-ui @ptah-extension/canvas --skip-nx-cache

NX   Running target test for 7 projects:

- @ptah-extension/notification-center
- @ptah-extension/chat-state
- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/chat-ui
- @ptah-extension/canvas

@ptah-extension/chat-state:          Test Suites: 19 passed, 19 total; Tests: 403 passed, 403 total
@ptah-extension/chat-ui:             Test Suites: 29 passed, 29 total; Tests: 203 passed, 203 total
@ptah-extension/core:                Test Suites: 30 passed, 30 total; Tests: 727 passed, 727 total
@ptah-extension/notification-center: Test Suites: 3 passed, 3 total; Tests: 20 passed, 20 total
@ptah-extension/chat-streaming:      Test Suites: 24 passed, 24 total; Tests: 1 skipped, 506 passed, 507 total
@ptah-extension/chat:                Test Suites: 86 passed, 86 total; Tests: 2 skipped, 1326 passed, 1328 total
@ptah-extension/canvas:              Test Suites: 9 passed, 9 total; Tests: 162 passed, 162 total

Aggregate: 200 test suites passed; 3347 tests passed, 3 skipped, 3350 total.

NX   Successfully ran target test for 7 projects
```

```text
$ npx nx run-many -t typecheck -p @ptah-extension/chat-ui --skip-nx-cache

NX   Running target typecheck for project @ptah-extension/chat-ui:
- @ptah-extension/chat-ui

> nx run @ptah-extension/chat-ui:typecheck
> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/chat-ui
```

```text
$ npx nx run-many -t lint -p @ptah-extension/chat-ui --skip-nx-cache

NX   Running target lint for project @ptah-extension/chat-ui:
- @ptah-extension/chat-ui

Linting "@ptah-extension/chat-ui"...
✖ 3 problems (0 errors, 3 warnings)

NX   Successfully ran target lint for project @ptah-extension/chat-ui
```

The three lint warnings are the existing `max-lines` warnings in `session-stats-summary.component.ts`, `mcp-directory-browser.component.ts`, and `plugin-browser-modal.component.ts`; there were zero lint errors.

```text
$ npx nx run degradation-audit:lint --skip-nx-cache

degradation-audit: scanned 2880 file(s)
degradation-audit: TOTAL 302 unsuppressed site(s)

NX   Successfully ran target lint for project degradation-audit
```
