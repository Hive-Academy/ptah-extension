# Visual Re-check - TASK_2026_662 Phase C fix round + batch 57

Score: 8/10. Verdict: APPROVED. Visual breaking 0, Serious 0, Moderate 2, Minor 1.

## Environment

- Worktree HEAD b56a94aaa. Rebuilt with `NX_NO_CLOUD=true npx nx run ptah-electron:build-dev` then `copy-renderer-dev` (`--parallel=1`, one at a time, main.mjs 18:48). No other build, serve, e2e or package target.
- Playwright `_electron.launch` of `dist/apps/ptah-electron/main.mjs`, `--remote-debugging-port=9390` only. Private HOME/USERPROFILE/APPDATA/LOCALAPPDATA/`--user-data-dir`/`PTAH_DB_PATH` in a temp dir, removed on exit. The real `~/.ptah` and real DB were untouched.
- Seeded sandbox `.ptah/specs`: 2 done/cancelled specs with an old `.harvested.json` marker (20d, 12d), 1 done spec not harvested, 1 `in_progress` spec. Seeded `scheduled_jobs` `@ptah/skills-drain-frequent` and `@ptah/skills-backlog-cleanup` (enabled=1) after a pre-boot that created the DB, then relaunched. (My first seeding used wrong job ids, so it did not exercise retirement. I corrected the ids and re-ran. The results below are from the second run.)
- Widths 1280 and 375 (audit selection), themes `anubis` (dark) and `anubis-light`.
- Script and raw output: `visual/phase-c-r2/capture-r2.cjs`, `run.txt`, `index-raw.txt`, `main-stdio.txt`, `applog-*.log`. Screenshots are `r2-*.png` in the same folder (disk only).
- Cleanup: `app.close()` ran in `finally`. `netstat` shows nothing on 9390 and no electron process remains.

## A. Thoth > Skills tab, "Orchestration specs" card - PASS

- Renders below the Library (card top 650 vs Library bottom 630 at 1280, 589 vs 569 at 375). Screenshots `r2-specs-card-1280-dark.png`, `r2-specs-card-1280-light.png`, `r2-specs-card-375-dark.png`, `r2-specs-card-375-light.png`, `r2-skills-1280-dark.png`, `r2-skills-375-light.png`.
- Count text "4 specs, 2 stale" with seeded data.
- Clear stale (2) click: both harvested specs moved to `.ptah/specs/.archive/` (archive mode, no delete). Count became "2 specs, 0 stale" and the button was disabled. No alert (`r2-specs-after-clear-dark.png`).
- Harvest now: the unharvested done spec was harvested, count refreshed to "2 specs, 1 stale", no error. A second Harvest was idempotent with no error (`r2-specs-after-harvest-dark.png`, `r2-specs-after-harvest-light.png`).
- Focus: both buttons show a 2px solid outline, 2px offset, in the primary colour (`r2-focus-harvest-dark.png`, `r2-focus-clear-dark.png`, and the light pair). Tab order is logical: Library controls, then Harvest, then Clear stale.
- Contrast (canvas-composited, WCAG AA 4.5:1), dark / light: help text and count 5.65 / 5.39 (12px), heading 13.89 / 14.21, Harvest button 4.82 / 6.81 (11px), Clear stale button 13.89 / 14.21. All pass.
- Targets are 77x24 and 85x24 CSS px (light 79x24 and 87x24). This meets the WCAG 2.2 AA 24x24 minimum with no margin.
- 375: card width 324, no horizontal overflow (`horizontalOverflow=false`). The only elements past the viewport are the existing `min-w-[400px]` shell and its ancestors, the same as the previous review and the same on the Providers page. The buttons wrap cleanly.
- The rest of the Skills tab is unchanged: pause and telemetry switches, Library intro and legend are present, with the same layout as the previous review.

## B. Settings > Providers routing map - PASS

- Background roles node (`r2-routing-bg-node-1280-dark.png`, `r2-routing-bg-node-375-dark.png`, light counterparts): "3 roles", Memory curator, Enhancement and Decision, each showing "Default". Footer "0 set · 3 default". No "+N more" (the text match for "more" is false). Inspect link present.
- Inspect opens Agent Orchestration, "BACKGROUND MODEL ROLES | 3 roles | Memory curator, enhancement, decision". It has 3 consumer rows: `consumer-row-memory-curator`, `consumer-row-enhancement`, `consumer-row-decision` (`r2-inspect-landing-1280-dark.png`).
- I did not set a provider on any role, so the "N set" count with N > 0 was not rendered. This is residual uncertainty.

## C. Tray - PASS (log evidence)

- The Playwright main-process API does not expose Tray menu items. The log shows `[Ptah Electron] Tray created (memory pause control)`. Menu labels were not read from the live menu. Source defines only `PAUSE_MEMORY_ITEM_LABEL` and `QUIT_ITEM_LABEL` (`apps/ptah-electron/src/services/tray/tray.service.ts:69-70`); I did not open the tray menu in the running app.
- Closing the window (all BrowserWindows closed) exited the process with code 0, so the app quits on close on Windows.

## D. Main-process log - PASS

- `[ERROR]` count is 0 in the final run. No DI errors. "DI verification: 5/5 tokens resolved".
- `[Ptah Electron] Disabled 2 retired skill pipeline jobs` appears (main-stdio line 63). After shutdown the DB shows both seeded retired jobs `enabled=0` and the default jobs unaffected. The cron scheduler started with `armed: 3`.
- Existing warnings, not new: "Lane outcomes start failed (non-fatal)" and "[task-specs] index rebuild write failed: no such table: task_specs" in the pre-boot run. Neither is related to this change.

## Findings

### Moderate

1. "Clear stale (N)" counts every harvested spec but clears only those older than the 7-day retention window. After Harvest, the count showed "1 stale" and the button was enabled. Clicking it changed nothing and gave no feedback (`ACTION clear on fresh-harvested` in `run.txt`, `r2-specs-after-harvest-dark.png`). Source: `skill-synthesis-state.service.ts:31-33` (stale = status `harvested`) against `spec-harvester.service.ts:255-264` (retention cutoff). Fix: count only specs with `ageDays >= 7` as stale, or show a result toast ("0 archived, retention 7 days").
2. The Clear stale button gives no visible success or empty-result feedback. The count change is the only signal. Same fix as above.

### Minor

3. The card's buttons are 24px high with 11px text. They pass AA 2.2 but sit exactly at the minimum.

## Prototype fidelity

No prototype in scope for this re-check. Before and after: the Skills tab (dark and light, 1280 and 375) matches the previous review apart from the new card. Comparison pairs: `visual/phase-c/pc-skills-1280-dark.png` against `visual/phase-c-r2/r2-skills-1280-dark.png`, and the light pair `pc-skills-1280-light.png` against `r2-skills-1280-light.png`.

## Verdict

APPROVED, confidence MEDIUM-HIGH. Key concern: the stale count and the retention window disagree (finding 1). It is a copy and count issue, not a layout or accessibility failure.
