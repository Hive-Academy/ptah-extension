# Code logic check: commit 3a2a6f28e (N1, N2, N4)

Method: read-only, through `git show 3a2a6f28e` and `git show 3a2a6f28e:<path>`. No tests or builds were run.

## Verdicts

| Finding | Verdict |
| --- | --- |
| N1 | FIXED |
| N2 | FIXED |
| N4 | FIXED |

## N1: FIXED

File: `canvas-detail/canvas-detail-transcript.component.ts:52-63`.

- The `has()` check and `registerVisibleTab` now run inside `untracked`. The effect depends on `tabId()` only, so its own registration no longer re-triggers it. The register/unregister loop is gone.
- Cleanup is registered through `onCleanup` only when this effect registered the tab.
  - It runs when `tabId` changes: the old id is unregistered, then the new id is evaluated.
  - It runs on component destroy, because the effect is destroyed with the component.
- A tab that is already visible (owned by its tile) returns `false`. No cleanup is attached, so the detail never unregisters it.
- Residual, not a regression and not newly introduced. The tab is unregistered, the detail registers it, the tile then re-shows and its register is a no-op, and the detail finally closes. The close unregisters the tab while the tile is visible. This is the narrower "ownership steal" path described in the N1 write-up. The fix does not cover it, because it needs a ref-count or ownership model in `TabManagerService`. The trigger needs the tile to be hidden and re-shown while the detail is open, so likelihood is low. Rated Moderate at most, and not caused by this commit.
- The spec for the unregistered-tab case was added (`canvas-detail-transcript.component.spec.ts`, +36 lines). I did not inspect it in depth.

## N2: FIXED

Files: `canvas-grid-release.ts` (`retainLiveViewConstraints`), `canvas-workspace-grid.component.ts` around lines 383-387, 714-722, 755 and 794.

- The release path no longer adopts the whole current fingerprint. It filters the applied constraints down to tiles that are still live, in their original order. A view-mode change that lands in the same flush as a close therefore still differs from the filtered applied set, and the forced locked application runs.
- Null handling:
  - `_appliedViewConstraints` null gives `null && …`, which is `null`. A string fingerprint is never `=== null`, so it compares as different and the application runs. This matches the old `null` fingerprint behaviour.
  - The release path skips the filter when it is null.
  - This is safe because live nodes imply a previous apply, which sets the field.
- Hidden-but-unlocked:
  - The filter runs only under `released > 0 && locked()`. A hidden unlocked grid keeps the stale applied constraints.
  - When it is shown again, the unlocked path runs the normal `applyAuthoritativeGeometry()`. The fingerprint is not used as a gate there, so nothing is swallowed.
- Hidden-locked: the pending diff is preserved. The filter removes only closed tiles, and the next active locked run still sees the difference.
- Reading `viewConstraints()` after `load()` instead of capturing a fingerprint before it:
  - Both calls are synchronous, in the same effect pass, and `viewConstraints` is a computed. No signal write happens between the start and the end of the apply.
  - So it cannot record a different state from the one that was applied.
  - The read happens inside the same effect context, so the tracked set is unchanged from before.
- The `positioned.length === 0` path also records the constraints. That is consistent with the old behaviour.
- Minor and benign: after a locked close with no view change, the filtered applied set must produce a fingerprint equal to the current one. This relies on `viewConstraints` being derived in tile order and on the fingerprint being order-stable. The new spec at `canvas-workspace-grid.component.spec.ts` (+20 lines) covers a close plus a pending view change. I could not confirm the no-view-change equality case from the diff alone. The orchestrator reports that the tests pass.

## N4: FIXED

File: `canvas-detail/canvas-detail-keyboard.ts:8-32`.

- The tab and tablist exemption moved after the Esc branch and the modifier check. It now applies to ArrowLeft and ArrowRight only, so Esc closes the detail from a focused lane tab.
- The guards that run before Esc are unchanged:
  - `defaultPrevented` returns early.
  - `closest('input, textarea, select, [contenteditable], [role="menu"], [role="listbox"], [role="dialog"], [popover]')` returns early.
  - `isContentEditable` returns early.
  - So Esc inside a menu, popover or input is still ignored.
- Observation, not introduced here: Esc with a modifier key still closes the detail, because the modifier check comes after the Esc branch. This is the same as before the commit.

## New defects introduced by the correction

None at Serious or Moderate level. The only residuals are the pre-existing ownership-steal path and the order-stability assumption, both described above.

## Verdict: PASS
