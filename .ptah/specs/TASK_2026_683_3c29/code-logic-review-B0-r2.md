# Code Logic Review B0, round 2 - TASK_2026_683_3c29

Reviewer: Claude (independent). Read in full: `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts` (516 lines) and `reports/batch-B0-fix.md`; cross-checked selectors against app sources. Nothing was run and `dist/` and `measurements/` were not touched.

## Summary

| Metric | Value |
| --- | --- |
| Score | 6.5/10 |
| Verdict | NEEDS_FIXES (M0 run is unaffected; fixes are needed before M1 is trusted) |
| BLOCKING-M0 | 0 |
| Serious (new) | 4 |
| Moderate (new) | 3 |

All four round-1 blockers are fixed. The remaining problems are in the new partial-write design, the S5 anchoring, the S6 retained loop and the M1 gate, so they do not stop the M0 recording but they would give a misleading or falsely failing M1.

## Round-1 defects

| Old defect | Status | Evidence |
| --- | --- | --- |
| 1 `getByTitle` substring | FIXED | Lines 449 and 452 use `sidebar.getByTitle(..., { exact: true })`, `sidebar = page.locator('ptah-workspace-sidebar')` (256; selector exists at workspace-sidebar.component.ts:23, rendered by electron-shell.component.ts:279). |
| 2 S8 opens a disabled "Open beside" | FIXED | 458-460 click card 0, open the menu on card 2, assert `aria-disabled` is not `true`. Holds in every iteration because the split is closed again before the next loop pass. |
| 3 hidden transcript chosen | FIXED | `activeScroller()` (97-98) requires client rects and no `[inert]` ancestor; used for `visibleAtSwitch`, placements (147) and scroll (166); header/composer use the same visibility filter (114-119). |
| 4 no failure-path write | PARTIAL | Works, but introduces N1 below. Per-window `finally` (338-348) also stops screencast, trace, observer and listeners. |
| 5 anchoring | FIXED for trusted clicks and Enter | `arm()` (170-178) starts samples, rAF chain and window from the capture-phase event; long-task filter, layout-shift filter and screencast (`clickEpochMs`, 304-311) are click-relative. Regression for untrusted clicks: N2. |
| 6 vacuous trace attribution | MITIGATED | Counts are `null` with `attribution: 'unavailable'` (217-220), and dropped frames are counted over all threads (214). The vacuous assertions are gone, but nothing replaces the long-task gate: N4. |
| 7 S7 pointer | FIXED | Real `page.mouse.click` at element centres (422-431), per-window receipt deltas and `reached` flags (324-325, 335); `tasks-view-mode-list` exists (tasks-view.component.ts:173 with mode `list`). |
| 8 focus restoration no-op | FIXED | `.rc-select` focused and verified (441-442). |
| 9 S3 order | PARTIAL | Order `[4,2,3,0,1]` is right, but the precondition is ineffective: N5. |
| 10 skip/overwrite gates | FIXED | `test.skip(!label)` (225), overwrite gate (232), M1 gates (233-234), frame folder cleared only after the gates (235). Side effect: N1. |
| 11 timeout | FIXED | 1_800_000 (227). |
| Moderate items (soft asserts, entrance presence, focusSwaps, finite animations, blank, cheap sampling, tab-id cards, m0 guard) | FIXED | 121-135, 142-143, 362-364, 471-509. |

## New defects

### N1 (Serious). `<label>.json` is written after every window, so an interrupted run leaves a file that looks complete

- Lines 245 and 337 (`persist()` with `partial=false` inside `measure`), 232, 234, 472. A crash, timeout or kill after window 1 leaves `m0.json` containing only the rows so far. The outer `finally` then also writes `m0.partial.json` (514), so the same data exists twice and only the shorter name is "final".
- Consequences: (a) the next run aborts at 232 unless `PTAH_MOTION_OVERWRITE=1`; (b) M1 only checks that `m0.json` exists (234, 472), so an incomplete baseline is accepted and S7 comparisons then fail as "M0 focus record ... undefined" or, for other scenarios, are silently skipped.
- Fix: call `persist(true)` inside `measure` (partial file during the run), write `<label>.json` only at 511 with `complete: true` added to the JSON, delete the partial on success, and make the M1 gate require `baseline.complete === true` and the expected window count (102).

### N2 (Serious). S5 uses programmatic clicks, which no longer arm the window

- Lines 391 and 397 use `evaluate(el.click())`; the click listener (179) ignores untrusted events, and the keyboard listener only handles Enter. So both S5 windows fall through to the fallback (288): `armed: false`, `clickTimes` empty, window and samples start after all clicks (~400 ms of the rapid sequence), and `perClick` is empty. This is exactly the scenario where timing matters. M0 still completes, but the S5 data is wrong.
- Fix: drop the `isTrusted` condition (the harness controls every click on the page), or click through `page.mouse.click` at the element centre as S7 does. Also set `clickTimes` from the listener so `bucketByClick` has data.

### N3 (Serious). S6 `reduced-retained-1` clicks the already focused card, producing a no-op window and a false M1 failure

- S5's last action is `retainedCard(4 % 4)` = card 0 (389-393) and the page-switch windows do not change the focused card. Line 408 then starts at `retainedCard(0)`, so the first reduced window performs no swap: `focusSwapsDelta` is 0 but line 487 expects 1. Soft-fail at M1, and the M0 window is meaningless.
- Fix: iterate `retainedCard((i + 1) % 4)` in 408 (or click card 1 first), and assert the target is not the focused card before the window.

### N4 (Serious). M1 has no long-task gate at all now that attribution is null

- The plan fails M1 on motion-caused long tasks over 50 ms and reports render-caused ones (U2). With the trace-based checks removed, `longTasks.maxMs` is recorded (329) but never asserted or compared, so M1 cannot fail on the principal performance criterion.
- Fix: differential gate against the M0 row with the same `scenario` and `name`: `expect.soft(!(row.longTasks.maxMs > 50 && (old.longTasks.maxMs ?? 0) <= 50), ...)` (new long tasks introduced by the change are attributed to motion), and write a `longTaskReport` list (name, maxMs, M0 maxMs) into the JSON for the orchestrator's render-vs-motion judgement. Keep `attribution: 'unavailable'` visible in the report so zeros are not read as clean.

### N5 (Moderate). S3 retention precondition uses the session id, but the transcript attribute is the tab id

- Line 377: ``ptah-chat-transcript[data-tab-id="${session.id}"]`` where `session.id` is the fixture session UUID. Transcripts carry the tab id (chat-view.component.html:104), and tabs hold the session id separately (`id: tabId, claudeSessionId: sessionId`, tab-manager.service.ts:1232-1233). The count is therefore always 0, `expect(retained).toBe(false)` can never fire, and every S3 row records `targetRetained: false` regardless of reality.
- Fix: resolve the tab id for each session first (e.g. the rail card whose text contains `session.name`, read its `data-tab-id`) and look that up; for sessions with no card yet, retained is false by definition.

### N6 (Moderate). Layout shift is effectively always 0 for click-driven windows

- Line 188 skips entries with `hadRecentInput`. Trusted clicks (Playwright mouse, now the norm after fix 5/7) set it for shifts within 500 ms of the click, which covers the whole transition. The plan phrase "without recent input" is the source, but the result is a vacuous M1 gate (485). Record both `layoutShiftAll` and `layoutShiftNoInput` (still restricted to rail/transcript sources) and assert on the former, or state in the report that the field is informational.

### N7 (Moderate). Split-entrance assertion is coupled to a guess about where the animation lives

- Line 134/502 count animations on `section[data-testid="canvas-tile"]` (exists at canvas-rail-board.component.ts:160). If the B-batch animates the pane host, the focus-area or a pseudo-element instead, M1 fails or passes for the wrong reason. Check against the implemented selector after the code batches land, or count any new finite animation whose target is inside `[data-testid="rail-pane-container"]`.

### Minor

- 513-515: `persist(true)` inside `finally` can throw (disk full, serialisation) and mask the original error; wrap it in try/catch.
- The test-body `try` is not indented (formatting; style reviewer).
- Hard `expect` preconditions at 378, 442 and 460 abort the run; acceptable now that partial output is written, but they should name the scenario so a late failure is diagnosable.

## Verdict

- Recommendation: M0 may proceed as is; the running M0 recording is not invalidated by any new defect except S5 timing (N2) and the S6 first window (N3).
- Before the M1 run: fix N1, N2, N3 and N4, then N5-N7.
- Confidence: MEDIUM (static review only; runtime behaviour of the screencast timestamps, the animation targets and the retention eviction order is unverified).
