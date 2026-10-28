# Visual Re-check P5 - TASK_2026_719_4f64

Verdict: APPROVED. Breaking 0, Serious 0, Moderate 1 (gap under tab strip), Minor 0.

Environment: rebuilt Electron app in the worktree (not rebuilt by me), faked RPC harness `screenshots/p5r-capture.mjs` and `p5r-c2.mjs` (PTAH_E2E=1, temp user-data-dir and DB, no sign-in, no Claude process). Themes: `ptah-glass` (dark) and `ptah-glass-light`. Widths: 245, 245 at 200% zoom (245 CSS px), 520, 320. Raw data: `screenshots/p5r-results.json`, `p5r-results2.json`. Screenshots: `screenshots/p5r-*.png` (zoom screenshots are cropped by Electron; measurements come from the DOM).

## Results

| # | Check | Result |
|---|-------|--------|
| 1 | Rows at 245 and zoom 200% (dark and light) | PASS. Name column 148 px (zoom: 153 px), long label wraps to 3 lines, short names 1 line. Actions sit below the text block in every row. 0 chip/status overlaps. `title` equals the full label for all rows. Row scrollWidth equals clientWidth (200/200, 205/205). At 320 and 520 no overlap and no horizontal overflow. Shot: `p5r-list-light-w245.png`. |
| 2 | Detail at 245 and zoom 200% | PASS. `native-drawer-body` scrollWidth 244 / clientWidth 244 (zoom 239 / 239). Inner tabs wrap: Overview and Access on one line, Profile on the next, none clipped (also at 320 and 520). Shot: `p5r-detail-dark-w245.png`. |
| 3 | Detail at 520 and 320 | PASS. `ptah-account-use-for` and the Accounts heading are absent while the detail is open; "All accounts" is the first content under the drawer tab strip. After Back both return, and focus is on the exact `Manage <label>` trigger (same aria-label as before opening) at all 8 width and theme combinations. Shot: `p5r-detail-dark-w520.png`. |
| 4 | Focus box on ambient-status | PASS. Programmatic focus on `[data-testid=ambient-status]` shows no visible ring (outline transparent, box-shadow fully transparent). Shot: `p5r-ambient-status-focused-dark.png`. After "Check again", Tab once lands on the Work row (`accounts-tab-row-body`) with a 2 px outline plus 5 px halo, ring contrast 15.7 (dark) and 15.4 (light). Shot: `p5r-tab1-*.png`. |
| 5 | Regression at 520 | PASS. List renders in both themes. Remove modal: Escape closes the modal (open false) and the drawer and detail stay (`p5r-after-esc-*.png`). Card badge "2 connected" 69 px wide, inside the card (`p5r-badge-*.png`). |

## Moderate (new, low impact)

- Gap under the tab strip in the detail view is about 49 px at 520 (strip bottom about 110, "All accounts" top 159): drawer body padding plus a `mt-4` (16 px) wrapper above `ptah-account-detail-view` plus the accounts-tab wrapper. It is "directly under" the strip in structure (nothing between them) but reads as an empty band. Optional: drop the wrapper margin while the detail is open. Screenshot: `p5r-detail-dark-w520.png`.

## Notes

- Not re-examined: 10 px chip text (deliberately unchanged per fix report). My first-pass "strip bottom" metric matched inner tabs and was discarded; the gap figure above comes from the second run.
- First run's regression block failed on a harness bug (`focusInfo` undefined); re-run in `p5r-c2.mjs` passed.
- Electron processes started by the harness were closed by the harness.
