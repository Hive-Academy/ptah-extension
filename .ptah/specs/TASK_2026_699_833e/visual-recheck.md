# Visual Re-check - TASK_2026_699_833e (fixed items only)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED (reply verdict APPROVED) |
| Visual breaking | 0 new (V-F1 stays open as decision 20, shown pre-existing) |
| Serious | 0 |
| Moderate | 1 new, transient (R-1) |
| Viewports opened | 1440, 1200, 1100, 900, 800 (dark and light where a screenshot was taken) |
| Screenshots | 16 files in `screenshots/recheck/` |

## Environment

- Not rebuilt, per brief. Dist is the one built for HEAD c0a523197.
- Launched with the private launcher `.electron-userdata/launch.js` (port 9391, private user-data dir). Canvas layout, no override.
- Viewports are CDP `Emulation.setDeviceMetricsOverride` widths. The window `minWidth` is 800, so nothing below 800 was opened.
- Cleanup: the launcher tree was killed with `taskkill /T`. `Get-Process electron` returns 0 and 9391 is closed. `launch.js` was not staged or deleted. No source was edited and nothing was committed.
- Scratch probe scripts `rc*.js` and `shot.js` sit in the same git-ignored-by-intent `.electron-userdata/` folder (untracked, not staged).

## 1. V-F2 (dock body placeholder): FIXED

- Method: in-page `setInterval(4 ms)` from the click event to the first `ptah-session-inspector` inside `aside[data-inspector-dock]`. Dock closed, then opened, 10 cycles, 1440 wide, 9-session busy profile.
- Result: inspector in the DOM at 68, 74, 80, 75, 55, 72, 85, 92, 80, 66 ms (range 55-92 ms). Before the fix the same measure was 4.5 to 6.5 s.
- Close then reopen: each of the 10 cycles was a close/reopen. All reopens were in the 55-92 ms range.
- Earlier MutationObserver run (3 open/close cycles per theme, dark and light) gave `waitInsp` 18-58 ms, with two outliers of about 1.1 s (the first open after a theme switch, and one dark reopen). Both settled by themselves, and neither left an empty panel for seconds. The cause is not isolated (probably a lazy chunk or a theme re-render). It is far under the old 4.5-6.5 s and I did not file it separately.
- Busy-page proof that the old trigger would have lagged: in a separate run `requestIdleCallback` took 1.0 to 2.0 s to fire while the page was busy, and in the 10-cycle run it fired with the content (about 70 ms) because the page was idle. The `when dockOpen()` trigger is independent of idle either way.
- Skeleton: not caught. The 4 ms poll never saw `.skeleton` in the dock, and a screenshot 40 ms after the click already showed the loaded inspector. At a 20x CPU throttle the content still arrived in one step (about 6.7 s of throttled main-thread time, shell and inspector together, no intermediate frame captured). I cannot claim a visible skeleton. The user-visible result is the real test: there is no multi-second empty "Session details" panel.
- Screenshots: `dark-1440-open-early.png` (40 ms after click, already loaded), `dark-1440-open-loaded.png`, `light-1440-open-early.png`, `light-1440-open-loaded.png`, `dark-1440-throttle20-open-early.png`.
- Dark and light content read correctly (cards, plan-limit block, close button), same as the earlier review.

## 2. L1 handoff (dock <-> compact sheet at 400 px): not reachable in Electron

- The board cannot go below 400 px here. At the 800 px window minimum with the rail collapsed (56 px) the board is 736 px. Even with the dock open the tile is 348 px.
- Recorded as: not reachable in Electron (covered by board spec: the two tests at `canvas-rail-board.component.spec.ts:858-911` plus the md-to-compact test at :913). Not forced.

## 3. Decision 20 proof for V-F1 (composer toolbar overlap): the overlap is pre-existing and not dock-related

- Code path: `git diff main --stat -- libs/frontend/chat/src/lib/components/molecules/chat-input/` is empty (0 lines). The composer toolbar code is byte-identical to main, so the overlap is a property of the unchanged composer at a narrow width.
- Split-pane at a 360 px pane (probe, see the honesty note below), dark and light, rail collapsed or expanded as noted:
  - Measured buttons: "+" 357-385, approval 389-419, model 364-554, effort 561-609, dictate 613-641, send 645-673.
  - Overlaps: attach (+) with model, and approval with model. Same pairs as in the dock-open tile.
  - Screenshots: `dark-split-pane-360-full.png`, `light-split-pane-360-full.png` (visible: "+", shield and "Default (recommended)" drawn over each other in pane 1).
  - At the natural split-pane widths (1072 px stacked) there is no overlap: `dark-1440-split-open.png`.
- Dock-open single-focus tile, 800 wide, rail collapsed, dock open (default sm width 300 px): tile 348 px. Overlap present on the same pairs (model label struck through by the shield and "+").
  - Screenshots: `dark-800-dock-open-single-360.png`, `light-800-dock-open-single-360.png`.
- Conclusion: the same overlap exists in a split pane without any dock when the composer is 360 px wide. It supports decision 20 (pre-existing, owner is the composer). The dock only makes the narrow case reachable at 800-900 px.
- Honesty note: the split pane does not reach 360 px by itself in this app. Side-by-side split only starts at a board of 1440 px or more (`splitStacked = containerWidth < 1440`, `canvas-rail-board.component.ts:330`), and each pane is then about 700 px, while stacked panes are full width. So the 360 px split floor (`min-w-[360px]`, :176) is a CSS floor that is not reachable at the real window sizes. I pinned pane 1 to 360 px with an inline-style probe (`align-self:flex-start; width:360px`, removed afterwards) to prove the composer behaviour. This is a probe of the same unchanged code, not a naturally reachable split state, so "pre-existing" means "the unchanged composer overlaps at 360 px", not "users could already reach it in a split pane".
- Net: decision 20 stands. V-F1 remains an open follow-up for the composer owner (it is still reachable at 800-900 px with the dock open) and is not a regression of the diff.

## 4. Regression look (one shot each)

| Check | Result |
| --- | --- |
| Bands | 1440: dock 400, tile 888. 1200 and 1100: dock 336. 900 and 800: closed by default (tile 748 and 648). Opening at 800: dock 300, tile 348. Direct 1440 to 800 with the dock open: closes cleanly (rc13), also stepped 1200/1100/900/800. OK. |
| Resize clamp (1200 md, rail collapsed) | Drag far left: dock 560, tile 488. Drag far right: dock 300 (min), tile 748. No horizontal scroll (`docW` equals vw). OK. |
| Esc during drag | Mid-drag value restored on Esc and the release did not re-apply it (dock back to 560, the pre-drag width). OK. |
| Double-click reset | Back to the band default 336. OK. |
| Themes | Dark and light dock lg: `dark-1440-dock-lg.png`, `light-1440-dock-lg.png`. OK. |

### R-1 (Moderate, transient): stale dock for about 1.6 s after a resize that follows a split close

- Reproduced twice. Sequence: expand rail at 1440, Open beside, Close pane 2 (back to single focus, dock open at 336), collapse the rail (dock 400), then resize to 800.
- For about 1.6 s the dock stays open at 400 px with a 248 px tile (below the 360 floor), then it snaps closed (tile 648). Timeline: 248/400 at +0 to +1463 ms, 648/closed at +1728 ms.
- A clean sequence (no split opened earlier in the session) closes immediately: `rc13` direct 1440 to 800, 1.5 s read.
- Likely a delayed container-width measurement after the split-to-single swap. Not traced to a line. In real window dragging the intermediate frames are continuous, so the user impact is a brief wrong layout, not a stuck state. It resolves by itself, so I rate it Moderate and not a blocker for this task.
- Screenshot: `dark-800-transient-stale-dock.png`.
- Suggested follow-up: record it with decision 22's measurement item (the 0 px / delayed-measurement area of `canvas-rail-board.component.ts:386-395`), as it is likely the same family.

## Decisions

- Probe for the 360 px split pane: considered waiting for a natural split floor (not reachable, see section 3), so pinned the pane by inline style. Reversible, no source touched.
- R-1 rated Moderate (self-resolving in 1.6 s, not reachable by a clean sequence). The template rule would file an overlap or a below-floor tile in the higher class if it persisted. It does not persist.

## Verdict

- Recommendation: APPROVE the fixes (V-F2 fixed, L1 not reachable here and covered by the board spec, decision 20 shown consistent with the unchanged composer code).
- Confidence: MEDIUM-HIGH. The V-F2 measure is clean. The skeleton was not seen, only that the empty wait is gone. L1 cannot be tested in this host.
- Key concern: V-F1 (composer toolbar overlap at 360 px) is still reachable at 800-900 px with the dock open. It is pre-existing composer behaviour and tracked as a follow-up by decision 20. R-1 is a new transient glitch to log.
