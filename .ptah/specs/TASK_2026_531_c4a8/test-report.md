# Test report — TASK_2026_531_c4a8

## Commands run (orchestrator, Windows, worktree)

```
npx nx run-many -t typecheck,test,lint -p canvas,ptah-electron-e2e --skip-nx-cache --outputStyle=static
```

Final run (after revise round 1 and Prettier):

| Target | Project | Result |
|---|---|---|
| test | canvas | 9 suites passed, 229 tests passed |
| lint | canvas | All files pass linting (the round-0 `max-lines` 728 > 700 warning is resolved) |
| typecheck | canvas | Pass (one existing NG8107 warning in `libs/frontend/chat`, not touched) |
| typecheck | ptah-electron-e2e | Pass |
| lint | ptah-electron-e2e | 0 errors, 15 existing warnings, none in `canvas.spec.ts` |

`Successfully ran targets typecheck, test, lint for 2 projects`.

## New regression tests (canvas unit suite)

- stop → geometry pass → change: the drag commits, no rejection.
- start → geometry pass mid-drag → stop → change: the drag commits.
- Guard-removed experiment (codex, see `implementation-notes.md`): with the
  in-flight gesture guard disabled, both tests failed on one forbidden
  `grid.load` call each. With the guard restored, both pass.
- Activation re-measure that is skipped during a gesture runs once after the
  committed drag.
- Host renders `data-canvas-rejected-gestures` and
  `data-canvas-change-callbacks`, and both update.
- `CanvasLayoutService`: a 0x0 entry after a good entry does not revoke the
  pending frame (1180, not stale 1464). Inactive entries do not write.
  Reactivation re-observes.
- All canvas specs bind `SURFACE_ACTIVE` with `provideSurfaceActiveTesting()`.

## E2E — must run in Linux CI

`ptah-electron-e2e` does not boot on Windows (`firstWindow` timeout), so it was
NOT run locally. The test
`real Gridstack drag keeps an explicit 2+1 row through resize and workspace switch`
in `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts` now asserts, after
the first drag and before the `gs-y` poll:

1. `data-canvas-change-callbacks` grew (else no change callback arrived:
   "swallowed or never emitted").
2. `data-canvas-gesture-commits` is before + 1 (the failure message includes
   the current rejected count).
3. `data-canvas-rejected-gestures` is unchanged (else "rejected").

The next Linux CI run confirms the fix and, if it still fails, tells
"rejected" from "swallowed".

## Review

`code-logic-review.md` (opencode lane): round 1 FAIL 6/10 (host did not render
two metrics), round 2 PASS_WITH_NOTES 8/10, all four findings fixed.
