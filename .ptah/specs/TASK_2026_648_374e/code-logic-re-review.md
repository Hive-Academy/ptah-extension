# Code Logic Re-review — `TASK_2026_648_374e` M2

Review family: grok (implementer family: codex)

Verdict: **M2 RESOLVED**

Commit `a3b4a82f9` only. No new findings.

## What was checked

`ConductorTileComponent.visibleRegistration` (`libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:212-219`) reads `correlationId()` once per run, registers that string, and the cleanup closes over the same string. Angular runs the previous cleanup before the next run and again when the component is destroyed.

| Transition | Result |
| --- | --- |
| Mount with id A | Effect registers A. `ngOnInit` no longer registers (`:221-237`). |
| A → B | Cleanup unregisters A, then the new run registers B. |
| A → null | Cleanup unregisters A. `if (!tabId) return` adds no registration and no new cleanup. |
| null → B | Registers B only. |
| Destroy on B | Effect cleanup unregisters B. `ngOnDestroy` does not unregister (`:239-241`). |
| Mount and destroy on null | No register, no unregister. |

A second host's count for B is not decremented unless this tile had registered B. A's count cannot stay at 1 after this tile is the extra owner, because the cleanup for the run that registered A always unregisters A.

## No regression

The child injector is still created in `ngOnInit` (`:226-236`) and destroyed only in `ngOnDestroy` (`:239-241`). The effect does not touch it.

Registration moved from `ngOnInit` to the first change-detection flush of a field `effect`. `ngOnInit` does not read `visibleTabIds` after that move, so nothing in this class observes the tab as hidden between construction and first CD. A tile that mounts with a correlation id is registered on that first CD, which is the same turn that shows it. A later `prepare()` that replaces the id re-runs the effect; the old `ngOnInit`/`ngOnDestroy` pair did not.

## Tests

`conductor-tile.component.spec.ts:157-194` is not a false pass.

- Mount with `'A'` asserts one `registerVisibleTab('A')` and no unregister, after `mount()` → `detectChanges()` only. If the effect did not run during that CD, the assertion fails. It does not pass by skipping the call.
- `correlationId.set('B')` then asserts unregister `'A'` before the second register `'B'` via `invocationCallOrder`. A cleanup that read the live signal would unregister `'B'` (the signal is already B when cleanup runs) and this assertion fails.
- `fixture.destroy()` asserts the second unregister is `'B'` and the full list is `['A', 'B']`. Destroy-time unregister of "whatever id is current" cannot satisfy the `'A'` call.
- Mount with `null` asserts no register and, after destroy, no unregister.

Not covered, and not a defect: A → null is the same closed-over cleanup the A → B test locks, then the early return. M1, M3, and the collapsed-rail minor item were not re-reviewed.
