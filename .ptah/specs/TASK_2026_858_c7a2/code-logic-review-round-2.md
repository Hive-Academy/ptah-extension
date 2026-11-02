# Code Logic Review, Round 2 (TASK_2026_858_c7a2)

Review family: claude vs codex

Verdict: APPROVED (with Moderate follow-ups; no Blocking or Serious findings)
Score: 7/10

Scope: fix round 1 for D1 (double enter on streaming to finalized swap) and D2 (stagger suppressed on every tab edge). Read the full diff and `transcript-motion.directive.ts`, `transcript-entrance.ts`, the chat-view effect and `startEnter`, and the replay and finalize hold signals. I did not run anything; the lane reports `npm run verify -- -p @ptah-extension/chat` as passing on the current tree, and I took that as given.

## D1: streaming to finalized swap

Resolved for the common shape. In `[user, streaming-asst]` to `[user, final-asst]`, `isTailSwap` is true (`transcript-entrance.ts:34-44`), so `planEntrance` returns an empty map and no second enter happens. The directive then sets `cutAll` (`transcript-motion.directive.ts:68`), the old row gets `data-ptah-leave-cut`, and the CSS gives it `display:none` (`chat-transcript.component.css`, leave-cut rule). The new row takes the same slot, so there is no layout jump.

## D2: always stagger on open

Resolved. The `activationCatchUp` suppression applies only when previous ids overlap the next ids, so a first open batch on a tab edge still staggers (`directive:46-52`). The `openBatch` branch in `planEntrance` bypasses the `replaying` and `pinned` gates for the first batch, and prepend never animates because `isStrictHeadPrepend` runs first. A loaded-tab return reuses the persistent per-tab component and its existing `previousIds`, so there are no added ids and no re-stagger; only the pane opacity crossfade runs. The pane keyframe is now opacity-only (`css:2-10`).

Pending class: it cannot get stuck in practice. `pendingEntranceTabId` is cleared only when `entranceContentReady()` is true, and that is true whenever the tab has messages (`chat-view.component.ts:1088-1096`). Paused rows only exist once messages exist. If the user switches away first, `paneSwitching` goes false for that tab and its rows resume. Reduced motion does not skip `startEnter`, and the CSS shortens the durations to 0.01 ms, so nothing is left paused. The prepend case is covered separately.

## Findings

1. Moderate: `isTailSwap` requires at least 2 rows and at least one unchanged leading row (`transcript-entrance.ts:34-38`). Two shapes then fall through to the "open batch" path and re-enter.
   - A single-row transcript where the streaming row is replaced by the finalized row (length 1).
   - Any swap where the user row id also changes in the same pass, for example an optimistic id replaced by a real id (`firstChanged` is 0).
   - In both cases `!nextIds.some(prev)` is true, so the batch is treated as a fresh session open. The row gets a second enter and a stagger, which is the original D1 symptom.
   - Suggested fix: when the old and new tails are all-different and equal in count, treat it as a swap even with no shared prefix, but only if not `replaying` and the previous list is non-empty.
   - I did not confirm whether the optimistic-id shape occurs; the lane only argues the streaming and finalized ids come from different records.

2. Moderate: `isTailSwap` has false positives (`transcript-entrance.ts:34-44`).
   - Any equal-count tail replacement counts as a swap and suppresses the enter for the new rows, even when it is a genuinely new message.
   - Examples: rewind of N rows plus a resend of N rows in one pass; remove a transient placeholder row plus append a new row.
   - Effect: a new message appears with no entrance, and the removed rows are cut. No data loss.
   - Multi-row tail replacement is handled correctly, since the sets are compared.

3. Moderate: the first history batch may be partial. If the replayer emits rows incrementally, only the first emitted batch is an open batch. Later chunks hit `replaying && !openBatch` and do not animate, so a "stagger the opened session" could animate 1 to 2 rows instead of 6. This depends on replay chunking and I could not confirm it; the Electron visual run should check it.

4. Minor: `isFinalizingTransition` passes `suppressed` to the directive for 300 ms after streaming ends. A user message sent inside that window gets no entrance (`html` `[suppressed]`, `component.ts:1282-1290`).

5. Minor: Angular's `animate.enter` fallback timer runs on wall-clock time. If rows stay paused by `.ptah-pane-switch-pending` longer than their delay plus 320 ms, the enter class could be removed while still paused. In practice the pause lasts about one effect tick, because ready is true as soon as rows exist, so this is theoretical.

6. Minor: the motion class and the `--ptah-msg-i` index stay in the directive's `entrances` map for the row's lifetime. This relies on Angular removing the enter class after the animation. If it does not remove it for a tab that was `display:none` during the enter, a tab show could replay the animation. I could not confirm either way.

## Checklist from the task

- Real new message appended while another tail row is removed in the same pass: swallowed only when the counts are equal (finding 2). Otherwise it enters normally.
- Rewind plus send in one pass: equal count is swallowed (finding 2); different counts behave normally.
- Multiple tail rows replaced: handled.
- Pending class paused forever: not found.
- Loaded-tab return: no re-stagger.
- Prepend: never animates.
- Reduced motion: durations go to 0.01 ms, and the leave rows are hidden.
- Verification: the lane's last test-only edit was not re-run (see `fix-R1-report.md`). The lane's reported `npm run verify -- -p @ptah-extension/chat` pass on the current tree stands for the other changes. I did not re-run it.
