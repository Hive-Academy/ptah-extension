# Phase D Fix 2 Report

## Summary

Fixed the five assigned geometry, stale-node release, engine-test, and comment findings in `@ptah-extension/canvas`. No files outside the requested code/spec scope and this report were edited. `ptah_*` tools, including `ptah_agent_report`, were not exposed in this lane; native file and command tools were used.

## Per-item status

1. **Phase D M2 — complete.** `libs/frontend/canvas/src/lib/canvas-detail-geometry.ts:24` repeatedly extends `rowEnd` through overlapping tiles. `canvas-detail-geometry.spec.ts:5` covers the mixed A/B/C/D compact skyline, selecting C, with `rowEnd = 6` and no tile below the slot.
2. **Phase D M3 — complete.** `canvas-workspace-grid.component.ts:328` projects detail geometry from frozen lock measurements and passes the same frozen height. `canvas-workspace-grid.component.spec.ts:1375` verifies that an open, locked detail does not move or resize after container resize.
3. **Phase E M1 — complete.** `canvas-workspace-grid.component.ts:373,382,701` invokes a release-only path for inactive and locked grids. It skips active gestures, pins live nodes, restores locks, and avoids layout load or static toggles. A locked removal consumes the membership-only fingerprint before the view-mode exception. `canvas-workspace-grid.component.spec.ts:467` checks locked and hidden removal with `removeWidget` called and `load` untouched.
4. **Phase E M3 — complete.** `canvas-grid-release.engine.spec.ts:130` closes middle tile B and checks that pinned neighbours reach their changed derived positions; its unpinned control lands above the derived D position. `:149` checks a target entering another tile's former cell. Both use real GridStack.
5. **Phase E M4 — complete.** `canvas-workspace-grid.component.ts:184,763` now says user gestures compact by gravity and programmatic pinned loads preserve derived row-break gaps.

## Checks run

All commands used `--parallel=1 --skip-nx-cache`; tests also used `--coverage=false --maxWorkers=2`.

| Command | Observed result |
| --- | --- |
| `npx nx test @ptah-extension/canvas --testFile=canvas-detail-geometry.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 1 test passed |
| `npx nx test @ptah-extension/canvas --testFile=canvas-grid-release.engine.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 1 suite, 4 tests passed; repeated after adding the unpinned control, same result |
| `npx nx test @ptah-extension/canvas --testFile=canvas-workspace-grid.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | First run: 1 failed, 85 passed; corrected locked membership handling; second run: 86 passed |
| `npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 25 suites, 314 tests passed; run before final unpinned assertion, which passed in its focused rerun |
| `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | Passed; one NG8107 warning in `libs/frontend/chat` |
| `npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | Passed; 0 errors, 12 warnings, including the existing max-lines warning on the grid component |

Grid component line count: **876**, below the hard limit of 877.

## Decisions

| Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- |
| Recompute detail layout with frozen measurements | Reuse live `layout()`; compute with lock snapshot | `layout()` reads live container dimensions; locked grid applies `_lockedMeasurements` | Yes |
| Release stale nodes in the existing apply path | Add a separate effect; use the existing effect and release-only branch | The current effect already observes tile membership; a separate effect would duplicate scheduling | Yes |
| Consume fingerprint on locked membership-only release | Allow a locked `load`; mark released membership current | Closing a tile changes `viewFingerprint`, which otherwise triggers a forced load | Yes |
| Keep real-engine moving-target control | Test only pinned output; compare against unpinned output too | The unpinned D position is below the derived target, proving the pin changes the outcome | Yes |

## Open items

- The task's manual detached-DOM/heap acceptance check remains outside this automated lane.
- `ptah_agent_report` could not be called because no `ptah_*` tool was listed or exposed. This report carries the intended handoff summary.
