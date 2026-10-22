# Visual Review - TASK_2026_662 Phase B re-check (round 2)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | REVISE (all four requested items pass; one new Serious finding on stat-tile clipping at 1280) |
| Visual breaking | 0 |
| Serious | 1 (pre-existing, but it contradicts the "nothing clips" expectation of batch 24a) |
| Moderate | 2 |
| Viewports tested | 2 (1280x800, 1904x967 - a 1920x1080 request clamped by the display) |
| Screenshots taken | 16 Thoth "after" + 88 in phase-b-r2 (library/drawers/providers/telemetry, dark + light) |
| Components tested | Library (3 kind tabs, cards, drawer), Enhancement row, telemetry switch, 4 Thoth panels |

## Environment

- Build: from the working tree (HEAD 829600e7f + uncommitted fix-round changes), `npx nx run ptah-electron:build-dev` and
  `copy-renderer-dev` (`--parallel=1`), both exit 0. `dist/apps/ptah-electron/main.mjs` was written 03:28 local, just
  before the run (03:31).
- Launch: Playwright `_electron.launch`, `--remote-debugging-port=9390` only, private HOME/USERPROFILE/APPDATA/
  LOCALAPPDATA/`--user-data-dir`/`PTAH_DB_PATH` under a new `os.tmpdir()` folder, removed on exit. Real profile and
  `~/.ptah/settings.json` untouched. Reused `visual/phase-b/capture-phase-b.cjs` (with `REAL_LIBRARY=1`, so the Library
  runs with NO injected RPC replies) and `visual/thoth-width/capture-thoth-width.cjs`.
- Viewports: 1280x800 and 1904x967 (audit selection, not a support contract). Themes: dark `anubis`, light `anubis-light`.
- Artifacts: `visual/phase-b-r2/` (screenshots `pb-*`, `pb-rt-*`, `run.txt`, `rt-run.txt`, `main-log.txt`,
  `udd-Ptah_Electron-2026-10-19.log`, `capture-rt.cjs`), `visual/thoth-width/after/`.
- Cleanup: Electron closed via `app.close()` after each run; `netstat` shows nothing on 9390, no electron process.

## Item results

### 1. Library in the real app path - PASS (fix for visual Serious 1 confirmed)

- No "skillSynthesis:listClones failed" alert in either theme. Tab strip shows real counts: Skills 4 / Agents 4 / Commands 3
  (`visual/phase-b-r2/pb-library-skills-dark.png`, `pb-library-agents-dark.png`, `pb-library-commands-dark.png`, and `-light`).
- Real clones listed: Skills `graded-skill` (6 inv, 100%), `unused-skill`, `used-skill` (3 inv, No grade), `zero-skill` (2 inv, 0%);
  Commands `graded-cmd` (4 inv, 50%), `unused-cmd`, `used-cmd`; Agents `architect`, `backend-developer`, `code-reviewer`,
  `frontend-developer` (6 inv, 75%). Metrics come from the real scorecard service (the `getUsageStats` TypeError is gone).
- Drawer opens for every card (`pb-drawer-skills-0-dark.png` etc.): metrics, Actions, Body, History render; no overflow
  (`horizontal overflow: false`).
- Main-process log (`udd-Ptah_Electron-2026-10-19.log`, `main-log.txt`): no `SkillsSynthesisRpcHandlers` error, no
  `getUsageStats`, no `SkillScorecard` error. The only `listClones` text in the log is the RPC surface registration list. The
  only `[ERROR]` line in the whole run is a renderer `RPC timeout for method: agent:listCliModels` (offline CLI detection in the
  sandbox, unrelated to the Library).

### 2. Enhancement row, "Mixed sources" badge - PASS (fix S3)

- Settings > Agent Orchestration > Background model roles: Enhancement row reads "haiku tier | Follows main agent -> anthropic",
  with no "Mixed sources" text anywhere in the assignments block (`run.txt` assignments note, dark and light: 0 matches for
  "mixed"). Editor open: `pb-enhancement-editor-viewport-dark.png`, `pb-enhancement-editor-viewport-light.png`,
  `pb-consumer-assignments-dark.png`, `-light.png`.

### 3. Library telemetry toggle Off -> On round trip - PASS

Clean run, no injected faults (`rt-run.txt`, `pb-rt-1-initial` .. `pb-rt-4-final`, dark + light):

| Step | Switch | Nav tile | Error alert |
| --- | --- | --- | --- |
| initial | On | On | none |
| after click (Off) | Off | still "On" (stale, see Moderate 1) | none |
| Off, after Memory tab trip | Off | Off | none |
| after click (On) | On | still "Off" (stale) | none |
| On, after tab trip | On | On | none |

The switch itself commits correctly and the nav tile converges after the tab remount. Same in both themes.
Note: in the earlier fault-injection run (`pb-library-skills-dark.png`) a stale "Could not change the telemetry switch" alert
and a switch/tile mismatch were visible; that was leftover state from the injected failed write in the same session, not
reproduced in the clean round trip.

### 4. Thoth panels full width (batch 24a) - PASS with one Serious carry-over

The panel now fills the width: left edge x=524 (16 px from the nav column), right edge ~16 px from the scrollbar rail, at 1280
and 1904. `horizontalOverflow=false` for all 16 shots (`visual/thoth-width/after/run.txt`). Tables, tab strips, long text
(Skills toggle help, Gateway adapter help, Memory index banner) wrap without clipping; Gateway form column at 1904 keeps a
sensible max width; Cron empty state and footnote align to the panel edge.

| Panel / width | Before (`visual/thoth-width/before/`) | After (`visual/thoth-width/after/`, same names) | Result |
| --- | --- | --- | --- |
| Memory 1280 | card 540-1205 wide | card 524-1221, fills | OK, last stat tile clipped (Serious 1) |
| Memory 1904 | card ~710-1670, large dead gutters | 524-1856, full width, tiles spread | OK |
| Skills 1280 | 540-1205, 5th tile clipped | 524-1221, 5th tile still clipped | Clip unchanged (Serious 1) |
| Skills 1904 | 710-1670 centred | 524-1856, switches right-aligned in one row | OK, better density |
| Cron 1280 | narrow | full width, 4 tiles fit | OK |
| Cron 1904 | centred narrow | full width, 4 tiles, header actions fit | OK |
| Gateway 1280 | 540-1205, tiles with inner bars | 524-1221, tiles with inner bars | Unchanged (Moderate 2) |
| Gateway 1904 | narrow | full width, tile row and adapter form fit | OK |

All 4 panels x 2 widths x 2 themes: `before-thoth-{memory,skills,cron,gateway}-{1280,1920}-{dark,light}.png`.

## Findings by severity

### Serious

#### 1. Last stat tile is cut off at 1280 on Memory and Skills (carried over, not fixed by 24a)

- File: stat tile row of the Memory and Skills panels (not traced to a line in this short pass; check the tile grid container
  that holds `[data-testid="dashboard-status-card"]`-style tiles for `overflow-x: auto/hidden` and the fixed tile min width).
- Viewports affected: 1280 (both themes). At 1904 all tiles fit.
- Screenshots: `visual/thoth-width/after/before-thoth-skills-1280-dark.png` (Invocations tile: right border and part of the
  play icon cut), `visual/thoth-width/after/before-thoth-memory-1280-dark.png` (Last curated tile: clock icon cut at the right
  edge). Same clip exists in the before set (`before/before-thoth-skills-1280-dark.png`), so this is not a regression, but the
  batch goal was "nothing overflows or clips".
- Problem: five equal tiles with a minimum width exceed the content width at 1280, so the row scrolls or clips inside its
  container and the 5th tile loses its right border and icon.
- Impact: partially hidden metric tile and icon at the primary desktop width.
- Fix: let the tile grid wrap (`grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))`) or reduce the min width so five
  tiles fit in ~656 px.

### Moderate and minor

1. Nav tile "Skills: On/Off" lags the switch until the Thoth tab is remounted (`pb-rt-2-off-dark.png`, `pb-rt-3-on-dark.png`);
   the switch is correct and the tile converges, but within the same view the two disagree. Same behaviour was noted in the
   earlier Phase B review (tile state refresh), so unchanged.
2. Gateway stat tiles at 1280 show an inner horizontal scrollbar strip at the bottom of the first three tiles, and the tile
   icons are tight against the edge (`visual/thoth-width/after/before-thoth-gateway-1280-light.png`; present before too). The
   same cause as Serious 1 (content wider than tile).

## Prototype fidelity

- Approved prototype: not re-compared in this short re-check (scope limited to the four items by the brief).
- Fidelity assessment: NOT APPLICABLE for this pass.
- Before/after comparison: Thoth panels dark + light pairs listed in the table above (`before/` vs `after/`, identical file
  names); Library and Enhancement rows compared with the Phase B run (`visual/phase-b/` vs `visual/phase-b-r2/`): the real
  list replaces the former error state; "Mixed sources" badge removed.

## Visual performance

Not re-measured; no layout shifts were observed between captures. The Library list loaded within the 7 s settle window.

## Verdict

- Recommendation: REVISE (the four requested fixes all verified; revise only for the last-tile clip at 1280, which is a small
  CSS change and not a regression)
- Confidence: HIGH for items 1-3, MEDIUM-HIGH for item 4 (two widths only, empty-state data)
- Key concern: stat tile rows still clip their last tile at 1280 (Skills "Invocations", Memory "Last curated").
