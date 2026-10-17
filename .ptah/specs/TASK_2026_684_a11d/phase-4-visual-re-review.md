# Phase 4 visual re-review (round 1 fixes) - decision model row editor (TASK_2026_684_a11d)

## Setup

- Worktree HEAD 924e6f346. The existing `dist` was older than the fixes (main.mjs 18:48, fixes 19:19-19:28), so I rebuilt: `NX_NO_CLOUD=true nx run ptah-electron:build-dev` then `copy-renderer-dev` (parallel=1, one at a time). main.mjs 19:37, renderer 19:39.
- Launched my own Electron instance (`electron.exe dist/apps/ptah-electron/main.mjs --remote-debugging-port=9335 --user-data-dir=%TEMP%\ptah-rr-profile`, PID 20796) and drove it with Playwright `connectOverCDP` (`.ptah/tmp/rr-main.mjs`, `rr-tab.mjs`). Port 9333 and the "Ptah Dev" profile were not touched.
- Note: session and settings data still come from `~/.ptah` (the `--user-data-dir` only moves Chromium data), so this is not an empty app state. The decision row was Unset and no decision key is stored, which is what "fresh" means below.
- Themes via `documentElement.dataset.theme` = `anubis` / `anubis-light`. Widths 1531 and 900 by viewport emulation, height 983. Audit selection, not a support contract. 900 wide still has the pre-existing clipped top nav.
- Fake key `test-key-not-real` only typed into the password field and cleared; nothing saved with it. `~/.ptah/settings.json` backed up first, still byte-identical afterwards (sha256 9767757d...fa47, `cmp` SAME), `skillSynthesis.enabled` unchanged. Switching back to Unset (auto-save) did not change the file.
- Screenshots: `.ptah/specs/TASK_2026_684_a11d/visual/rr-*.png`, log `visual/_rr-log.txt`.

## Per prior finding

| # | Prior finding | Status | Evidence |
|---|---|---|---|
| 1 | Custom editor taller than room, top off-screen | FIXED | Editor max-height now follows the room. Mid-viewport (row y 495): opens below, 544-968, `max-height` 424 px, heading, close and kind picker fixed, body scrolls (rr-03-custom-mid-dark-1531, rr-04-needs-https-mid-dark-1531). Row near bottom (row y 932): opens above, 441-915 (401 with error), top on-screen (rr-04-needs-https-bottom-dark-1531). Row near top (row y 40): opens below, 89-563 (603 with error), no scroll needed (rr-03-custom-top-dark-900). Same at 900 wide, both themes. No horizontal overflow. |
| 2 | URL field jumps when an error appears | PARTIAL | Mid and top: Base URL y delta 0 and editor top delta 0 at both widths, both themes. Bottom (editor opens above the row): still grows upward, Base URL moves -40 px (y 542 -> 502 at 1531; 582 -> 542 at 900) for needs-https and invalid URL. This is the known limit. Shots: rr-03 vs rr-04-needs-https-bottom-*. See new finding 7. |
| 3 | Inline error prefixed "Could not save..." | FIXED | Error text now "An API key needs an https base URL unless the endpoint is on this machine." and "Base URL must be an absolute http or https URL without credentials, query or fragment." with no lead sentence (rr-04-needs-https-*, rr-05-invalid-url-*). |
| 4 | "Remove stored key" shown with no stored key | FIXED | `decision-api-key-remove` count 0 for Jev, Ollama Cloud and Custom, with and without a typed unsaved key, both themes and widths (rr-06-kind-jev-*, rr-06-kind-custom-*). Positive case (host reports a stored key) not reachable without a real key. |
| 5 | Tab leaves the popover | FIXED | With Custom filled: Tab from kind goes base-url, model, api-key, save, close, kind, base-url...; Shift+Tab from kind goes close, save, api-key, model, base-url, kind, close... Tab from the dialog goes to close, Shift+Tab from the dialog goes to save. Same in dark 1531, light 1531, dark 900. |
| 6 | No model placeholders | FIXED | Ollama Cloud: `e.g. clef:27b-cloud` (rr-06-kind-ollama-cloud-light-900). Custom: URL `https://decide.example.com`, model `model id` (rr-03-custom-top-dark-900). Jev keeps `jev-1.13.0`. Placeholders are legible against the field in both themes. |

## Other checks requested

- Settings tab bar spacing (`mb-3`): tabs end at y 131, next card starts y 144 at 1531 (13 px gap), looks right in both themes (rr-01-tabbar-top-light-1531, rr-01-tabbar-top-dark-1531, `-900` variants). No crowding, no extra slack.
- Row closed: rr-02-row-closed-{dark,light}-{1531,900}. No regression.
- Focus on open: `document.activeElement` is the dialog (`consumer-editor-decision`) in all runs. It shows a visible ring (amber 2px-looking ring in light, rr-09-focus-open-dialog-light-1531; computed outline `auto 1px` plus the surface ring). Escape from the dialog, the kind select and an input closes the editor and returns focus to `consumer-edit-decision` (rr-10-after-escape-*, rr-08-after-escape-*).
- Needs-https and invalid URL: error visible, `Save` disabled behavior unchanged, error text is a fixed sentence, key never in DOM text.

## New findings

7. MODERATE - Bottom placement still shifts. When the row is near the bottom and the editor opens above it, an error growing the editor by 40 px moves the editor top and the Base URL input up 40 px while the user types (1531 and 900, dark and light). The top stays on-screen (401 / 410 px), so it is no longer a clipping defect. Fix: reserve the error row height (min-height on the help/error slot) or anchor the editor top when placed above. Likely `libs/frontend/chat/src/lib/settings/providers/decision-model-row.base-url-field.component.ts` (conditional error block) and the max-height calc in `decision-model-row.component.ts` (`editorMaxHeight`).
8. MODERATE - Save scrolls out of view when an error shows in the capped editor. Mid placement at 1531/900: with the needs-https or invalid error the Save button sits at y 972-1004 while the editor ends at 968 (viewport 983), so the primary action is below the fold of the scrolling body and the user must scroll inside the editor to reach it (rr-04-needs-https-mid-dark-1531; scrollbar visible). Without an error Save is at 932-964, fully visible. Fix: make Save and the footer text a non-scrolling sticky footer, or tighten the field spacing. Likely the scroll container wrapping the body in `decision-model-row.component.ts` (editor container ~line 173).
9. MINOR - Playwright-only observation, not a defect: if focus is lost to `body` (the focused field is removed on a kind switch) Escape does not close the editor because the keydown listener is on the popover host. A real user keeps focus on the kind select, so I did not count this.

No visual-breaking and no serious findings. Contrast, target sizes and focus rings measured earlier are unchanged (same styles).

## Screenshot table (prefix `rr-`, each for dark/light x 1531/900 unless noted)

| Stem | Shows |
|---|---|
| 01-tabbar-top | Settings tab bar spacing |
| 02-row-closed | Row closed |
| 03-custom-{mid,bottom,top} | Custom editor empty at each row position |
| 04-needs-https-{mid,bottom,top} | needs-https error at each position |
| 05-invalid-url-{mid,bottom,top} | invalid URL error at each position |
| 06-kind-{jev,ollama-cloud,custom} | Each kind, fresh state, no Remove stored key, placeholders |
| 07-focus-on-open | Dialog focused on open |
| 08-after-escape | Focus back on the trigger |
| 09-focus-open-dialog, 10-after-escape | Tab-test runs (dark 1531, light 1531, dark 900) |

Geometry numbers for every capture are in `visual/_rr-log.txt`.

## Cleanup

My Electron process tree (PID 20796 and 8 children) was killed, nothing is listening on 9335, the temp profile `%TEMP%\ptah-rr-profile` is deleted, `~/.ptah/settings.json` is byte-identical to its backup. Only `.ptah/specs/TASK_2026_684_a11d/visual/` is untracked (screenshots); scripts live in the git-ignored `.ptah/tmp`.

Verdict: APPROVED
