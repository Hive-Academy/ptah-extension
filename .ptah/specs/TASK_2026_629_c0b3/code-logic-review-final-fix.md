# Code Logic Review: final-run fix round (commit 3aa592e66, F3-F7)

Score: 7/10. Verdict: PASS (no Blocking or Serious finding; the Moderate items are worth a follow-up).

Scope: the full diff of 3aa592e66 plus the surrounding code it depends on. Read in full:
`compact-session-card.component.ts`, `compact-lane-rows.ts`, `canvas-lane-tabs.component.ts`,
`lane-owner.ts`, `chat-input.component.ts` (draft paths), `composer-draft.store.ts`,
`canvas-tile.component.ts` (click, keydown, `isInteractiveTarget`), `canvas-needs-you-queue.component.ts`,
`native-popover.component.ts`, `canvas-detail-geometry.ts` and its caller. No live app was run, and the lane did
not run one either (lane report, "Anything not done"). Every verdict below is from reading code.

## F3 (card lanes): fixes the defect, with two Moderate side effects

The root cause is confirmed. `sessionSubagentsForSession` keeps only background records
(`chat-streaming/.../agent-monitor.store.ts:966-973`, `isBackgroundSessionSubagent`). Foreground Task records were
dropped, and `ACTIVE_SESSION_SUBAGENT_STATUSES` also dropped finished ones. The card now filters the full map by
`parentSessionId === sessionIdentity()` (`compact-session-card.component.ts:156-163`).

- Identity: the card uses `claudeSessionId ?? tab.id`. The detail uses `tab.claudeSessionId ?? null`
  (`canvas-detail-panel.component.ts:110`) with the strict `ownedBySession` match (`lane-owner.ts`). The two agree
  whenever the session is resolved. While it is unresolved the card falls back to `tab.id`, which no record
  carries, so it shows nothing and does not mis-attribute. The detail shows no lanes in that case, so they agree.
- Records with an unknown parent (`parentSessionId` undefined) were visible in every tab via `agentVisibleInSession`
  before. They are now hidden on the card, as they are in the detail. This is the right call.
- Double counting: none. CLI rows come from `agentsForSession` (a different store list). The new subagent set is a
  superset of the old one. A background record that has finished now appears as a `subagent` row where it used to
  disappear. That matches the detail's tab grouping.
- Workflow-run records (`workflowRunId`) were excluded before and now show up on the card. The detail already
  lists them, so this is consistent. It was not mentioned in the report.

1. Moderate. The done and stopped rows are not bounded by recency. `compact-lane-rows.ts:75-101` gives sub-agent
   rows `startedAt: null`. The sort (`:104-108`) falls back to `(b.startedAt ?? 0) - (a.startedAt ?? 0)`, which is
   0, so ties keep map insertion order. The card shows 3 rows (`max = 3`), so after a few finished Tasks the oldest
   finished ones fill the visible rows and the newest hide behind "+N more". `total` and `counts` also include
   every ended record for the life of the session. Fix: set `startedAt` from the record's first-event time, or
   sort ended rows by `endedAt` descending.
2. Moderate. `laneSummary` now depends on the whole `subagents()` map (`compact-session-card.component.ts:156-163`).
   Every sub-agent event in any session, including `lastEventAt` bumps, re-runs the filter and `buildLaneSummary`
   in every card. The `computed` returns a fresh object, so the template re-renders each time. The class comment
   above `tabId` (`:129-133`) says the card is built to avoid exactly this. Fix: select by session in the store, or
   give `laneSummary` a value-equality function. This is not a correctness problem, only cost per streamed event.

## F4 (70% floor): PASS

`heightPx = max(round(0.7 * H), H - selected.h * cellHeight - 16)` (`canvas-detail-geometry.ts:34-37`). Only
`heightPx` changed. `rowEnd` and `topPx = rowEnd * cellHeight` are untouched, so the row-bottom placement (top
8 px under the row) and `belowIds` are unchanged. The rows below are displaced through `--ptah-detail-h` and
`detailGeometry().heightPx` (`canvas-workspace-grid.component.ts:87, 116, 143`), so a taller detail only grows the
scroll height. That is what B6 requires (the earlier run saw scrollHeight 1190 against 967).

3. Minor. For short tile rows the second term dominates, as before, so nothing regresses. In a short window
   (H ~ 600) the detail is 420 px plus a scroll. That is acceptable but unchecked. If `containerHeight` is 0 before
   the first measurement, the result is 0, the same as before.

## F5 (draft skip when unchanged): PASS, with a coverage gap

The snapshot compares text, `files` identity and `images` identity (`chat-input.component.ts:1569-1594`).
Updates always create new arrays (`:910, :1332, :1339, :843, :857`), so any real edit changes identity.

- Clear to empty (text "a" to ""): the text differs from the snapshot, so it saves and goes through the
  `draftStore.clear` branch. OK.
- Attachments-only: the array identity changes, so it saves. OK.
- Tab switch inside one composer: `saveDraft` for the old tab runs first, `restoreDraft` then rebuilds the
  snapshot (`:1597-1607`), and `clearLocalDraft` resets it to null. OK.
- Send then remount: send sets the signals to new empty arrays and calls `draftStore.clear` (`:1488-1495`). The
  effect then runs `saveDraft`, which differs from the old snapshot and clears again. This is harmless and
  idempotent. A remount restores nothing. OK.
- Two composers on one tab: the older one has a stale snapshot, and a pristine one mounted before the older one
  saved no longer clears the draft on destroy. The reverse order is safe too. The older composer's snapshot equals
  its state, because the effect saves synchronously on every change, so destroy skips. If both are live and both
  are edited, the last writer wins. That is acceptable.
- The first effect run after construction is also skipped, because the snapshot was set in `restoreDraft`. OK.

4. Moderate. The lane's root cause (a pristine composer saving "empty" over the draft) fits the symptom only if
   that composer mounted before the old one's first save and was destroyed after it. This is plausible. It was
   never reproduced against the original code (the lane says so), and there is no live rerun of
   `s-draft3.mjs`. The spec shows the guard works. It does not show that the real flip sequence is the one the spec
   models. Re-run the flip steps in the real app before closing F5.
5. Minor. `saveDraft` returns early when the tab is not found (`:1571`) before the snapshot update. That is fine.
   But a stale composer whose state differs from the snapshot can still overwrite. The only such case is a
   deliberate edit, so nothing to fix.

## F6 (selection guard): PASS, narrow side effects

Ignores the click only if the selection is non-collapsed, has non-whitespace text, and its `anchorNode` is inside
the tile host (`canvas-tile.component.ts:694-704`). Keyboard open (`onTileKeydown`) and the interactive-target path
are unaffected.

- A stale selection cannot block later clicks in the normal case. A new mousedown collapses the selection, and
  `mousedown` + `click` on the same text opens the detail. A selection elsewhere does not match, because of the
  `contains(anchorNode)` check.
- A selection inside the card remains non-collapsed only if the mousedown was `preventDefault`ed or hit a
  `user-select: none` surface. Those clicks would then be swallowed until the selection is cleared. I found no
  such handler on the card body. Gridstack drag handling is not confirmed for the card in compact mode, which is
  why this is listed at all.

6. Minor. A drag from outside the card that ends inside it leaves `anchorNode` outside. If the click target is
   still the card, it opens the detail. Rare.
7. Minor. Double-click to select a word still fires a first click that opens the detail before the selection
   exists. This was already the case and was not part of F6.

## F7 (queue popover): PASS, one Moderate

Listeners are added only while `open()` is true and are removed in `onCleanup` (`canvas-needs-you-queue.component.ts:147-160`).
The effect re-runs only when `open` changes, and `onCleanup` also runs on destroy. The popover content is inline
inside the host (`native-popover.component.ts:82-98`), so `host.contains(target)` covers the trigger and the Allow
and Open buttons. A `pointerdown` on the trigger is inside the host, so only the trigger's `click` toggles it, and it
does not toggle twice. A `pointerdown` on a dock button or a tile is outside, so it closes the popover first and the
click still reaches the button. That fixes the original trap. `closeWhenAnswered` (`:162-167`) closes on the
non-empty to empty transition. `hadItems` is plain state set during an effect, which is fine here.

8. Moderate. The Escape listener is on `document` and does not call `stopPropagation`. Escape pressed anywhere
   while the popover is open closes it, and it also reaches the detail's Escape handler, which closes an open
   detail and may close other overlays. The popover's own host keydown (`native-popover.component.ts:68, 229`) also
   emits `closed`, so there are two closers (harmless). Fix: close on Escape only if focus is inside the host, or
   `stopPropagation` after closing.
9. Minor. `PointerEvent` is not available in jsdom, so the spec dispatches `MouseEvent('pointerdown')`. That is fine
   for the contract but means no real touch or pen path is covered.
10. Minor. The popover opened on an empty queue ("All clear") is not auto-closed, which is correct. If the last item
   is answered while the popover is closed and another arrives, nothing is affected.

## Cross-cutting

11. Moderate (process). Five defects were fixed with jsdom regression specs only. The lane ran the full chat and
   canvas suites, but nothing was re-run in Electron, and the specs were not shown red against the old code.
   F3, F5 and F7 are stacking-context, mount-order and timing defects that jsdom cannot show. Re-run the five real
   steps from `final-run-review.md` before marking them fixed.

## Five logic questions (short)

1. Silent failure: F3 now hides ended-record ordering (finding 1). F5's skip could hide a lost write only if a
   non-signal mutation changed the content, and none exists.
2. Unexpected user action: Escape closes more than the popover (8). A select-then-click-again sequence opens the
   detail (F6 discussion).
3. Wrong answer: a stale `total` and `counts` on the card (1).
4. Dependency failure: unresolved `claudeSessionId` gives an empty lane list on both the card and the detail.
5. Missing: de-duplication by `parentToolUseId` (the monitor panel does it, the card does not), a rendering
   bound on ended sub-agent records, and a live rerun.
