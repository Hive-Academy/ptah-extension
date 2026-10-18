# Code Logic Review - B7 fix round (TASK_2026_683_3c29)

Scope: re-review of `chat-transcript.component.ts` (scroll restore, `cancelScrollFrame`, pinned follow),
`chat-transcript.scroll-restore.spec.ts`, one expectation in `chat-transcript.component.spec.ts`, and the
entrance-edge handling that the lane added to make `session-enter.spec.ts:126/:228` pass. Read-only. One
single-file Jest run: `chat-transcript.scroll-restore.spec.ts` 7/7 pass.

## Verdict: APPROVED (0 blocking, 0 serious, 0 moderate, 2 minor)

## Earlier Moderate findings

| Finding | Status | Evidence |
| --- | --- | --- |
| Moderate 1: dropped follow / cancel-by-scroll leaves a pinned transcript unfollowed | FIXED | `chat-transcript.component.ts:1242` captures `restorePending` before mutating; `:1250-1261` updates pin state first, then `cancelScrollFrame()` and `if (this.pinnedToBottom()) this.scheduleStickToBottom()`. The ref is nulled by `cancelScrollFrame` (`:1342-1343`) so the `:1280` swallow guard no longer blocks the re-arm. The upward-scroll branch (`:1250-1253`) still unpins and returns, so a user scroll-up wins. The queued rAF re-checks `pinnedToBottom` (`:1287`). Regression test `scroll-restore.spec.ts:139-156` queues a restore, confirms the follow is swallowed (`frames` length unchanged), cancels with a still-pinned scroll, and asserts the frame reaches the bottom. It passes. |
| Moderate 2: stale `scrollRestoreRef` when write is skipped by `!workActive()` | FIXED | `:1301-1303`: generation check first (a newer restore owns the ref and is not nulled), then `scrollRestoreRef = null`, then the `workActive()` guard. The ref cannot stay non-null after the callback ran. |

## The entrance fix (`session-enter.spec.ts:126`, `:228`)

Root cause as given by the lane: a retained pinned transcript kept its old native `scrollTop` at the entrance edge,
so the earlyRead projection picked the wrong slot (`B-1` instead of `B-11`); and in a rapid A -> B -> A
`entering` rose after A had already activated, so no restore was scheduled.

Assessment: genuine, not test-shaping.

- `transcript-session-entrance.ts:67-72` projects the viewport as `rect.y + (scrollHeight - clientHeight - scrollTop)`.
  In a real browser slot rects move with `scrollTop`, so the projection is invariant to `scrollTop`; a hidden
  (`display:none`) scroller reads 0 anyway. The spec mock (`session-enter.spec.ts:77-84`) returns slot rects that
  ignore `scrollTop`, so only `scrollTop = 0` matches real hidden-tab geometry. Resetting to 0 at the edge
  (`component.ts:1064-1077`, `:1126-1133`) therefore aligns the model with production and is harmless there.
- The earlyRead still sees the D11 projected viewport: the reset runs in the effect, before the render pass.
  `TranscriptSessionEntrance.setEntering` registers the `afterNextRender({earlyRead, write})` and the restore
  registers a `write`-phase hook, so earlyRead runs before the restore write and measures the pre-restore state
  with the bottom projection (`:67-72`) intact. The unpinned branch (`:63-65`) still returns the pane fade and
  the saved offset is untouched (the reset is guarded by `pinnedToBottom()`).
- The second fix (re-arming on the entrance edge, `:1073`) is idempotent when both effects fire in one flush:
  `restoreScrollOnActivation` cancels and replaces the previous ref (`:1166`, `:1210`) and `setEntering` is
  a no-op on an unchanged value (`transcript-session-entrance.ts:36`). Last write wins, one write executes.
- B4 specs and `transcript-session-entrance.ts` are unmodified relative to the lane's claim (`session-enter.spec.ts` is
  untracked, so there is no diff; its contents exercise the described cases).

## New defects

None above Minor.

### Minor 1 - the post-reactivation stale-frame assertion is now vacuous
- File: `chat-transcript.component.spec.ts:218-220`
- After reactivation `scrollTop` is already 1000. A stale frame that wrongly ran would only write when
  `el.scrollTop < scrollHeight - clientHeight` (800, `component.ts:1292-1294`), so it no-ops regardless of the
  generation guard. The `:213-214` check (still inactive, `scrollTop` 300 stays 300) still proves the
  `workActive` guard, but the generation guard after reactivation is no longer proven by this test.
- Fix: set `container.scrollTop = 300` after the `:218` assertion and before `staleFrames.forEach(...)`, then assert 300.

### Minor 2 - formatting
- `chat-transcript.component.ts:1300-1310` (`afterNextRender({ write: () => {` / `} }, { injector ... })`) is not
  prettier-shaped. Style only; route to code-style.

## Residual uncertainty

- `ptah_get_diagnostics` type check was unavailable per the lane report; types were not independently verified,
  though the 20/20 suite run implies compilation under ts-jest.
- The scroll-cancels-restore rule now applies to any scroll event during the pending window. In production the
  effect and the render hook share a tick, so the window is closed before a native scroll event can land.
