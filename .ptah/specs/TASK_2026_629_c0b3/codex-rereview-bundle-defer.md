# Bundle defer short re-review

**Score: 8/10. Verdict: APPROVED.** The lane tabs and their spec match HEAD exactly (`git diff HEAD` is empty). The two remaining defers keep their existing bindings and loaded-state spec coverage. The bundle saving remains an estimate because a build was outside this review's allowed checks.

1. **Resolved — Serious, lost lane focus.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:58`: the lane tab is eager again, so the Rail's next-render focus query no longer waits on an idle chunk.
2. **Resolved — Moderate, stale lane and tabpanel name.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:58`: the eager tab runs its lane reset and provides the `aria-labelledby` target when the panel renders.
3. **Resolved — Moderate, e2e geometry race.** `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:149`: the tab whose bounding box is read is eager again; the selector no longer races an idle defer.
4. **Open — Minor, dock width shift.** `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:112`: the `All clear` placeholder can be narrower than the loaded count label. This was explicitly deferred to a follow-up.

**Spec type fix:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:180` now accepts `Pick<ComponentFixture<unknown>, 'getDeferBlocks'>`, matching the helper's sole use and allowing both call sites at lines 468 and 480 without a cast. No new behavior defect found in the session-details or needs-you-queue defers. This re-review used source inspection and `git diff --check`; it did not rerun tests.
