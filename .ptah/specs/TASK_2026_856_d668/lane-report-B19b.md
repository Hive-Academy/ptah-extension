# B19b lane report

## Files changed

- `libs/frontend/git-ui/src/lib/history/history-timeline.component.ts`: commit rows read `injectWallClock('coarse', () => shown())`, so relative ages advance while the history tab is shown. Invalid commit dates display `—`.
- `libs/frontend/git-ui/src/lib/history/history-timeline.component.spec.ts`: verifies a fixed commit changes from “just now” to “1m ago” after 30 seconds without a new log, checks interval cleanup, and covers the missing-date label.
- `libs/frontend/git-ui/src/lib/stash/stash-popover.component.ts`: passes the coarse `now()` into the unchanged `stashAge` signature while open; a stash without a timestamp displays `—`.
- `libs/frontend/git-ui/src/lib/stash/stash-popover.component.spec.ts`: verifies a fixed stash age advances after 30 seconds, the interval clears on destroy, and missing time displays `—`.
- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts`: supplies `injectWallClock('coarse')` to the event feed and storage panel, independent of `recentEvents` updates.
- `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.spec.ts`: verifies child time inputs and the event age advance after 30 seconds without new events, and checks interval cleanup.

## Final lane check

`npm run verify -- -t test -p @ptah-extension/git-ui,@ptah-extension/memory-curator-ui -- --testPathPatterns="history-timeline|stash-popover|memory-diagnostics-accordion" | Select-Object -Last 60` passed on run 3: Nx reported 2 tasks succeeded. `git diff --check` passed. Scoped Ptah diagnostics reported no errors in the six changed files.

## Decisions

- History subscribes only while shown; stash subscribes only while open; memory subscribes for its component lifetime. `injectWallClock` releases each subscription on cleanup.
- Existing rendering specs use a fixed `WallClockService` test provider. The clock behavior specs use the real service and spy on `setInterval` and `clearInterval`, because Angular schedules other fake timers.
- The git-ui feature-to-core import follows the existing webview feature-to-core dependency direction. Memory-curator-ui already imported core.

## Not done

- Full project type checking still reports 11 errors in untouched sibling/shared files, including `pierre-config.spec.ts`, `review-canvas.component.spec.ts`, `corpus-build-dialog.component.spec.ts`, `memory-rpc.service.spec.ts`, and shared BigInt target diagnostics. These are outside this lane’s allowed file scope.
- No browser screenshot was taken; the batch plan marks UI review as not required, and no visual reference was supplied.
