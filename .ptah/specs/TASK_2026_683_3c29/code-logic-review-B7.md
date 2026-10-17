# Code Logic Review - B7 (F6 first-frame scroll) - TASK_2026_683

Scope: read in full `chat-transcript.component.ts` scroll paths (:362-364, :1116-1150, :1231-1251,
:1278-1343, closeSubagent :870-887), `transcript-session-entrance.ts`, the new
`chat-transcript.scroll-restore.spec.ts`, `reports/batch-B7.md`, plan "### B7", `m0-summary.md` Q1.
Nothing was executed (per instruction). Angular is 22.1.7; phase ordering below relies on the
documented `afterNextRender` contract (all `earlyRead` hooks of the pass, then all `write` hooks)
and is not proven by a run.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVED (2 Moderate fixes recommended, none gating) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 |
| Minor | 4 |

## Answers to the five checks

1. **Restore in the activation render pass: yes.** The activation effect (:1117-1131) calls
   `restoreScrollOnActivation()` during change detection; `afterNextRender({ write })` registered
   in an effect during a tick runs in that tick's after-render phase, i.e. after the host
   `display:none` is lifted and the vm has caught up, and before the browser paints. Target is
   `scrollHeight` when `pinnedToBottom() || savedScrollTop === null`, else `savedScrollTop`
   (:1305-1309), same as the old rAF. This removes the one-rAF gap that M0 Q1 measured (scrollTop 0
   at frame 1/2). The subagent-close path (:878) is a click handler, not a tick; the registered hook
   still runs in the tick zone.js triggers at the end of that task, so no scroll event can
   interleave.
2. **Generation guard and cancellation are intact.** `cancelScrollFrame()` (:1337-1343) bumps the
   generation, cancels the rAF, and now also destroys and nulls the ref. Deactivation (:1124),
   re-activation (:1298), destroy (:1356) and user scroll (:1235, :1245) all go through it. A stale
   callback returns at :1301 before touching `scrollRestoreRef`, so it can never null a newer ref. No
   leak: the one-shot hook self-destroys after running, is destroyed on cancel, and the injector is
   the component's own. Only gap: see Minor 3.
3. **Deferral of pinned follow (:1280): released on the normal path, but the dropped call is not
   re-armed.** Walk-through: on activation, the restore effect (:1117) is created before the
   content-follow effect (:1135), so the ref is set when `scheduleStickToBottom()` runs and it
   returns early. The restore write then goes to `scrollHeight` at write time, which already includes
   any content the same CD pass produced, then nulls the ref (:1302), so every later follow works.
   Without the deferral, `scheduleStickToBottom()` calls `cancelScrollFrame()` (:1281), which would
   destroy the restore. The lane's decision is correct. Residual hole: the early return discards the
   follow instead of recording it (Moderate 1).
4. **Phase order with B4: holds.** `TranscriptSessionEntrance` registers `earlyRead` + `write`
   (transcript-session-entrance.ts:43-49); the restore is a `write`. Across sequences Angular runs
   all `earlyRead` before all `write`, so the entrance measures pre-restore geometry and the D11
   projection `scrollHeight - clientHeight - scrollTop` (:67-72) yields the post-restore bottom
   viewport. The branch conditions agree: the entrance picks the "pane" path iff `!pinned &&
   savedScrollTop !== null` (:62-65), which is exactly the restore's savedScrollTop branch;
   everything else projects to the bottom, which is where the restore goes. The comment at
   transcript-session-entrance.ts:~66 ("restores the bottom in a later frame") is now stale (Minor 2).
   B4 specs (`session-enter`, `transcript-entrance`) are untracked-new B4 files with no B7 edits in
   the diff.
5. **Spec quality: mostly discriminating.** Test (a) asserts `scrollTop === 900` and a recorded
   write of `1000` right after `activate()` with no timer advance; with the old rAF the value would
   still be 0 under jsdom, so it fails without the fix. The same holds for test (b) (saved offset).
   Tests (c), (d), (f) would also pass with only the generation guard (no ref destroy) and so do not
   pin the "AfterRenderRef is destroyed" requirement; test (e) pins the user-scroll cancel.
   Missing: follow-resumes-after-restore and the earlyRead-before-write ordering (Minor 4).

## Findings

### Moderate 1 - Deferred follow is dropped, not queued; cancel-by-scroll leaves a pinned transcript unfollowed
- File: chat-transcript.component.ts:1280 and :1235
- Scenario: restore pending (ref set) -> a content-follow call is swallowed at :1280 -> the restore
  is cancelled by `onScroll` (:1235) with a scroll that does not unpin (not `movedUp`, within or
  beyond NEAR_BOTTOM_PX of a pinned state), or by any future code path that cancels without
  re-arming. `pinnedToBottom` stays true, `scrollRestoreRef` is null, and no rAF is scheduled, so
  the transcript sits at its pre-restore offset (0 after display:none) until the next
  ResizeObserver size change. The window is zero-width in production today (hook and effect share a
  tick, so no scroll event can land between them), which is why this is Moderate, not Serious; the
  spec case (e) already exercises exactly that state (pinned true, nothing queued).
- Fix: re-arm in the cancel branch of `onScroll`, after the ref is gone:
  ```ts
  if (this.scrollRestoreRef) {
    this.cancelScrollFrame();
    if (this.pinnedToBottom()) this.scheduleStickToBottom(); // rAF re-checks pin, so a user scroll-up wins
  }
  ```
  placed after the `pinnedToBottom` update (move it below the `top`/pin logic) so the pin reflects
  the new offset. Alternative: keep a `followAfterRestore` flag set at :1280 and flushed in the write
  and in the cancel branch.

### Moderate 2 - Stale `scrollRestoreRef` when the write is skipped by `!workActive()` with a matching generation
- File: chat-transcript.component.ts:1301
- Scenario: the hook runs with `workActive()` false but the deactivation effect (:1123) has not run
  yet (e.g. surface/active flipped after the activation effect ran in the same tick). The callback
  returns without nulling the ref; the (already executed) ref stays non-null, so every
  `scheduleStickToBottom()` is swallowed (:1280) and `onScroll` keeps taking the cancel branch,
  until the deactivation effect calls `cancelScrollFrame()`. The deactivation effect does run, so it
  self-heals; the exposure is one effect flush of lost follow. Cheap to close.
- Fix: null before the guard on the executed callback:
  ```ts
  write: () => {
    if (generation !== this.scrollGeneration) return;   // newer restore owns the ref
    this.scrollRestoreRef = null;
    if (!this.workActive()) return;
    ...
  ```

### Minor
1. :1300-1311 is not Prettier-formatted (`afterNextRender({ write: () => {` ... `} }, { injector })`);
   lint-staged will reformat. Route to code-style-reviewer.
2. transcript-session-entrance.ts:~66 comment ("Activation restores the bottom in a later
   frame") is now inaccurate (restore is in the same pass, after `earlyRead`). Comment only; file is
   out of B7 ownership, fix in the next touch.
3. First creation (not re-activation): the restore `write` (phase `write`) now runs before the
   constructor's `afterNextRender` (mixedReadWrite, :1202-1214) that attaches the render window and
   binds the scroll listener, whereas the old rAF ran after it. Safe today because first creation has
   `savedScrollTop === null` (bottom) and the ResizeObserver set up in that later hook performs an
   initial pinned follow (`lastContentHeight` 0 -> real height, with the ref already null). Worth a
   single spec for "first creation, pinned, content grows after attach still follows".
4. Spec gaps: no test that a content change during a pending restore still ends at the bottom and
   that follow works after the write (the lane's own deferral decision is untested); no test of
   entrance `earlyRead` precedes restore `write`; (c)/(d)/(f) cannot distinguish `ref.destroy()` from
   the generation guard; the user-scroll tests call the private method out of tick via a cast.

## Failure modes

- Silent: Moderate 1 (swallowed follow), Moderate 2 (transient). No error is swallowed; no value is
  fabricated.
- Dependency failure: `scrollContainer()` null at write -> returns after nulling the ref (:1303-1304);
  follow is not lost. Missing ResizeObserver (jsdom) -> no follow from the observer, restore still
  works.
- Races: restore vs. entrance (ordered by phase, OK), restore vs. prepend-anchor/older-history
  directives (they react to scroll events/prepends after the write; unchanged).
- Disposal: ref destroyed on every cancel path; no timers added.

## Verdict

APPROVED, 7/10. The core F6 change is correct and minimal, matches D11 and the plan, and the
guard/cancel semantics are preserved. Apply the two small hardenings (Moderate 1 and 2) when
convenient; neither blocks the batch. Confidence: MEDIUM-HIGH (Angular render-hook ordering and the
spec results rely on the documented contract; the orchestrator's Jest run on
`scroll-restore`, `session-enter` and `transcript-entrance` specs is the confirming evidence).
