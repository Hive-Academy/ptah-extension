# Visual Review - TASK_2026_662 Phase C (Skills tab Library-only, routing map, background roles)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED for the Phase C change set (no regression found); 2 Serious carry-overs predate Phase C and are tracked below |
| Blocking | 0 |
| Serious | 2 (both pre-existing, not introduced by Phase C) |
| Moderate | 4 |
| Minor | 3 |
| Viewports | 1280x800, 1024x800, 375x800 (all opened, dark `anubis` and light `anubis-light`) |
| Screenshots | 88 PNG in `visual/phase-c/` (disk only, not added to git per U4) |
| Components | Skills Library (tabs, cards, pause + telemetry switches, empty state), Thoth nav tiles (4 panels), routing map + Inspect link, Agent Orchestration background roles + enhancement time limit |

## Environment

- Build: from the worktree at HEAD fc017254b. `dist` was stale (main.mjs 07:11, HEAD commit 07:46), so I rebuilt
  `npx nx run ptah-electron:build-dev` and `copy-renderer-dev` (`--parallel=1`, one at a time, both exit 0; main.mjs 07:48).
- Launch: Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs`, `--remote-debugging-port=9390` only, private
  HOME/USERPROFILE/APPDATA/LOCALAPPDATA/`--user-data-dir`/`PTAH_DB_PATH` under a new temp dir (removed on exit). Real `~/.ptah` and
  real DB untouched. Four runs: `empty`/`empty2` (no clones, no events), `seeded` (4 skills, 4 agents, 3 commands, 28 invocation
  events and NO task grades), `pass2` (canvas-based contrast, fixed selectors), `tele` (telemetry tile round trip).
- Scripts and raw logs: `visual/phase-c/capture-phase-c.cjs`, `capture-phase-c2.cjs`, `run-*.txt`, `index-raw-*.txt`,
  `applog-<run>-Ptah Electron-2026-10-19.log`, `main-stdio-<run>.txt`.
- Viewports are an audit selection, not a support contract. The Electron window accepted 375 wide (min size lifted in the script).
- Cleanup: every run ended with `app.close()`; after the last run `netstat` shows nothing on 9390 and no electron process.
- Caveat: the first `empty` run left the theme menu open in its element screenshots (harness artifact from my focus-order pass);
  `empty2` and later runs closed it. Use the `-dark/-light` empty-state files from `empty2`.

## Requested checks

### 1. Thoth > Skills tab (Library only) - PASS

- Panel content at 1280/1024/375, dark and light: header, "Skills On/Paused" pause switch, "Skill telemetry" switch, Library intro,
  legend, kind tabs (Skills 4 / Agents 4 / Commands 3), diverged filter/bulk bar, card grid. Screenshots `pc-skills-1280-dark.png`,
  `pc-skills-1280-light.png`, `pc-skills-1024-light.png`, `pc-skills-375-light.png` (and dark counterparts).
- Removed surfaces are gone: body text contains none of "Recommended", "Sessions", "Activity", "Settings", "Candidate", "Judge",
  "Promote", and there is no candidate stat strip. The only tablist is the Library kind tabs. `testids` list (see `run-seeded.txt`)
  has no `skills-candidate-*`/`skills-digest-*`/`skills-stat-*`.
- VS Code notice (`clones-desktop-notice` and "VS Code" text): not rendered in Electron.
- Success rate: with 28 invocation events and no task reviews, every card shows "No grade" (metric `clone-metric-success`,
  e.g. graded-skill, 6 invocations: "SUCCESS No grade"); " 0%" and "0 %" occur nowhere. Never-run cards show "Never invoked yet"
  and `0/5 runs`. (`pc-skills-1280-dark.png`)
- Empty state (no clones): "No skills in your library yet. Skills arrive when you install a plugin or accept a recommendation."
  with kind tabs at 0 (`pc-empty-state-dark.png`, `pc-empty-state-light.png` from `empty2`).
- Pause switch: On -> Paused -> On round trip works in both themes; Paused shows the orange card, the tile gets a "Paused" badge,
  and a notice "Skills is paused, so Enhance now is unavailable" appears (`pc-paused-light.png`, `pc-paused-dark.png`).
  Telemetry switch toggles Off/On cleanly (`pc-telemetry-off-*.png`). No error alerts.
- Layout: `horizontalOverflow=false` everywhere. At 375 the Thoth nav becomes a horizontal tile scroller (Memory scrolled out of
  view, scrollbar visible); this is the existing responsive pattern. The content column wraps cleanly; no clipping in the panel.
- Focus order (`run-pass2.txt`, 25 Tab stops, dark and light): tiles, pause switch, telemetry switch, Refresh, kind tab, tabpanel,
  diverged filter, card 1 (opens details), Enhance now, cards 2-4, Git panel toggle, top nav. Logical, every stop has a visible
  outline ring (`ring=outline` for all 25). The tabpanel container is an extra tab stop (656x377), acceptable.
- Contrast (canvas-composited, `run-pass2.txt`), dark / light: pause state 14.0 / 14.4; telemetry help text 5.71 / 5.47; "No grade"
  5.71 / 14.44; invocations value 14.0 / 14.4; "N/5 runs" and "Never invoked" 5.71 / 5.47; Skills tile value "On" 7.39 / 3.45 (20px
  semibold, large text, passes the 3:1 criterion). Criterion used: WCAG AA (4.5:1 normal, 3:1 large); the repo declares none.

### 2. Settings > Providers routing map and Inspect link - PASS with one Moderate

- Background roles node: title, "2 roles" badge, "2 roles / Follow main agent", footer "0 set - 2 following", `Inspect` link. No
  "+N more" row anywhere (`routing "more" match: false`). (`pc-routing-map-1280-dark.png`, `pc-routing-map-375-light.png`)
- Inspect: clicking it navigates to Agent Orchestration, the Background model roles `<details>` is open (`detailsOpen=true`) and
  focus lands on `section[Background models]` in all 6 combinations (1280/1024/375 x dark/light). Section is scrolled into view
  (`pc-inspect-landing-1280-light.png`, `pc-inspect-landing-375-dark.png`). Programmatic focus draws no ring (it is not a
  Tab-reachable element); see Minor 2.
- Moderate 1 below: the node says "2 roles" while Orchestration says "3 roles".

### 3. Settings > Agent Orchestration background roles - PASS

- Summary "BACKGROUND MODEL ROLES, 3 roles, Memory curator, enhancement, decision"; rows `consumer-row-memory-curator`,
  `consumer-row-enhancement`, `consumer-row-decision` (`pc-orch-open-1280-dark.png`, `pc-orch-open-1280-light.png`,
  `pc-orch-open-viewport-375-dark.png`).
- No "Judge" text; no lane pickers or Skill-synthesis/curator rows. The word "lane" appears once, in the Decision model help
  ("Code ranking chooses lanes and models"), which is legitimate copy.
- Enhancement time limit: Edit limit -> input 120 -> 240 -> Save limit. Display changed to "Time limit: 240 seconds" and it was
  still 240 after leaving Settings and re-opening Agent Orchestration (dark and light, `pc-timeout-saved-*.png`).
- 1024 and 375: cards stack/wrap, no overflow.

### 4. Thoth shell tiles - PASS with one Moderate

- Tiles in all four panels: Memory "0 facts / All curated", Skills "On / Skill telemetry", Schedules "0 jobs / no upcoming runs",
  Messaging "0 running + platform chips". No candidate counts. Other tiles unchanged versus Phase B text.
- Moderate 2: the Skills tile does not follow the telemetry switch until the tab is remounted (`run-tele.txt`: switch Off, tile
  still "On" after 4 s; "Off" only after a Memory/Skills tab trip; same in reverse; both themes).

### 5. Main-process log - no Phase C errors

`applog-*-Ptah Electron-2026-10-19.log` (4 runs): 0 `[ERROR]` lines, no unresolved DI token, no `skillSynthesis:*` RPC failure, no
`listClones`/`getScorecards` error. Warnings (identical in all runs): "Lane outcomes start failed (non-fatal): {error:{}}" (also
present in the Phase B r2 log, so not new), `MCP port 51820 (EADDRINUSE) ... started on 51821` (another Ptah instance on this
machine), `SdkModelService /v1/models failed for API key auth` (no key in sandbox), `[RPC] slow handler provider:getPlanLimits ~3 s`,
renderer `NG0914` zoneless/Zone.js notice. See Moderate 3 and 4.

## Findings by severity

### Blocking

None.

### Serious (both pre-existing, outside the Phase C diff; listed so they are not lost)

1. Light theme: Thoth nav tile values fail contrast. Screen Thoth shell, light, 1280 (all widths). Memory "0" 1.27:1, Schedules "0"
   2.35:1, Messaging "0" 1.16:1 (20px semibold large text, needs 3:1). Evidence `run-pass2.txt` "(contrast light) tile value", visible
   in `pc-skills-1280-light.png` (pale cyan and peach digits on cream). Skills "On" is 3.45:1 and passes. Phase B r3 did not
   measure this. Fix: use the dark-ink or `-content` shade of the accent colours in `anubis-light` for tile values.
2. Light theme: Library card status text "ready" is 2.15:1 on 11px text (needs 4.5:1), `pc-skills-1280-light.png` (graded-skill card),
   `run-pass2.txt` "(contrast light) enhance hint". Dark is 5.31 and passes. Fix: darker green for light-theme status text.

### Moderate

1. Routing map undercounts background roles. Providers, all themes/widths, `pc-routing-map-1280-dark.png`: node shows "2 roles"
   and "0 set - 2 following", while Agent Orchestration lists 3 (memory curator, enhancement, decision) and the Inspect link goes there.
   Cause: `backgroundRolesPreview` builds only Memory curator and Enhancement (`libs/frontend/chat/src/lib/settings/providers/routing-map.component.ts:26-29`). Also, when roles follow the main agent the node never names them
   ("2 roles / Follow main agent"), so the "shows its roles" intent is only met when a role has its own provider. Fix: include the
   Decision role (or relabel) and list role names in the node.
2. Skills nav tile stale after the telemetry switch (see check 4). Same as Phase B r2 Moderate 1, still open.
3. "Lane outcomes start failed (non-fatal)" at every boot with an empty serialized error (`{"error":{}}`), from
   `libs/backend/lane-outcomes/src/lib/di/start.ts:177`. The logged error is unreadable, so I could not tell whether it is an unregistered
   token. Present in the Phase B r2 log too. Fix: log `error.message`/stack.
4. The registered RPC surface still lists the removed pipeline's methods (`skillSynthesis:listCandidates`, `promote`, `reject`,
   `getLanes`/`setLanes`, `getAgentModels`/`setAgentModel`, `listSuggestions`, `digest`, ...), from the "RPC surface registered" log line.
   No UI calls them, but if the purge intended to remove them, they remain.

### Minor

1. Paused state: nav tile shows a "Paused" badge next to the value "On / Skill telemetry"; the two read as contradictory at a glance
   (`pc-paused-light.png`).
2. Inspect focus target (`section[Background models]`) has no visible focus ring; keyboard users get scroll position but no cue.
3. Orchestration cards at 1280 stretch to equal height, leaving a large empty gap in the Memory curator card
   (`pc-orch-open-1280-light.png`).

Observation outside Phase C scope: Messaging panel at 1024 (`pc-tiles-gateway-1024-dark.png`) squeezes the bot-token form column
(button label "Save & st..." clipped at the card edge). Not examined further; not a Phase C surface.

## Prototype fidelity

- Approved prototype: none provided for this phase (Phase C removes surfaces). Compared against Phase B evidence
  (`visual/phase-b-r2/`, `visual/thoth-width/tiles/`): tile sizing and Library card layout match; Recommended/Sessions/Activity/Settings
  subviews and the candidate stat strip are gone as intended; Skills tile value moved from candidate counts to telemetry On/Off.
- Fidelity assessment: NOT APPLICABLE (no prototype), no regression versus Phase B.

## Viewport results

| Viewport | Screens | Status | Evidence |
| --- | --- | --- | --- |
| 1280x800 | Skills, tiles x4, providers, orchestration, both themes | PASS, no overflow | `pc-*-1280-*.png` |
| 1024x800 | same | PASS, no overflow, cards wrap to 2 columns | `pc-*-1024-*.png` |
| 375x800 | Skills, tiles, providers, Inspect, orchestration | PASS: `horizontalOverflow=false`; nav is a horizontal tile scroller | `pc-*-375-*.png` |

## Verdict

- Recommendation: APPROVE the Phase C change set, with the two pre-existing light-theme contrast Serious items and Moderate 1
  (routing map says 2 roles, orchestration says 3) to be fixed or ticketed.
- Confidence: HIGH for the five requested checks; MEDIUM for contrast outside the sampled elements. Not tested: non-empty
  telemetry data, quarantined agents, bulk rebase with diverged entries, keyboard use of the Inspect link.
- Key concern: routing map role count (2) disagrees with Agent Orchestration (3).
