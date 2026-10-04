# Test report — TASK_2026_531_c4a8 (contract-path copy)

Canonical file: `.ptah/specs/TASK_2026_531_c4a8/test-report.md`.

## Command

```
npx nx run-many -t typecheck,test,lint -p canvas,ptah-electron-e2e --skip-nx-cache --outputStyle=static
```

Result: `Successfully ran targets typecheck, test, lint for 2 projects`.

- canvas test: 9 suites, 229 tests passed.
- canvas lint: all files pass (max-lines warning resolved).
- canvas typecheck: pass (one existing NG8107 warning in `libs/frontend/chat`).
- ptah-electron-e2e typecheck: pass. Lint: 0 errors, 15 existing warnings.

## New unit regressions

- stop → geometry pass → change commits the drag.
- start → mid-drag geometry pass → stop → change commits the drag.
- Both failed with the in-flight gesture guard removed (one forbidden `grid.load` each).
- Activation re-measure skipped during a gesture runs once after the commit.
- Host renders live `data-canvas-rejected-gestures` and `data-canvas-change-callbacks`.
- Layout service: a 0x0 entry does not revoke a pending good frame (1180, not 1464).

## E2E

`ptah-electron-e2e` does not boot on Windows. It was NOT run. The drag test in
`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` now asserts
change-callbacks grew, gesture-commits +1 and rejected-gestures unchanged.
This must run in Linux CI.
