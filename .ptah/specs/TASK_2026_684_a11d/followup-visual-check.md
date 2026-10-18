# Follow-up visual check, PR #758 (fix/decision-editor-min-height, HEAD 33d49b98c + uncommitted top-2.5 edit)

Method: dev Electron (`build-dev` + `copy-renderer-dev`, one at a time), own instance on port 9335, private APPDATA and `--user-data-dir`, driven over CDP (`.ptah/tmp/v758-*.mjs`). Viewport emulation, theme anubis (dark). Fake key `test-key-not-real` typed only, never saved. Screenshots: `.ptah/specs/TASK_2026_684_a11d/visual-758/`. Rects are CSS px (top-bottom).

## Verdict per case

| Case | Verdict |
|---|---|
| a. Normal 1531x983 and 900x983, both popovers | PASS |
| b. Decision editor, short 350 / 200 (900 wide), mid and bottom trigger: contained when opened in its final state | PASS |
| b2. Decision editor: reflow after content grows (Unset -> Custom) with the trigger near the bottom | FAIL (intermittent) |
| c. Main Agent popover at 350 / 200: containment | PASS |
| c2. Main Agent Save clickability (elementFromPoint) | NOT VERIFIED (Save disabled with an unchanged draft) |
| d. Long Base URL error clamp (2 lines, 32 px slot, full title) | PASS |
| e. Close (X) button vs "Decision model" select after top-2.5 | FAIL (2 px overlap remains) |

## a. Normal viewports (editor kind Custom, model and URL filled)

| Viewport | Trigger | Dialog | Dialog scrolls | Body | Save |
|---|---|---|---|---|---|
| 1531x983 mid | 492-524 | 541-968 (h427) | no (427/427) | scrolls 352/251 | 872-904 |
| 900x983 mid | 492-524 | 541-968 (h427) | no | scrolls 352/251 | 872-904 |
| 1531x983 bottom | 929-961 | 400-912 after settle (h512) | no | no (336/336) | 816-848 |
| 900x983 bottom | 933-965 | 404-916 after settle | no | no | 820-852 |
| Main Agent 1531 / 900 x983 | 344-364 / 380-400 | 406-814 / 442-850 (h408) | no | no (314/314) | 772-804 / 808-840 |

No outer dialog scrollbar; body scrolls only in the mid case. No horizontal overflow.

## b. Decision editor, short viewports (width 900)

Save reached by scrolling the dialog and the body, then Save rect checked and `elementFromPoint` at its center (Save enabled: model and https URL filled).

| Viewport / trigger | Dialog (settled) | Dialog scrolls | Save after scroll | In viewport | Clickable |
|---|---|---|---|---|---|
| 350 mid (trigger 175-207) | 17-160 (h143) | yes 240/143 | 64-96 | yes | yes |
| 350 bottom (trigger 300-332) | 17-285 (h268) | no (body scrolls 352/92) | 189-221 | yes | yes |
| 200 mid (trigger 100-132) | 17-137 (h120, the 120 floor) | yes 240/120 | 41-73 | yes | yes |
| 200 bottom (trigger 150-182) | 17-137 (h120) | yes 240/120 | 41-73 | yes | yes |

All panels satisfy top >= 0 and bottom <= innerHeight (17 / 137 / 160 / 285 against 350 or 200).

## b2. FAIL: no re-shift after the content grows (intermittent)

Opening the editor with the trigger near the bottom while the kind is Unset gives a small panel (732-916 at 900x983). Switching the kind to Custom grows it to h512. In 3 of 6 loop runs (and 3 of 3 runs in the timing script that stayed idle) the panel stayed at 732-1244, bottom 261 px past the 983 viewport, for 5 s with no further correction. In the other runs it re-shifted to 404-916. It corrects only after a scroll event (my `reach` step scrolling the body fixed it).
Other measurements of the same defect: 900x350 bottom trigger, 99-367 (viewport 350) until a scroll; 1531x983 bottom, 728-1240.
Cause hypothesis: the position is computed once and the Floating UI auto-update does not always fire when the panel's content resizes. Impact: after switching kind near the bottom of a short window, Save is initially below the viewport (reachable only by scrolling the page behind the backdrop or after the dialog is re-shifted). A reopen with a saved Custom kind opens at full size and is positioned correctly. Screenshots: `timing-900x983-1-unset.png`, `timing-900x983-2-custom-settled.png`, `dec-1531x983-bottom-a-open.png` (panel off-screen), `dec-1531x983-bottom-b-scrolled.png`.

## c. Main Agent popover, short viewports (900 wide)

| Viewport / trigger | Popover | Scrolls | Save | In viewport |
|---|---|---|---|---|
| 350 mid (trigger 175-195) | 18-203 (h185) | body 314/91 | 161-193 | yes |
| 350 bottom (trigger 300-320) | 18-328 (h310) | body 314/216 | 286-318 | yes |
| 200 mid (trigger 100-120) | 17-137 (h120) | dialog 158/120 and body | 95-127 after scroll | yes |
| 200 bottom (trigger 150-170) | 18-178 (h160) | body 314/66 | 136-168 | yes |

Contained in every case, footers inside the panel. Save stayed `disabled` in this profile with an unchanged draft (changing the effort select did not enable it), and a disabled Save returns the dialog from `elementFromPoint`. So clickability was not verified; only the geometry was. Screenshots: `main-*-a-open.png`, `main-*-b-scrolled.png`, `main-enabled-900x*`.

## d. Long Base URL error

Typed an invalid `ftp://xxxx...(150 x).example.com`, and a valid http URL plus the fake key (needs-https). Error slot stays 32 px, error text 32 px (2 lines), `title` equals the full text in every capture, no overlap (error bottom = slot bottom, footer below).

| Width | Invalid: error / slot / clamped | Needs-https | Error bottom vs footer top |
|---|---|---|---|
| 900, 420, 340 | 32 / 32 / no clamp needed (2 lines fit) | 32 / 32 | 772 vs 912, 767 vs 912, 767 vs 894 |
| 260 | 32 / 32 / clamped (scrollH > clientH) | 32 / 32 clamped | 799 vs 880 |
| 200 | 32 / 32 / clamped | 32 / 32 clamped | 831 vs 848 |

Title lengths 86 (invalid) and 74 (needs-https), identical to the text. At 260 and 200 wide the document itself overflows horizontally (app chrome, dialog right edge 245 and 185 inside the viewport); not attributable to this change. Screenshots: `url-*-invalid.png`, `url-*-needs-https.png`, `urlN-260-*`, `urlN-200-*`.

## e. Close button (top-2.5 edit, rebuilt and relaunched)

| Viewport | Button | Select | Gap (select top - button bottom) |
|---|---|---|---|
| 1531x983 | 553.8-578.2 (x 498.8-523.2) | 576-608 (x 111-527) | -2.2 px, overlaps |
| 900x983 | 554-578 (x 491-515) | 576-608 (x 103-519) | -2 px, overlaps |

Previously top-3 gave 4 px of overlap; top-2.5 halves it to 2 px. The button is 24 px tall (min-h-6) inside a dialog whose select starts 32 px from the dialog top, so the button still intrudes 2 px into the select. Fix: `top-2` (button bottom 576, gap 0) or `top-1.5` for a clear gap, or reduce its height. Zoomed screenshots: `close-button-1531-zoom.png`, `close-button-900-zoom.png`.

## Cleanup confirmation

Both Electron trees (PIDs 22480 and 36108, plus children) killed; nothing listens on 9335; temp profile and temp APPDATA (`%TEMP%\ptah-v758`) deleted; `~/.ptah/settings.json` byte-identical to the backup (`cmp`, sha256 8fc07a873467b936...); `skillSynthesis.enabled` untouched; no source edited, nothing committed or staged by me (only the coordinator's `decision-model-row.component.ts` edit is modified in the worktree).

---

# Re-check 2 (close button top-1.5, FloatingUIService stale-compute guard + retry, `reposition()` after kind change)

Rebuilt (`build-dev`, then `copy-renderer-dev`, one at a time), relaunched on 9335 with a private APPDATA and temp user-data-dir. Dark theme. Logs: `.ptah/tmp/v758-recheck.log`, `v758-recheck.json`.

| Case | Verdict |
|---|---|
| FAIL 1 (b2): re-shift after Unset -> Custom, trigger near the bottom | PASS |
| FAIL 2 (e): close button vs select top | PASS |
| Sanity: normal popovers and another native popover | PASS |

## b2: Unset -> Custom, trigger near bottom, 1 s settle, no scroll (7 runs per viewport, 21 total)

| Viewport | Trigger | Unset panel | Custom panel after 1 s | Runs inside viewport | Save (after model + https URL filled) |
|---|---|---|---|---|---|
| 900x983 | 949 | 732-916 | 404-916 (h512) | 7/7 | 820-852, in view, clickable, no dialog or body scroll |
| 900x350 | 316 | 99-283 | 17-285 (h268) | 7/7 | 189-221, in view, clickable, dialog does not scroll, body scrolls (the cap, as designed) |
| 1531x983 | 945 | 728-912 | 400-912 (h512) | 7/7 | 816-848, in view, clickable, no scroll |

All 21 runs were identical: top >= 0 and bottom <= innerHeight (916 <= 983, 285 <= 350, 912 <= 983), no scroll event needed. The earlier failure (panel stuck at 732-1244 / 99-367) no longer occurred in any run. Screenshots: `rc2-dec-900x983-custom-settled.png`, `rc2-dec-900x350-custom-settled.png`, `rc2-dec-1531x983-custom-settled.png`.

## e: Close button vs the "Decision model" select

| Viewport | Button | Select | Gap | Button top vs dialog top |
|---|---|---|---|---|
| 1531x983 | 550-574 (x 499-523) | 576-608 | 2 px, no overlap | 6 px |
| 900x983 | 550-574 (x 491-515) | 576-608 | 2 px, no overlap | 6 px |

Button bottom (574) is above the select top (576) with the 2 px gap expected. Zoomed screenshots: `rc2-close-button-1531-zoom.png`, `rc2-close-button-900-zoom.png`.

## Sanity (1531x983)

- Decision editor (Unset kind) opens below its trigger (trigger 495-527, panel 544-728), no dialog scroll, same as the first run.
- Main Agent popover: 406-814 with Save 772-804, no scroll, identical to the first run (trigger 354).
- Other native popover (CLI matrix "Model for Codex" cell, trigger y 294): opens at 310-465 (x 651-941), inside the 983 viewport and anchored below the trigger. Screenshots: `rc2-normal-decision-1531.png`, `rc2-normal-main-1531.png`, `rc2-other-popover-cli-model.png`.
- Not re-run in this pass: the 350/200 short cases of c and d (no change in those code paths was claimed beyond the decision editor); c2 (Main Agent Save clickability with a draft change) is still not verified.

## Cleanup (Re-check 2)

Electron tree PID 14480 and children killed; nothing listens on 9335; `%TEMP%\ptah-v758` (profile and APPDATA) deleted; `~/.ptah/settings.json` byte-identical to the new backup (`cmp`, sha256 8fc07a873467b936...). No source edited, nothing committed, no stash used.
