# Phase 4 visual check, round 2 (HEAD eda548d2c) - decision model row editor (TASK_2026_684_a11d)

## Setup

- Rebuilt after the commit (one command at a time, `NX_NO_CLOUD=true`, parallel=1): `ptah-electron:build-dev` (main.mjs 19:56), then `ptah-electron:copy-renderer-dev` (19:58).
- Launched my own Electron (PID 6012) with `--remote-debugging-port=9335` and a temp `--user-data-dir`; driven over CDP by `.ptah/tmp/r2-*.mjs`. Port 9333 and other Electron processes were not touched.
- Themes: `anubis` (dark), `anubis-light`. Widths 1531 and 900 (viewport emulation, height 983). Audit selection, not a support contract.
- Row mid-viewport (row y 495) opens below; row near bottom (row y 929-974) opens above. Fake key `test-key-not-real` typed only, never saved. Choosing Unset auto-saves nothing that differs (settings file unchanged).
- Log: `visual/_r2-log.txt`. The first (`r2-main`) pass captured with the body scrolled by a later field focus, so Base URL looked shifted; `r2-meas` re-captured with the body at scrollTop 0 and the URL field focused (the real typing case). `r2-03/04/05` PNGs are from `r2-meas`.

## Finding 7 (bottom placement shifts when an error appears): FIXED

Base URL y, no error vs needs-https vs invalid (editor opens above the row):

| Theme / width | No error | needs-https | invalid | Editor top / bottom | Editor height change |
|---|---|---|---|---|---|
| dark 1531 | 500 | 500 | 500 | 400 / 912 | 0 |
| light 1531 | 502 | 502 | 502 | 401 / 915 | 0 |
| dark 900 | 510 | 510 | 510 | 410 / 922 | 0 |
| light 900 | 512 | 512 | 512 | 411 / 925 | 0 |

Delta 0 for Base URL y and editor top in every case (round 1 was -40). Mid placement (opens below): Base URL y 644/645 unchanged, editor 544-968 in all states, delta 0. Top placement from the first pass also 0 (Base URL 189/190).

## Finding 8 (Save scrolls out of view in the capped editor): FIXED

- Mid placement, editor capped at 544-968 (424 px): Save is now 872-904 (871-903 light) with the footer text below it, inside the editor in every state (no error, needs-https, invalid), both themes, both widths. Round 1 had Save at 972-1004, below the editor bottom.
- The body still scrolls in the mid case (`scrollable: true`), but Save and the footer are outside it, so no inner scrolling is needed to reach Save. `saveVisible: true` in all 24 measured states. In the bottom case the body does not scroll at all.
- No horizontal overflow in any capture.

## Focus checks (dark 1531, light 1531, dark 900)

- Focus on open: `consumer-editor-decision` (the dialog).
- Tab from Save goes to Close (`consumer-close-decision`); Shift+Tab from Close goes to Save (`decision-save`); Tab from Save goes to Close again. Wrap works in both directions.
- Escape (from the Model input) closes the editor and focus returns to the trigger `consumer-edit-decision`.

## New findings

None. Nothing new at moderate severity or above. The pre-existing clipped top nav at 900 wide (seen in r2-04-needs-https-bottom-dark-900) is unchanged and out of scope.

## Screenshots (all in `.ptah/specs/TASK_2026_684_a11d/visual/`, prefix `r2-`)

- `r2-03-custom-{mid,bottom}-{dark,light}-{1531,900}.png` (no error), `r2-04-needs-https-...`, `r2-05-invalid-url-...` (same grid).
- `r2-09-focus-open-{dark-1531,light-1531,dark-900}.png`, `r2-10-after-escape-...`.
- Key: `r2-04-needs-https-mid-light-1531.png` (Save and footer visible while capped, error shown), `r2-04-needs-https-bottom-dark-900.png` (opens above, error slot reserved).
- Extra captures from the first pass (`r2-01`, `r2-02`, `r2-06`, `r2-07`, `r2-08`) exist but are not needed for these findings.

## Cleanup

Electron tree (PID 6012 and children) killed, no listener on 9335 (only TIME_WAIT), no electron process left, temp profile `%TEMP%\ptah-rr-profile` deleted, `~/.ptah/settings.json` byte-identical to backup (sha256 9767757d...fa47, `fc /b` no differences), `skillSynthesis.enabled` untouched. No source or git state changed; only `.ptah/specs/TASK_2026_684_a11d/visual/` and this report are new.

Verdict: APPROVED
