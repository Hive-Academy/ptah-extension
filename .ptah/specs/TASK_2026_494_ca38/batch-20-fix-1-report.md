# Batch 20, fix round 1 report

Executor: frontend-developer. Nothing is staged or committed, and none of Batch 16's files were touched.

The fixes answer two reviews:
- `code-logic-review-batch-20.md` (6/10, NEEDS_REVISION);
- `code-logic-review-batch-20-antigravity.md` (8/10, APPROVED with findings).

## Files

| Change | Path (under `libs/frontend/`) | Lines |
| --- | --- | --- |
| MODIFIED | `mcp-apps-page/src/lib/components/apps-page.component.ts` | 477 |
| MODIFIED | `mcp-apps-page/src/lib/components/apps-page-splitter.spec.ts` | 501, 21 tests (was 11) |
| MODIFIED | `core/src/lib/services/electron-layout.service.ts` | 824 (+2) |
| MODIFIED | `core/src/lib/services/electron-layout.service.spec.ts` | +1 test |

## Findings

### 1. Stored width overwritten when nothing visibly moves: SERIOUS S-1 / MOD-1 (FM-1) — FIXED

This follows the coordinator's ruling: keyboard and drag work from the displayed (clamped) width.

**Keyboard** (`onSplitKeydown`, `apps-page.component.ts:393-405`)
- The target is `clampSplitWidth(shown ± step)`.
- If the target equals the shown width, the page skips both the set and the persist. So ArrowRight at the max, with a stored 900 shown as 334, keeps 900.
- Any other target is a visible change and is set. ArrowLeft 334 -> 318 sets 318, and keyup persists it.

**Drag**
- `onSplitPointerDown` (`:348-357`) records `startShown` and `startStored`.
- `onSplitDragMoved` (`:365-374`) sets the clamped target. If that target equals `startShown`, it puts `startStored` back instead.
- The effect: a drag with no visible change, or one that returns to its start, leaves the stored preference alone.
- The handle's Escape/blur restore re-emits the mousedown X. That maps to `startShown`, so it also restores the stored 900, not the shown 634. Antigravity had raised this Escape-when-clamped case separately under Q2.

**Clamping** — `clampSplitWidth` (`:422-427`) rounds after clamping. This makes the "same as shown" comparisons exact against the rounded `splitWidth()`.

**Specs** (`apps-page-splitter.spec.ts`):

| Line | Pin |
| --- | --- |
| `:393` | ArrowRight and Shift+ArrowRight at the max: stored stays 900, 0 `setState` calls. After widening to 1400 the column shows 900px. |
| `:406` | ArrowLeft: 318 is set and persisted once. |
| `:418` | A drag past the max changes nothing (900 kept). A visible move goes to 500; back to the start, the value returns to 900. Release writes nothing. |
| `:431` | A real drag persists 500 once. |
| `:444` | Escape after a visible drag: 900 kept, 0 writes. |

### 2. Commit only a changed width on drag end: MOD-2 + MIN-1 (FM-2, FM-3 in antigravity) — FIXED

- `onSplitDragEnded` (`:380-386`) commits only when `layout.appsSplitWidth() !== drag.startStored`. An Escape or blur cancel, or a plain click, makes zero `setState` calls.
- The keyboard path was made symmetric in `commitKeyResize` (`:413-419`). It now tracks `keyRunStartStored` (`:323`) instead of a boolean flag, so a key run that ends on its start width writes nothing.

**Specs:**

| Line | Pin |
| --- | --- |
| `:294` | Escape: 0 writes. |
| `:455` | Blur: 0 writes, width restored to 360. |
| `:465` | Plain click: 0 writes. |
| `:473` | Key run back to its start: 0 writes. |
| `:279` (existing) | A real drag: exactly 1 write. |
| `:431` | A real drag while clamped: exactly 1 write. |

### 3. No destroy-time flush for a pointer drag: subagent M-3 (FM-3) — FIXED

- The `DestroyRef.onDestroy` hook (`:327-330`) now runs `commitKeyResize()` and then `onSplitDragEnded()`. An in-progress drag with a changed width is persisted; an unchanged one is not.
- Specs: `:482` (changed width, 1 write with 420) and `:494` (unchanged, 0 writes).

### 4. Sub-pixel width stored while the display is rounded: MIN-2 (FM-4) — FIXED

- `ElectronLayoutService.setAppsSplitWidth` (`electron-layout.service.ts:215-222`) now applies `Math.round` after clamping. Restore goes through the same setter, so a fractional persisted value is rounded too.
- Spec: `electron-layout.service.spec.ts:1188` (360.75 -> 361, 420.4 -> 420, 239.6 -> 240).

### 5. The other findings

| Finding | What happened |
| --- | --- |
| Subagent FM-5 / M-5: nested `role="separator"` | Noted for the visual/a11y review, as instructed. The outer slot (`apps-page.component.ts:247-263`) wraps the unchanged handle's inner `role="separator"` (`chat-ui/.../electron-resize-handle.component.ts:36-39`). No code change. |
| Antigravity Q5: Shift step not announced | Fixed. `aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"` added at `:254`, and asserted in the a11y spec at `:228`. |
| Antigravity Q3: container under 366px pins the max to 240 | Does not apply. At 480px or less, `stacked()` removes the separator and the container query stacks the columns (`:104-117`, `:246`). The clamp never inverts (`Math.max(min, …)`). |
| Both reviews, Q1: non-finite values dropped silently | Deliberate, and both reviewers agree it is not a defect. It matches the other setters in the file. No change. |
| Subagent carry-forwards (481-605px band, service length, `workspaceFolders` never persisted, flaky `apps-submit-flow`) | Already ruled on by the coordinator and not re-raised. The service is now 824 lines; the only change is the 2-line `Math.round` wrap. |

## Assertions changed because they encoded the old behaviour

Neither change weakens a check.

| Spec | Old assertion | New assertion |
| --- | --- | --- |
| `apps-page-splitter.spec.ts:294` (was "keeps the handle's Escape restore exact, then commits the restored width") | One `setState` with 360 after Escape. That is exactly the MOD-2 behaviour being removed. | Zero `setState` calls. The exact-restore assertion (360) stays, and the column must also show `360px`. |
| `apps-page-splitter.spec.ts:324` ("clamps key resizes and leaves other keys alone", container 700) | Shift+ArrowRight at the max set the stored value to 334. That is the S-1 overwrite, since the shown width was already 334. | The display stays clamped (`aria-valuenow` 334) and the stored 360 is kept. The rest of the test is unchanged (240 floor, other keys not prevented). |

## Red/green evidence

**Before the fix.** The new specs were first run against the unfixed code: 9 of 21 splitter tests failed, and the rounding spec failed (`Expected: 361, Received: 360.75`).

**After the fix.** I temporarily reverted each fix hunk, ran the splitter spec, then restored the file from a byte copy. `cmp` confirmed the restored file is identical.

**Item 1 hunk reverted** (`:372` `target`, and `:400` without `|| target === shown`): 4 failed, 17 passed, 21 total. The failures:
- clamps key resizes and leaves other keys alone;
- ArrowRight at the max keeps the stored 900 and persists nothing;
- Escape after a visible drag restores the stored 900, not the shown 634;
- a drag with no visible change keeps the stored 900 and writes nothing.

**Item 2 hunk reverted** (`:384` replaced by `if (true)`, which is an unconditional commit): 6 failed, 15 passed, 21 total. The failures:
- a plain click without movement writes nothing;
- a window blur cancel writes nothing;
- destroying the page mid-drag with no change writes nothing;
- keeps the handle's Escape restore exact and writes nothing;
- Escape after a visible drag restores the stored 900…;
- a drag with no visible change keeps the stored 900….

**Restored:** 21 passed, 21 total.

## Test counts

- core: 33 suites, **901** tests passed (was 900, +1 rounding spec).
- mcp-apps-page: 16 suites, **280** tests passed (was 270, +10). `apps-page-splitter.spec.ts` has 21 tests.

## Verification

- `npx nx run-many -t lint,typecheck,test -p @ptah-extension/core @ptah-extension/mcp-apps-page --skip-nx-cache --parallel=2`
  - Exit 0: `Successfully ran targets lint, typecheck, test for 2 projects`.
  - Each target passed: core test/typecheck/lint and mcp-apps-page test/lint/typecheck.
  - This time no `apps-submit-flow` flake occurred.
- `npx tsc -p libs/frontend/mcp-apps-page/tsconfig.spec.json --noEmit` shows exactly the 8 baseline errors:
  - `mock-rpc-service.ts:54,60,66,69`;
  - `monaco-loader.service.ts:113,151,171,187`.
- `npx prettier --check` on the 4 files: all clean.

## Notes for the visual review

- Nested separator: do a screen-reader spot check for a double announcement.
- Stored width wider than the container:
  - Arrow keys or a drag at the max must not move anything.
  - Widening the window must bring the stored width back.
- Escape during a drag snaps back with no flicker.
