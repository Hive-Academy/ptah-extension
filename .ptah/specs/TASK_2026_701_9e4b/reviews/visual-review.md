# Visual review (Electron) - TASK_2026_701_9e4b

Decisions D15, D31, D45. Electron only. Reviewer: visual-reviewer. HEAD 2f725273d.

## How the app was launched and isolated

- Built with `node scripts/verify.mjs --exec --task electron-visual -- npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron --parallel=1` (exit 0, 116 s, lock slot acquired). The renderer is the development build of this worktree (`dist/apps/ptah-electron/renderer`).
- Launched a SEPARATE Electron process through the repo's own `launchPtah()` (`apps/ptah-electron-e2e/src/support/electron-launcher.ts`), driven by `UiDriver`. Isolation: fresh `mkdtemp` `--user-data-dir` (so the single-instance lock is not shared with the user's app), a fresh temp `PTAH_DB_PATH`, `NODE_ENV=test`, `PTAH_E2E=1`. The user's instance, window and profile were never touched. Every instance was closed by the driver; a process check afterwards found no leftover electron with the temp profile.
- Data: all marketplace, plugin, Library and wizard RPC replies are mocked in the main process (`UiDriver.mockRpc`), so nothing wrote to `~/.claude` or `~/.ptah`. A small shim turns a mock reply into an RPC failure for the consent failure state. `library:changed` was pushed with `UiDriver.pushEvent`.
- Driver (not committed, source untouched): `.ptah/specs/TASK_2026_701_9e4b/tmp/driver.cjs`, `tmp/visual/driver.ts`, `tmp/run.sh`. Metrics per shot are in `reviews/visual/<scenario>.json`.
- Themes: `anubis` (dark) and `anubis-light` (light), set through `data-theme`. Widths: wide = 1280 px, narrow = 400 px content width (`setContentSize`; screenshots are 1.5x). I verified `innerWidth` = 1280 / 400.
- Screenshots are in `reviews/visual/` (named `<scenario>__<state>__<theme>__<width>.png`).
- Limit: fixtures are mocked, so this proves rendering, not backend behaviour. Mocks that I did not supply (for example Thoth "Skills paused" reads) show their own error text in the Library screenshots; that is not a finding.

## Results per surface x theme x width

Path prefix for all screenshots: `reviews/visual/`.

| # | Surface | dark wide | dark 400 | light wide | light 400 |
|---|---|---|---|---|---|
| 1a | F7i notice, `conflict` (Marketplace Skills & Plugins) | PASS `installed-conflict__page__dark__wide.png` | ISSUE (1) `...dark__narrow.png` | PASS `...light__wide.png` | ISSUE (1) `...light__narrow.png` |
| 1b | F7i notice, `differs` | PASS `installed-differs__page__dark__wide.png` | PASS (shell clip only, see 2) `...dark__narrow.png` | PASS `...light__wide.png` | PASS (shell clip only) `...light__narrow.png` |
| 1c | F7i notice, `imported` | PASS `installed-imported__page__dark__wide.png` | PASS (shell clip only) `...dark__narrow.png` | PASS `...light__wide.png` | PASS (shell clip only) `...light__narrow.png` |
| 1d | F6 pointer in the Library header (Thoth, Skills tab) | PASS `library-pointer__page__dark__wide.png` | PASS `...dark__narrow.png` | PASS `...light__wide.png` | PASS `...light__narrow.png` |
| 2 | Provenance badges on installed rows (Ptah plugin, skills.sh, workspace, marketplace plugin) | PASS (use `installed-*__page__dark__wide.png`) | ISSUE (3, 4) | PASS | ISSUE (3, 4) |
| 3a | Consent dialog, local-files section | PASS `consent__dialog__dark__wide.png` | ISSUE (5, minor) `consent__dialog__dark__narrow.png` | PASS `consent__dialog__light__wide.png` | ISSUE (5, minor) `consent__dialog__light__narrow.png` |
| 3b | Consent dialog, fixed failure copy ("Install failed. Ptah removes what it wrote...", button "Retry install") | ISSUE (6) `consent-failed__failed__dark__wide.png` | ISSUE (6) `...dark__narrow.png` | ISSUE (6) `...light__wide.png` | ISSUE (6) `...light__narrow.png` |
| 4a | Install report with "Review and replace..." | PASS `repair__report__dark__wide.png` | PASS `...dark__narrow.png` | PASS `...light__wide.png` | PASS `...light__narrow.png` |
| 4b | Kept-items repair prompt ("Replace kept files?") | PASS `repair__prompt__dark__wide.png` | PASS (5 applies) `repair__prompt__dark__narrow.png` | PASS `...light__wide.png` | PASS (5 applies) `...light__narrow.png` |
| 4c | Repair prompt after confirm (C10 notice inside the prompt) | NOT REACHED `repair__prompt-result__*` | NOT REACHED | NOT REACHED | NOT REACHED |
| 5 | Plugin config-home notice | See 1a-1c (same component) | | | |
| 6 | Library stale notice ("The Library may be out of date until its next refresh.") | PASS `installed-conflict__page__dark__wide.png` | PASS text wraps, readable `...dark__narrow.png` | PASS `...light__wide.png` | PASS `...light__narrow.png` |
| 7 | Setup wizard renders and loads after the @defer / `setup-wizard/app` change | PASS `wizard__wizard__dark__wide.png` | PASS `...dark__narrow.png` | PASS `...light__wide.png` | PASS `...light__narrow.png` |

Notes per row:
- 4c: after I clicked the confirm button the prompt closed and only the install report showed (the mocked reply kept all items). I did not reach the in-prompt "library pass failed" notice (`kept-items-repair-prompt.component.ts:386`). I did not investigate whether the click hit the confirm button or whether the prompt's result view needs another fixture shape. This is a fixture gap, not a defect.
- 6: the notice appeared after a pushed `library:changed` with `status: failed` and `scopeRoot` equal to the pushed root. Copy matches C10.
- 7: wizard shows the stepper and the "What do you want to set up?" Welcome step in both themes and widths, with no renderer error caused by the wizard. No UI critique (D34).
- Console errors seen in the renderer came from unmocked unrelated stores (`RecentSessionsStore`, `UsageVitalsCache`, `ModelStateService`, `ConnectorLinksStore._smitheryConnections` iterable). They are mock artifacts of my partial fixtures, not from the changed surfaces. Not counted.

## Issues

### 1. Serious - config-home action button cannot wrap; long folder overflows the notice
- Evidence: `installed-conflict__page__dark__narrow.png`, `installed-conflict__page__light__narrow.png`. Metrics (`installed-conflict.json`): notice 286 px wide, `scrollWidth` 545; the action "Use settings from packages/a-very-long-sub-folder-name/with-nested/segments-that-keep-going" is 537 px wide and its right edge is at 666 px in a 400 px window. The label is cut off.
- Likely source: `libs/frontend/marketplace/src/lib/pages/skills/plugin-config-home-notice.component.ts:181` (`btn btn-xs h-auto min-h-6 py-1 [overflow-wrap:anywhere]`). daisyUI `.btn` does not wrap text, so `overflow-wrap:anywhere` has no effect. Add `whitespace-normal` and `max-w-full`/`text-left` (or truncate with a title).
- Impact: the user cannot read which folder the "use these settings" button adopts at narrow widths, and the control extends outside the notice. The conflict state always lists every candidate, so deep monorepo paths are realistic.

### 2. Moderate - app shell is wider than a 400 px window (pre-existing, not from this task)
- Evidence: all narrow shots; `over` list in each `<scenario>.json` shows `div.flex-1 min-h-0 min-w-[400px]` ending at x=432 with a 400 px viewport; notice and header chip right edges are clipped by about 32 px.
- Likely source: `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:458` (`min-w-[400px]` plus the two 32 px rails).
- Impact: at a true 400 px window every surface loses its right 32 px. I do not attribute this to the task. Listed so the narrow results above are read correctly. Right-edge clipping in 1b, 1c, 2, 6 and 1d comes from this.

### 3. Moderate - provenance badge squeezes the item name to 2-3 characters at 400 px
- Evidence: `installed-conflict__page__dark__narrow.png`, `...light__narrow.png`, `installed-imported__page__light__narrow.png`. Names render as "Pt...", "re...", "my-l...", "dotn..."; the long skill name is unreadable while the badge keeps about 100 px.
- Likely source: `libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts:318-327` (badge `shrink-0 max-w-[40%]` next to a `truncate` name block).
- Impact: the primary identifier of each row is lost at narrow width in exchange for the new origin label. Suggest hiding the badge below a width threshold, or moving it under the name (the card meta row), or letting it shrink.

### 4. Moderate - provenance badge text spills across its own border when it wraps
- Evidence: same shots. "Plugin: Ptah Core / Tools" and "skills.sh: acme/ skills" wrap to two lines while the rounded outline stays one line high; the second line sits on the border.
- Likely source: `installed-skills-page.component.ts:318-327` (`badge badge-sm h-auto`, the daisyUI badge sets a fixed height and a pill radius). Use `whitespace-normal py-0.5` with a smaller radius, or `truncate` with the existing `title`.
- Impact: visual defect on every row with a long origin at narrow width.

### 5. Minor - local-file paths break in the middle of words at 400 px
- Evidence: `consent__dialog__dark__narrow.png`, `repair__prompt__dark__narrow.png`. The path and its reason badge share a row, so the path column is about 130 px and breaks as "dotn / et- / test/...". The Keep/Replace segments wrap to two lines ("Keep my / file").
- Likely source: `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts` row at ~:405-415 (`flex items-start gap-2` with `badge shrink-0`), and the same layout in `kept-items-repair-prompt.component.ts`. Allow the badge to wrap under the path at narrow widths (`flex-wrap`).
- Impact: readable but awkward; nothing is lost.

### 6. Moderate - install failure copy is off screen in the consent dialog
- Evidence: `consent-failed__failed__dark__wide.png`, `consent-failed__failed__light__wide.png` and the 400 px pair. After the confirm call failed, the visible dialog shows only the changed button label "Retry install". The fixed copy (a `role=alert`-style block, 610 px wide, red tint, found in the DOM) is rendered after the local-files list inside the dialog's scroll area, below the fold when there are 4 local items.
- Likely source: `external-consent-dialog.component.ts:458-466` (error block placed at the end of the scrollable body). Move the error above the scroll area or scroll it into view / focus it.
- Impact: with a long local-files list the user sees no explanation of why the install did not happen.

### Not an issue, to record
- First dark-wide capture of `installed-conflict` showed the action buttons unpainted (blank row). I re-took it after a settle frame and the buttons are present (`installed-conflict__page__dark__wide.png`). That was a repaint-after-resize artifact in my capture, not a defect.
- Focus visibility and keyboard order were not exercised in this pass (screenshots only). Not covered; no claim.

## Prototype / design-spec fidelity
- F6 pointer and F7i notices are D15 additions outside the approved prototype; there is no prototype image to compare. Copy matches `implementation-plan.md` F6/F7i text ("This repository has plugin settings that need a choice. Open Skills & Plugins"; conflict/differs/imported sentences). They use the existing warning-tint alert treatment in both themes with sufficient contrast (light text on a dark tint, dark text on a light tint; measured colours in the JSON).

## Summary

| Severity | Count |
|---|---|
| Blocking | 0 |
| Serious | 1 (issue 1) |
| Moderate | 4 (issues 2 pre-existing, 3, 4, 6) |
| Minor | 1 (issue 5) |

Verdict: ISSUES
