# Code Logic Re-review: Fix-D1 (`e80021cab`) and Fix-D2 (`92fb0f489`)

Scope: the two fix commits only. Read-only. I ran no checks; I relied on the orchestrator's results (canvas 314 tests, typecheck and lint pass). Paths are relative to `libs/frontend/canvas/src/lib/` unless noted.

Verdict: **REVISE, 6/10.** Most items are fixed. One Fix-D1 change (S1) introduces a self-triggering effect that the spec does not exercise. Fix-D2 introduces one swallowed-state path (the fingerprint overwrite) and one derived-vs-actual geometry mismatch while locked.

## Item status

| Item | Status | Evidence |
| --- | --- | --- |
| S1 visible-tab ownership | **PARTIAL (new Serious defect, N1)** | `canvas-detail/canvas-detail-transcript.component.ts:51-56`. It no longer unregisters a tile-owned tab, but the effect now tracks `visibleTabIds()`. |
| S2 hidden-surface keys | FIXED | `orchestra-canvas.component.ts:344` and `:354` pass `surfaceActive()` into `canvas-detail/canvas-detail-keyboard.ts:8`. `SURFACE_ACTIVE` is the same token `CanvasLayoutService` injects, so it resolves in the app. |
| S3 lane-tab arrows | FIXED | `canvas-detail-keyboard.ts:9-17` skips `defaultPrevented` and tablist/tab targets. `canvas-lane-tabs.component.ts` adds `event.stopPropagation()`. Side effect: N4. |
| S4 transcript refetch | FIXED | `canvas-detail/canvas-lane-view.component.ts:259-300` keys the effect on primitive agent and session ids. The `requestVersion` guard is applied to the effect and to `loadTranscript` (`:303-334`). Side effect: N5. |
| S5 + contenteditable | FIXED | `canvas-tile.component.ts`: the interactive-target return now applies only in card mode. Non-card clicks always emit `focusRequested`. `isContentEditable` is treated as interactive. |
| M1 card actions open, host toggles | FIXED | `canvas-tile.component.ts`: `openCardAction()` calls `detail.open`, and `openSession` now points to it. |
| M4 Esc scope | FIXED, with a regression (N4) | `canvas-detail-keyboard.ts:8-18`. |
| M6 sub-agent permission and Stop | **PARTIAL (accepted)** | Sub-agent Allow/Deny: `canvas-lane-view.component.ts:126-148` and `:245-258`, matched on `agentToolCallId === parentToolUseId`, answered through `respondSession` (`:350-355`). Sub-agent Stop uses `sub.taskId` (`:151-166`). The standalone background Stop has no safe path. The lane report and decisions.md row 26 record it, so this is acceptable. |
| Style 1 owner helper | FIXED | `canvas-detail/lane-owner.ts:2`. It is null-guarded and used by tabs, lane view, queue and tile. |
| Style 2 deny reason | FIXED | `chat/src/lib/services/agent-permission-responder.ts`: the default `'User denied'` now lives in the responder. |
| Style 3 lane view split | FIXED | The `#subagentLane` template is shared (`canvas-lane-view.component.ts:122`). |
| Style 4 tab a11y | FIXED | `canvas-detail-panel.component.ts` (`panelId`) and lane tabs (`[id]`, `aria-controls`). |
| Fix-D2 Phase D M2 skyline | FIXED | `canvas-detail-geometry.ts:24-33`. Fixed-point closure over straddling tiles, starting at `selected.y + selected.h`. It terminates because `rowEnd` only grows and is bounded by the tile bottoms. Note that it is a global skyline: a tall tile in a far column also pushes the slot down. That matches the stated intent. |
| Fix-D2 Phase D M3 frozen measurements | **PARTIAL (N3)** | `canvas-workspace-grid.component.ts:328-344` uses `_lockedMeasurements ?? _lastApplied ?? current` and `measurements.height`. It does not use the stale layout cache. See N3 for the tile-set mismatch. |
| Fix-D2 Phase E M1 release while locked/inactive | **FIXED, with defects (N2, N6)** | Effect at `:375-398`. `applyAuthoritativeGeometry` release-only branch at `:703-728` and `releaseStaleNodes` at `canvas-grid-release.ts:76-87`. No load is issued. The `_applyingLayout` guard and `finally` restore are correct. |
| Fix-D2 Phase E M3 real-engine spec | FIXED (spec added) | `canvas-grid-release.engine.spec.ts` (+85 lines). I read the diff stat only; the orchestrator's run is green. |
| Fix-D2 Phase E M4 comment | FIXED | `canvas-workspace-grid.component.ts:184-186` and the load comment now state the truth. |

## New defects

### N1 (Serious): the S1 effect re-triggers itself and can loop

- File: `canvas-detail/canvas-detail-transcript.component.ts:51-56`. The tab manager is at `chat-state/src/lib/tab-manager.service.ts:401` and `:2865-2880`.
- The effect reads `this.tabManager.visibleTabIds()`, and that read is tracked because it is not wrapped in `untracked`.
- `registerVisibleTab` replaces the set with a new `Set`, so the effect's own write invalidates its own dependency.
- Failure scenario (the path is reached whenever the detail opens for a tab that is not currently registered):
  1. The tab is not registered, for example the owning tile is hidden or not mounted.
  2. The effect registers the tab. The set changes, so the effect is dirty.
  3. On re-run, the `onCleanup` runs first and unregisters the tab. The set changes again.
  4. The body then sees the tab as absent and registers it again. The set changes again.
  5. The effect is dirty every flush: an endless register/unregister ping-pong. Every other effect or computed that reads `visibleTabIds` re-runs as well (`stream-viewport-controller.service.ts:57`, `batched-update.service.ts`).
  6. This also toggles the detail tab's streaming-flush deferral on and off.
- The same trigger fires whenever any other tab registers or unregisters while the detail owns the registration.
- Ownership can also be stolen. When a tile hides (for example a workspace switch) and the tile's effect unregisters it, the detail effect re-runs and takes ownership. When the tile shows again its register is a no-op. When the detail closes, its cleanup unregisters the tab and the tile's tab ends up unregistered while visible. That is the original S1 bug, reached through a narrower path.
- The spec passes only because it pre-registers `tile-1`, so the registering branch is never exercised. The only spec is `canvas-detail-transcript.component.spec.ts`, and it covers the tile-owned case.
- Fix:
  - Wrap the `has()` check in `untracked`.
  - Use a plain `ngOnDestroy` or `DestroyRef` cleanup that releases only if this component registered.
  - Key the effect on `tabId` only.
  - Add a spec for the unregistered-tab case: assert one register call and one unregister call on destroy, with no loop.

### N2 (Moderate): a locked or hidden release can swallow a pending view-mode change

- File: `canvas-workspace-grid.component.ts:717-722`.
- When `released > 0 && this.locked()`, `_appliedViewFingerprint = this.viewFingerprint()` is set unconditionally. This runs in the active-locked branch and, because the condition does not check `active`, also in the hidden-locked branch.
- Active-locked: if a tab view-mode change lands in the same effect run as a tile close, the release pass runs first and overwrites the fingerprint. The check at `:387-390` then sees "applied equals current". The locked view-mode application never happens, and the grid keeps the old per-tile geometry until unlock. Only `_geometryDeferred` could still force it.
- Hidden-locked: the doc comment at `:67-70` promises that hidden locked grids keep the pending fingerprint difference until shown. A close of any tile in a hidden locked workspace discards it.
- Narrow, because a close alone changes the fingerprint (the tile is removed from the constraints), which is why the author did this. The assignment should account only for the removed membership, not adopt the whole current fingerprint.
- Fix:
  - Compute the fingerprint of the surviving constraints as of before the view change. Or record the previous fingerprint and update it only when the diff comes from membership alone.
  - Or set `_geometryDeferred = true` when the fingerprint was already pending, and do not touch the fingerprint in the inactive branch.

### N3 (Moderate): the locked detail slot is derived from a layout the static grid is not showing

- File: `canvas-workspace-grid.component.ts:328-344`.
- While locked, `detailGeometry` freezes the measurements but still recomputes `computeLayout` from the current `tiles()`.
- After a locked close, BL releases only the stale node. The remaining static nodes keep their old positions and gaps (no load).
- The slot, `rowEnd` and `belowIds` come from the compacted derived layout. The result is a slot that overlays the real nodes, or `ptah-below-detail` classes applied to the wrong items, in the locked and closed state.
- Likelihood: low to medium. The detail must be open while locked and the user closes a tile. Prefer deriving geometry from the engine nodes while locked, or from the layout captured at lock time.

### N4 (Minor/Moderate): Esc does nothing when focus is on a lane tab

- File: `canvas-detail/canvas-detail-keyboard.ts:10-17`.
- The `[role="tab"]` and `[role="tablist"]` early return runs before the Esc branch. After the user clicks a lane tab, focus stays on it, and Esc no longer closes the detail.
- The S3 fix intended to exempt arrow keys only. M4 says to skip popovers, menus and inputs, not tabs.
- Fix: apply the tab/tablist exemption to ArrowLeft and ArrowRight only. Also confirm that no app shell wrapper is `role="dialog"`, because `closest('[role="dialog"]')` would then disable the keys entirely.

### N5 (Minor): a running sub-agent transcript is fetched once and not refreshed

- File: `canvas-detail/canvas-lane-view.component.ts:273-300`.
- This is the intended outcome of S4. The first fetch may happen mid-run, and the transcript is stale until the user presses Refresh. Completion (a status change) does not trigger a refetch.
- Optionally refetch once when the status transitions to a terminal state.

### N6 (Minor): extra metric publishes and an ordering regression

- `:726`: `metrics.publish()` runs in `finally` on every release-branch invocation, including zero releases. That writes the `version` signal from inside an effect on every tile or fingerprint change while locked or inactive. Publish only when `released > 0`.
- `:703-709`: the gesture check now precedes the locked early return. The old order returned before deferring. If the canvas is locked while a gesture is in flight, the first effect (declared before the gesture-cancel effect) sees `_gesture !== null` and sets `_geometryDeferred = true`. The forced branch at `:387-395` then applies a load with frozen measurements before the cancel effect runs. Rare.
- `detailGeometry` and `compactSingletonHeight` each call `computeLayout` outside the memoized `layout()` computed. That is a third layout computation per change, and the metrics do not count it.
- The `_lockedMeasurements` plain-field read in the computed is benign. It self-heals because the fallback branch tracks the container signals, and `_lastAppliedMeasurements` equals the lock-time value. The one residual stale case is a re-lock whose first evaluation happens before the effect writes the field. That case is covered by the `_lastApplied` fallback.

## Answers to the specific questions

- **Simultaneous view-mode change swallowed?** Yes, in the narrow case (N2). It needs the close and the view change in the same effect flush while locked, or a close in a hidden locked grid that has a pending view diff.
- **`_lockedMeasurements` plain field in the computed?** No functional defect found. See N6 for the one residual stale case.
- **Signal writes inside effects/computed:**
  - `metrics.publish()` and `increment` write `version` from the effect. Angular permits that, and the effect does not read `version`.
  - `layout()` calls `increment(…, false)`, which is a non-signal write and was already there.
  - The new `computeLayout` calls in the computed do not write signals.
  - The only loop risk found is N1, which is in the transcript component, not the grid.

## Verdict

REVISE, 6/10. Fix N1 before merge (a one-line `untracked` plus a missing-tab spec). N2 and N4 are worth fixing in the same pass. N3, N5 and N6 can be recorded.
