# Visual review round 2 - TASK_2026_motion_presets (Electron)

Verdict: **FAIL** (1 visual-breaking defect still open: D1 provider wizard). D2, D3, D4, D5, D8 are fixed. All other round-2 tests PASS or PASS WITH NOTES.

## Environment and method

- Real Electron app, built bundle `dist/apps/ptah-electron/main.mjs` of this worktree (not rebuilt). Playwright `_electron`, scripts in `%TEMP%\ptah-visual-test\motion\` (`a1`-`a8`, `zb`, `zc`, `zd`, helpers `common.ts` and `bc.ts`). One Electron instance at a time.
- Real backend (isolated profile `%TEMP%\ptah-motion-udd`, isolated DB) for Settings, Marketplace, Thoth and the wizard. Fake-RPC driver (`UiDriver.mockRpc`) with profile `%TEMP%\ptah-motion-udd2` for chat sessions and the inspector; its `config.json` was written with the wanted `ptah.motionPreference` before launch (the UI path was tested separately on the real profile).
- Recorder: every frame samples `document.getAnimations()` (incl. `::view-transition` pseudos), the computed transform and opacity of `ptahMotionEnter/Leave` targets, counts of `.ptah-motion-leave`, `.ptah-pane-switch-leave` and `[data-motion-clone]`, `animationstart/cancel`, and also each animation's `getComputedTiming().duration`. Screenshots are supporting evidence.
- Launch flag: `--force-prefers-no-reduced-motion` for all tests except section B (no flag). The flag check in B: `hasSwitch(...)` is false/false, so Chromium switches are no longer used and the per-window CDP emulation is the mechanism.
- Viewports: 1186x738 (reported inner 1184x735) and a window set to 1800x1000 (inner 1784x935, the "1693" class). Themes: dark non-glass `anubis`, dark glass `ptah-glass`, light `anubis-light`.
- Screenshots: `.ptah/specs/TASK_2026_motion_presets/visual-review-round-2/`.

## Results

| # | Test | Result | Evidence |
|---|------|--------|----------|
| A-D1 | Wizard Back / Continue / direct step / close / reopen | **FAIL** | see D1 below; `D1_afterBack.png`, `D1_fwd2.png`, `D1_reopen_fwd.png`, `D1_stale_below_list.png`; `a4.out`, `a5`, `a8.out` |
| A-D1 mode | Credential-mode switch API key <-> sign-in, mid-leave reverse, nested leave (~1615) | NOT TESTED | no provider in the catalog offers both modes: 15 options scanned (Claude API ... sovereigneg), none shows `wizard-use-api-key` or `wizard-use-sign-in` (`a6.out`) |
| A-D3 | Marketplace wide connector open/close | PASS | `a3.spec`/`D3_wide_open.png`: exactly one `ptahMotionEnter` and one `ptahMotionLeave`, both on the branch-panel swap (list <-> detail); `ptah-connector-detail` itself does not animate. Open and close, dark and glass (`D3_connector_*`, `D3_glass_open` in `a1.out`): max 1 entering, y=18 once, no doubling. Round 1 had 2 entering (36 px). |
| A-D4 | Top-level surface change = only whole-window crossfade | PASS | `D4_*` in `a1.out`: 4 theme/preset combos x Settings/Marketplace/Thoth. `ptahPageIn` runs on `::view-transition-new(root)`; child `ptahMotionEnter` has `duration=0.01` (`a2` run, Slide left; Settings and Marketplace) so it finishes in one frame; Thoth has none. Title-bar actions and theme toggle min=max in x and y (no jolt). |
| A-D5 | Theme popover shows Motion + Animation style without scroll at 1186x738 | PASS | `D5` in `a1.out`: Motion y 203-367, Animation style y 379-559 inside a 735 px viewport, popover not scrolled; `D5_popover_dark_1186.png`, `L_popover_light_1186.png` (light, same). |
| A-D8 | Marketplace page change resets scroll | PASS (partial) | Overview scrolled to 363, then Connectors: scrollTop 0 (`D8_*`, `D8_before.png`, `D8_after.png`). Detail-only scroll retention NOT TESTED: the MCP Servers page had no scroller to scroll (`D8_before_detail` empty). |
| B | Motion setting, three values, relaunch | PASS | UI writes `config.json` `{"ptah":{"motionPreference":...}}` and shows "Restart Ptah to apply" (`B_*_menu.png`; "Always" is the default, so selecting it writes nothing). Relaunch: **Always** `matchMedia reduce` = false, Marketplace and Settings tab animate (`ptahMotionEnter` 320 ms, `ptahMotionLeave` 180 ms), session switch animates (380/180 ms). **System** (OS has no reduce) = false, same motion. **Reduce** = true, radio restored, Marketplace and Settings tab: `ptahMotionEnter duration=0.01`, no leave, session switch: zero animations. |
| B reload | Reduce survives reload | PASS | `reload_mm` true; Marketplace after reload `dur=0.01`. |
| B DevTools | Reduce while and after DevTools | PASS WITH NOTE | `devtools_open_mm` = false while DevTools is attached (DevTools replaces the debugger, documented in `motion-emulation.ts`), `devtools_closed_mm` = true after close and Marketplace is reduced again. |
| B browser tool | Browser-tool window opens without "Failed to attach debugger" | NOT TESTED | cannot trigger `ptah_browser_*` from the app UI in this harness. The profile logs contain no "Failed to attach" / "motion emulation" entries across all runs. Code skips non-default sessions (`motion-emulation.ts` line 30). |
| B OS reduce | "Follow system" with the OS set to reduce | NOT TESTED | OS setting not changed. |
| C-inspector | Session inspector motion | PASS | 1784x935, docked pane `[data-inspector-pane]`. On session switch `ptah-inspector-session-stats` plays `ptahMotionLeave` (180) and `ptahMotionEnter` (380, y 15.8) in dark; in glass it enters with `ptahMotionEnterGlass` and cuts out, same as the transcript rule. Slide left gives x 32 (`C_insp_*` in `zc.out`). |
| C-reduce matrix | six presets x glass/plain under Reduce | PASS | Marketplace (24 samples, `C_reduce_*`) and session switch (24 samples, `S_reduce_*`): Marketplace entrances `dur=0.01` (one starting frame, no leave); sessions no animation at all. All six presets, glass and plain. |
| C-light | Light screenshots | PASS | `L_chat_light_1186.png`, `L_chat_light_1693.png`, `L_settings_light.png`, `L_marketplace_light.png`, `L_marketplace_connectors_light.png`, `L_popover_light_1186.png`, `L_catalog_light.png`. No contrast or layout defect seen. |
| D-picker | Preset picker immediate and persistent | PASS | Click Scale gave `data-motion-style=scale` in 129 ms (incl. click); ArrowRight gave `directional`; Slide left persisted after relaunch (`D_after_restart`). |
| D-G1 | Marketplace leave node kept by RouterOutlet destroy | PASS | `D8_to_connectors`: old `ptah-overview-page` runs `ptahMotionLeave` y 0 to -10 for ~180 ms, max leaving 1, clones 0. |
| D-jolt | Navbar/rail jolt on surface change | PASS | title-bar tracked elements: dy = dx = 0 in all D4 samples. |

## Defects

**D1 (still open) - Visual breaking - Provider wizard: Back leaves a stale Credential panel, panels stack.**
Steps: Settings > Providers > Connect provider > Connect (Claude API) > Continue > Back > (wait 5 s) > Continue.
Observed:
- Improvement: the leave now runs on Back (`ptahMotionLeave` x to -32, `D1_back1`) and the stale node is `inert` + `aria-hidden`.
- Still broken: the outer Credential step is never removed after the leave. 5 s after Back the DOM still holds `wizard-step-credential` (inert, y 1282) below the Provider list (`after_back_5s`), including the nested panel and its ids (duplicate `wizard-api-key-label`). `Continue` again adds a second Credential panel, and the Provider panel is then also not removed: the page shows the whole Provider list above the Credential form (`D1_fwd2.png`). Same stacking after a direct step-link click (`c_link_provider`, `c_after_link_fwd`: 3 panels) and after close + reopen + Continue (`D1_reopen_fwd.png`: Provider list kept above Credential).
- Back and reverse transitions have no entrance: no `ptahMotionEnter` on the Provider panel after Back (`D1_back1` maxE 0).
- Rapid Back/Continue (60 ms) and Back, Back (40 ms) leave 2 to 3 stale panels (`c_rapid*`, `c_rapid_bb`).
- Closing the wizard during a leave and reopening is clean (no stale panel, `c_closed`, `reopen`); focus lands on the drawer close button.
Likely cause: the outer `[data-testid="wizard-step-credential"]` (`provider-setup-wizard.component.ts:641`) is removed only after nested function-valued leaves finish; the nested mode panels (lines 653, 739, 799, 837, 900, 963, handler `leaveCredentialModePanel` at 1630-1636, `leaveSensitivePanel` at 1615-1627 which adds the leave class, then waits on `animation.finished` and calls `animationComplete()`) leave the whole subtree attached. `goToStep` (2072-2087) marks the node inert but nothing removes it. Fix direction: make the outer step leave the only one that gates removal (no function-valued `animate.leave` on nested panels while the step itself leaves), and call `animationComplete()` for the nested nodes immediately when the parent is leaving.

**D6 (known, unchanged) - Moderate.** Glass Marketplace entrance starts as `ptahMotionEnterGlass` and swaps to `ptahMotionEnter` ~30 ms later (`D4_glass_rise_Marketplace`, `D4_glass_dir_Marketplace`). First Settings entry in glass shows both names. Not worse.

**D7 (known, not retested in depth).** `directional` slides forward for an earlier session; the same rule shows in the inspector sample.

## Notes

- The "1693" window is set to 1800x1000, which reports 1784x935 inside.
- `~/.ptah/settings.json` and `~/.ptah/global-state.json`: there is no theme or motion-style key in either file (`settings.json` has no `theme`, `glass` or `motion` key; `global-state.json` was last modified 13 Sep). My runs persisted theme and style only inside the isolated profile directories. So there was nothing to restore in `~/.ptah/settings.json`; I did not edit it. The last real-profile state is theme Anubis, style Rise (the isolated profile `ptah-motion-udd` only).

## Not tested (with reason)

- Credential-mode switch API key <-> sign-in, its mid-leave reverse, and the nested mode-switch leave (~1615): no catalog provider with both modes in this profile.
- Browser-tool window debugger attach: not triggerable here (logs show no attach error).
- "Follow system" with an OS reduce preference.
- Detail-only Marketplace navigation keeping scroll (no scrollable page for that case).
- Glass inspector with rich (tool card) content.
