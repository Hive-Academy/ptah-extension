# Scroll-sanity regression (M1) — root cause and C5-contained fix design

Task: TASK_2026_453_1eb4. Worktree HEAD `0149adef8`. Read-only analysis: no code, tests, perf runs,
`nx reset` or git writes were made. `W` = `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`.

## 0. Facts established first

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| F1  | **M0 did run the scroll check, and it passed on every run where it applies (8 of 8).** In the cold asserting test `assertScrollSanity` (spec `:286`) runs before the `wall=` log line (`:296`) and the budget `expect`s (`:350-351`). All M0 cold dev runs and the M0 production run print `wall=` and then fail only at `toBeLessThanOrEqual` (`m0-run1.log:283,312`, `m0-run2.log:283,314`, `m0-run3.log:283,308`, `m0-prod-cold.log:46,77`). The M0 diagnostic runs (trace 500/2000, rAF) and warm-3 end `1 passed` (`m0-trace-2000.log:286`, `m0-trace-500.log:286`, `m0-raf-attribution.log:286`, `m0-warm3.log:290`). Warm-1 has no check (spec `:420-500`). | logs, spec          |
| F2  | The harness has not changed in behaviour since M0. `git diff 93c41c41d 0149adef8` over `apps/ptah-electron-e2e/src/support/` and the perf spec changes comments only (C3 wording).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | git                 |
| F3  | Between M0 and M1, three product changes landed with no measurement in between: C2+C3 (`b9cc2f193`), C1 (`408ddffb2`), C5 (`b19077d03`). So "new since M0" does not by itself single out C5. §1 does.                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `git log`           |
| F4  | The check runs after the window closes. That happens after 1,000 ms with no tile mutation (`perf-page-capture.ts:233-252`), then `waitForTileMarker`, then `checkTileScrollSanity` (`:349-385`). It reads `scrollHeight - scrollTop - clientHeight > 120` once.                                                                                                                                                                                                                                                                                                                                                                                                    | harness             |
| F5  | Failing samples: cold run 3 `TILE_1` 132 px (`m1-run3.log:282`), trace-2000 `DIAG_COLD_TILE_2` 31,155 px (`m1-trace-2000.log:279`). Correction to test-report.md:484: `TILE_1` is the **middle** tile, not the last one clicked. Both are tiles whose replay was queued behind C2 admission.                                                                                                                                                                                                                                                                                                                                                                       | logs                |
| F6  | Slot pitch for a message that was never measured is 120 px (`PLACEHOLDER_FALLBACK_PX`, `transcript-render-window.ts:24`) plus the 12 px flex gap (`chat-transcript.component.css:38`, `gap: 0.75rem`), so **132 px**. 132 = 1 × 132. 31,155 ≈ 236 × 132 (= 31,152).                                                                                                                                                                                                                                                                                                                                                                                                | source + arithmetic |
| F7  | The fixture has about 190 turns, so about 380 bubbles. Each turn is a one-line user bubble plus an assistant bubble with 2-4 text deltas and 1-2 `Read` tool cards (`perf-session-fixture.ts:69-126`). Real heights sit on both sides of 120 px: user bubbles are likely shorter, assistant bubbles likely taller (Assumption A1). 2,000 events at `REPLAY_CHUNK_SIZE` 250 gives 8 chunks of about 48 messages. Chunks are separated by `yieldToMacrotask` only (`session-history-replayer.service.ts:100,204-219`), and a MessageChannel macrotask does not guarantee a render between chunks.                                                                    | source              |

## 1. Cause analysis (ranked)

### H1 — C5 turns replay into a stream of wrong-height mounts above the anchor, and they coincide with appends below it. The PR #519 unpin rule reads that as a user scroll-up and unpins for good. **Most likely. Confidence about 75% on the mechanism, about 85% that C5 is the change that exposed it.**

Chain, step by step:

1. **Before C5 (M0).** `streamingBoundary` was `finalizedCount`, so every replayed tree sat past the boundary and joined the always-mounted tail (`transcript-render-window.ts:128-130`). Nothing was windowed during replay. Layout changes during replay only **grew** content (appends, and `scheduleFrame` publishing nodes into mounted bubbles). At finalize, off-screen bubbles unmounted. Every slot had already been observed while mounted, so `handleEntries` had recorded a real height (`:179-184`, `wasMounted = tail.has(...)`). Each placeholder therefore reproduced its bubble's height and the unmount pass shifted nothing.
2. **With C5.** During replay the boundary is `totalCount` (`chat-transcript.component.ts:429-431`), so only the last 6 ids plus observer-reported ids mount (`transcript-render-window.ts:119-147`). A chunk appends about 48 messages. About 42 of them are born as **never-measured 120 px placeholders**, because they are never in a tail that the window syncs. This holds even more when several chunks run before one render (F7).
3. After the stick-to-bottom (`:591-604`), the observer reports those placeholders as intersecting: they are within `RENDER_WINDOW_MARGIN_PX` = 2,000 px (`:9, :91`). The next change-detection pass swaps each one for a real bubble (`chat-transcript.component.html:15-33`). The swap changes height by (real − 120), which is negative for short user bubbles. For a tail leaver that the observer has not yet reported, the swap goes the other way, bubble → 120 px (the A7 gap, plan C5 residual-risk item 1).
4. Most of these swaps are **above the scroll anchor**. `overflow-anchor: auto` (`css:26-27`) moves `scrollTop` by the height delta, so a shrink moves `scrollTop` **up**.
5. The replay does not pause for layout. If the same change-detection pass also appends the next chunk, or grows any node below the anchor, the one layout has both effects: `scrollTop` went up, and `distanceFromBottom` is now > 1.
6. `onScroll` (`:562-583`): `movedUp = top < lastScrollTop - 1` is true and `distanceFromBottom > 1` is true, so `pinnedToBottom = false` and the pending stick is cancelled. The rule assumes that anchoring keeps the bottom distance unchanged (comment `:245-250`). That is only true when nothing below the anchor changes in the same layout. The plan's re-check, C5 item 1 ("No new unpin path"), made the same assumption.
7. **Nothing re-pins.** Re-pin needs a scroll event with a distance < 120 (`:580-582`). Later appends grow content without firing any scroll event. The `ResizeObserver` stick (`:640-642`) is gated on `pinnedToBottom`. Each later message adds 132 px below (F6).

**Magnitude check.** 31,155 px ≈ 236 messages at 132 px, which is about 5 of 8 chunks. That fits an unpin after the third chunk of `TILE_2`. 132 px is exactly one slot pitch: an unpin on the last append of `TILE_1`. The tail's real heights make the match approximate, so this is inference, not proof. Both values are **stable states**. An unpinned tile never returns to the bottom, so the 1,000 ms quiet window does not hide them. This also explains the timing dependence (2 of 11). A failure needs a frame that holds both a mis-sized swap above the anchor and growth below it. C2's admission hand-off (macrotask plus rAF/50 ms race, `:279-305`) changes how chunks line up with frames, but it cannot cause the swap.

**Why not C1 or C2 alone.** C1 only changes animation classes and the `isFinalizing` input (opacity, no layout). C2 only reorders replays. Neither changes the mount set or placeholder heights, and without C5 every replayed slot is measured before it can become a placeholder (step 1).

**Classification.** A **C5 regression** that exposes a **latent PR #519 assumption**: the unpin rule cannot tell an anchoring adjustment from a user scroll when content below changes in the same layout. Before C5 no production path produced a shrink above the anchor while pinned, so the assumption held.

### H2 — Finalize-edge swap. **Contributing, lower. About 10%.**

`finalizeSessionHistory` and the flag clear run in one synchronous task (`session-history-replayer.service.ts:221-226`), so one change-detection pass sees them together. The boundary goes from `totalCount` to `finalizedCount`, and after finalize those are equal, so the mount set does not change. The pass can still change the height of tail bubbles (finalized message object, stats footer: Assumption A2) while observer-driven swaps above are pending. That is the same shape as H1 at the last moment, and it is the likely source of the 132 px case if it was not a chunk append. The fix in §2 covers it by deferring the release by one frame.

### H3 — Skeleton height changes `clientHeight` without a content resize. **Unlikely. About 5%.**

The skeleton (`html:39-56`) is a sibling of the scroll container. Showing it shrinks `clientHeight` while the content `ResizeObserver` (`:632-645`) stays silent, so no stick runs. But C5 did not change `streamingCount` or `isStreaming`, the skeleton shows only before the first chunk, and a hidden skeleton lowers the distance. It does not explain 31,155 px.

### H4 — Harness race or defect. **Unlikely. About 5%.**

The sample is taken after 1,000 ms without a mutation, so no replay chunk or stick frame is pending. A pinned tile ends ≤ 1 px from the bottom after its stick. The 120 px threshold equals `NEAR_BOTTOM_PX`, but the tile at 132 px is genuinely unpinned (H1 step 7). It is not a rounding miss. The marker lookup by `textContent` is correct because the marker is in the last assistant bubble, which is always in the tail. No harness change is warranted.

### Ruled out

- **`restoreScrollOnActivation`.** It fires only on a hidden→visible edge, and at that point `pinnedToBottom` is still true on a first show.
- **The boundary flip itself.** No mount-set change (H2).
- **`lastScrollTop` staleness.** A stale lower value would make `movedUp` false, not true.

### Assumptions to confirm (cheap, optional, before or with the fix)

- **A1.** The fixture's user bubbles render shorter than 120 px and its assistant bubbles taller. Check: read slot heights in a tile after settle (DevTools, or a throwaway `page.evaluate`).
- **A2.** Finalize changes tail bubble height. Check the same way, before and after finalize.
- **A3 (discriminating, optional).** On a throwaway local build, temporarily bind `streamingBoundary` to `finalizedCount` and run the §2.4 loop. Zero failures in 20 runs confirms C5 as the trigger. Do not commit it.

## 2. Fix design (inside C5's files)

### 2.1 Chosen approach — replay mount retention in `TranscriptRenderWindow`

The invariant is: **while a tab replays, the mount set only grows at the tail and never swaps a slot between bubble and placeholder.** Then the only layout change during replay is growth below the anchor. That produces no `movedUp`, so `onScroll` cannot unpin, and the existing `ResizeObserver` stick follows it. Swaps that correct heights happen once, after replay, when nothing is appended below. Anchoring then keeps the distance at 0, and `onScroll`'s `distanceFromBottom > 1` guard holds.

**`transcript-render-window.ts` (MODIFY).** One new policy input, same pure-object style as `setActive` (`:137-140`):

- `setReplayRetention(active: boolean)`:
  - When turned on: seed a `retained` signal set with every currently mounted id (`tail ∪ intersecting`), so the rising edge unmounts nothing.
  - When turned off: clear `retained`.
- `syncMessages` (`:119-135`): while retention is on, union each `nextTail` into `retained` (monotonic).
- `evictAbsent` (`:201-220`): also prune ids from `retained` that are no longer present.
- `isMounted` (`:143-147`):
  - Retention on: `tail.has(id) || retained.has(id)`. Observer-reported ids that were never mounted are **not** mounted.
  - Retention off: unchanged.
- `handleEntries` (`:166-199`): `wasMounted` also counts `retained.has(id)`. Heights are then recorded from each retained bubble's first observer callback (the callback fires for every newly observed slot), and the observer keeps updating `intersecting` as today. When retention ends, retained ids that are off-screen become placeholders at their measured height (no shift). On-screen ids stay mounted through `intersecting`.
- Keep `sameSet` short-circuits so unchanged syncs do not write the signal.

**`chat-transcript.component.ts` (MODIFY).** Only the render-window feed effect (`:527-540`) and cleanup (`:650-664`, which is not a forbidden method) change. No change to `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation` or `lastScrollTop`.

- Rising edge. The feed effect reads raw `historyReplaying()`, the same source as `streamingBoundary` (CLAUDE.md rule 7, "Replay boundary"). On a false→true edge, call `renderWindow.setReplayRetention(true)` **before** `syncMessages` in the same effect run. Keep the edge in the feed effect so ordering does not depend on effect creation order.
- Falling edge. Do **not** release in the same change-detection pass as finalize (H2). Schedule the release on the next animation frame with a private `retentionReleaseRafId` field that is separate from `scrollRafId`, so the scroll-owned frame is never cancelled or reused. The frame calls `setReplayRetention(false)`.
  - A new rising edge cancels the pending release.
  - `cleanup()` cancels it.
  - Assumption A4: one frame is enough for finalize's resize to be observed. If the Electron re-check (§2.4) still shows H2-shaped misses (small distances), extend the release to "after the replay motion hold ends". Use the existing `replayMotionHold` falling edge, not a new timer. That reads the hold only for retention, never for the boundary, so rule 7 stands.
- Hidden transcript. `handleEntries` already ignores callbacks while inactive (`:167`). Retention simply persists across the hide.

**`chat-transcript.component.html`.** No change.

### 2.2 Cost and behaviour trade-offs (record in the review)

- **Mounted bubbles during replay:** ≤ 6 × (number of feed-effect syncs during replay) + the pre-replay mounted set. With 8 chunks that is ≤ about 54, against about 380 before C5 and about 20-40 under C5 today. That is inside the plan's "≤ 2× settled" target, so C5's `scheduleFrame` win (isStreaming=false) is untouched. After release the window returns to tail + intersecting. The one-time height-correcting mounts land in the settle window. They are expected to be small, and M1-style runs confirm it.
- **Visible behaviour during replay:** the region directly above the newest six messages can show blank placeholders until replay ends (typically < 2-4 s). With the fixture's bubble sizes the tail usually fills a tile viewport. A user who scrolls up during replay sees placeholders until release. That is acceptable for a transient replay, but the orchestrator should state it.
- **Acceptance-criterion change (flag to orchestrator; not a forbidden file):** S1-AC4 and the plan's C5 text say "tail of 6 **and observer-reported ids** mount" during replay. This fix changes the rule to "tail (monotonic) during replay; observer-reported ids mount after replay". The existing spec asserts an intersecting report mounts slot 0 while replaying (`chat-transcript.replay-mount.spec.ts:297-301`). That assertion must be rewritten, not deleted. The A7 half (a mounted slot leaving the tail stays mounted) still holds, now by retention.

### 2.3 Rejected alternatives

- **Plan's suggestion: keep previous-tail ids until the next observer callback.** It closes only the A7 gap (tail leaver → 120 px). It leaves the main source untouched: observer-driven swaps of never-measured 120 px placeholders above the anchor while chunks append.
- **Measure leaving-tail slots synchronously in `syncMessages` (`getBoundingClientRect`).** It forces a layout per sync on a large DOM, which works against AC-11. It still leaves the never-tail placeholders unmeasured.
- **Stick on the replay falling edge (set `pinnedToBottom = true`, call `scheduleStickToBottom()`).** It writes scroll-owned state, and it breaks the scroll-work rule that a user who scrolls up during replay is not pulled back (plan C5 item 2). It also does not stop an unpin mid-replay from hiding content. That is a user decision, not a C5 fix.
- **Drop windowing during replay, keep only `isStreaming=false`.** It gives up the mount-volume half of C5's expected recovery while AC-11 is still failing.
- **Robust root fix in `onScroll`** (treat a move up as anchoring when `scrollHeight` or the content height changed since the last scroll event). This is the only fix that also protects live streaming against future placeholder corrections. **It touches a forbidden method, so it is a user decision.** It is not required for this regression if §2.4 passes. Residual risk without it: after replay, a height-correcting mount above the anchor that coincides with live-stream growth below can still unpin. That hazard already exists in PR #519 for any placeholder correction. C5 enlarged it by leaving about 370 slots unmeasured after replay (only those within 2,000 px of the viewport are corrected, once).

### 2.4 Unit specs (jsdom) — what would have caught it

jsdom has no layout, no scroll anchoring and no scroll events. No unit spec can reproduce the unpin. The specs pin the **precondition**: no bubble↔placeholder swap and no mount of an unmeasured slot while replaying. The current spec suite does not assert it, so C5 shipped without it.

`transcript-render-window.spec.ts` (MODIFY; pure policy, local fake observer as already used there):

1. Retention on, ids leave the tail with **no** observer callback: they stay mounted. This is the A7 gap and would have failed against C5 today.
2. Retention on, an observer reports a never-mounted id intersecting: `isMounted` stays false.
3. Retention on, an observer reports a retained id non-intersecting with height 200: it stays mounted. After retention off it is unmounted and `placeholderHeight` is 200, not 120.
4. Rising edge seeds from the mounted set: an intersecting id stays mounted when retention turns on.
5. `syncMessages` without an id prunes it from `retained`. Retention off restores `tail ∪ intersecting` exactly, with existing tests unchanged.

`chat-transcript.replay-mount.spec.ts` (MODIFY; existing harness `:256-286`, rAF spy `:267-272`):

6. **Monotonic mount set while replaying.** Start at 50 trees, then 98, then 146, with `detectChanges` and an interleaved `observer.emit` marking middle slots intersecting. Across the steps, no slot that held a `ptah-message-bubble` loses it, and no slot outside the synced tails gains one. This is the component-level form of the precondition, and it would have failed against C5.
7. **Deferred release.** Flip `historyReplaying` false and call `detectChanges`: retained bubbles are still mounted in that pass. To observe the deferral, replace the spy's synchronous callback with a queued one for this test. Then flush the queued rAF and call `detectChanges`: non-intersecting retained slots become placeholders with the recorded height.
8. Rewrite `:297-301` to the new rule (mount after release). Keep the A7, `isStreaming=false`, live-throttle and live-exempt tests (`:288-362`) green.
9. Gate A and the scroll specs in `chat-transcript.component.spec.ts` stay green and unedited, as does `execution-node.render-throttle.spec.ts`.

Commands: `npx nx run-many -t test -p @ptah-extension/chat` (check the header says 1 project), then typecheck and lint `@ptah-extension/chat`. Diff check: no hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation` or `lastScrollTop`; no diff in `chat-transcript.component.css`; no `content-visibility`.

### 2.5 Electron re-check protocol (after the fix commits, before Stage 2 code)

- Machine idle. Before and after **every** run, the M0/M1 idle command (test-report.md:421) must return `0`. Dev build (`build-dev` + `copy-renderer-dev` via the e2e target). `PTAH_PERF_SPECS=1`. Keep `PTAH_PERF_OUT_DIR` outside the repo.
- Runs:
  - **10×** the asserting cold test (spec `:191`). This is the shape that produced the 132 px miss. A budget failure after the scroll check still counts as a scroll PASS, and the `wall=` line proves it.
  - **10×** the diagnostic cold test (spec `:354`) with `PTAH_PERF_TRACE=1 PTAH_PERF_EVENTS=2000`. This is the shape that produced the 31,155 px miss.
  - **3×** warm 3-tile (spec `:502`).
- Pass: **0 scroll-sanity failures in 23 attempts.** At the M1 rate (2/11 ≈ 18%), the chance of 20 clean attempts by luck is 0.82^20 ≈ 2%.
- On any failure, record tile, distance and run shape. A distance that is a multiple of about 132 px means H1 is not closed. A small distance under 132 px means H2: apply the A4 extension and repeat. If H1 persists, escalate the `onScroll` fix (§2.3) as a user decision.
- The same runs give updated DOM-during-replay and long-task numbers. Report them beside M1 but do not treat them as a new AC-11 verdict unless the orchestrator asks.

### 2.6 Forbidden-file statement

The fix needs **no change** to `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`, `chat-transcript.component.css`, and adds no `content-visibility`. Files: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.ts`, `...\transcript-render-window.spec.ts`, `...\chat-transcript.component.ts` (feed effect + cleanup only), `...\chat-transcript.replay-mount.spec.ts`. The template is unchanged. Doc follow-ups for the team-leader: `libs/frontend/chat/CLAUDE.md` rule 7 "Replay boundary" bullet (add the retention rule), and the S1-AC4 / plan C5 wording (§2.2). The only fix that also covers live-stream coincidences is in `onScroll` and is optional (user decision).

## 3. Interaction with Stage 2 option (ii) tail-paged history

- Paging replays only the newest page, so there are fewer chunks and fewer unmeasured placeholders, and the H1 coincidence window shrinks. Retention's mount cost also drops.
- Loading an older page **prepends above the anchor**. That is the same "change above, possibly growth below" shape. A page-in while pinned with a live stream running can unpin through the PR #519 rule.
- Option (ii) should reuse `setReplayRetention` (or the same monotonic-mount rule) around a page-in, and give prepended slots a real measured height before they can swap. It should not add a second window mechanism.
- If (ii) lets page-ins happen while the tile is pinned, the `onScroll` anchoring-aware fix (§2.3) stops being optional and becomes a prerequisite user decision.
