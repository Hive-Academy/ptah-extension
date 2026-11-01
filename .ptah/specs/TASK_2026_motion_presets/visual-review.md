# Visual review - TASK_2026_motion_presets (Electron)

Verdict: **FAIL** (2 visual-breaking defects, 3 serious)
Gate G1 (Marketplace leave node kept by RouterOutlet destroy): **PASS** (no clone needed; leave `MARKETPLACE_LEAVE_CLONE_DEFAULT` = false)

## Environment and method

- Real Electron app, built bundle `dist/apps/ptah-electron/main.mjs` of this worktree (not rebuilt). Playwright `_electron`, scripts in `%TEMP%\ptah-visual-test\motion\` (adapted from the composer/dock scripts).
- Settings, Marketplace and Thoth ran against the real backend (isolated profile `%TEMP%\ptah-motion-udd`, isolated DB). Chat/session tests used the fake-RPC driver (`UiDriver.mockRpc`) with pushed `chat:chunk` events (two sessions with messages).
- No `--force-prefers-no-reduced-motion` was passed. The app appends it itself for Motion = "Always animate" (default), and `matchMedia('(prefers-reduced-motion: reduce)').matches` was `false`. The OS here is not set to reduce motion ("Follow system" also gave `false`).
- Motion is proven by an in-page recorder: every animation frame samples `document.getAnimations()` (including `::view-transition` pseudos), the computed transform and opacity of each `ptahMotionEnter/Leave` target, the count of `.ptah-motion-leave`, `.ptah-pane-switch-leave` and `[data-motion-clone]` nodes, plus `animationstart/cancel` events and bounding boxes of the title bar. Screenshots at fixed offsets are supporting evidence only.
- Viewports: 1186x738 (default window), 1693x938 (set to 1800x1000) for docked-inspector tests. Themes: dark non-glass `anubis`, dark glass `ptah-glass`, light `anubis-light` (picker only). Light screenshots were taken for the picker and its focus ring only; the main surfaces were measured, not screenshotted, in light.
- Screenshots and extras: `.ptah/specs/TASK_2026_motion_presets/visual-review/` (98 files; `x_*.png` are exploration shots).
- Side effect: the real backend wrote theme and motion-style to `~/.ptah/settings.json`. I set them back (theme Ptah Glass, preset Rise) at the end. The Motion preference lives in the isolated profile only.

## Test results

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Session switch (and inspector) follows preset; glass = transform-only entry, cut exit | PASS WITH NOTES | 24 switches (6 presets x glass/non-glass x 2 directions): `ptahMotionEnter` on `.ptah-pane-switch-enter` takes the preset (rise y=18, slide-left x=+32, slide-right x=-32, scale, fade) while the old transcript runs `ptahMotionLeave` (`sess_*` frames). Exactly one visible transcript afterwards. Notes: (a) the glass downgrade did not trigger for this transcript because it has no `backdrop-filter` descendants (checked), so glass entry fades too; rich content (tool cards) not tried. (b) `directional`: switching to the earlier session slides forward (+30) just like switching to the later one, so no back direction (N-1). Session inspector not exercised (NOT TESTED). |
| 2 | Top-level surface change = plain whole-window crossfade, no navbar/rail jolt | PASS WITH NOTES | `ptah-vt-active` view transition with `ptahPageIn` on `::view-transition-new(root)` for every change (chat, Settings, Marketplace, Thoth, back), 3 presets x glass/plain. Title bar and Sessions-rail button x/y never moved (min = max in `t2*`, `t2c_*`). Note: D1 below. |
| 3 | Child routes and tabs | FAIL | Settings tabs, connection drawer tabs (4), voice drawer (STT/TTS), Thoth tabs (memory/skills/cron/gateway), server-detail tabs, Marketplace pages: PASS (one panel at the end, leave node present, `directional` goes +32 forward and -32 back). First-visit deferred Settings tab: leave plays 35-100 ms before the real body enters, no blank frame. Rapid switching (4 clicks in ~300 ms) in Settings, Thoth and the drawer ends with 1 panel, 0 leaving. Marketplace detail to list exit (docked inspector): PASS (leave on inspector and detail while the list stays). **FAIL: wizard Back leaves a stuck panel (D1, visual-breaking).** Credential-mode switch API key <-> sign-in and its mid-leave reverse: NOT TESTED (the three sign-in providers I tried offered no "use API key" fallback in this profile, and the retry script aborted). Wizard first-visit stagger: Continue from step 1 animates normally. |
| 4 | Presets matrix, six presets x glass on/off | PASS WITH NOTES | Marketplace Overview<->Connectors and Settings Providers<->Advanced, 12 combinations each (`t4.out`). Non-glass: all presets follow their vars; `directional` back = -32. Glass Settings: enter at opacity 1.0 (transform-only), no leave (cut); fade moves 18px, scale 6px. Glass Marketplace pages: leave is a cut, but the entrance starts as `ptahMotionEnterGlass` and swaps to the fading `ptahMotionEnter` ~70-110 ms later (the known glass-to-plain flash; seen on every Marketplace page change and on first Settings entry). |
| 5 | G1 | PASS | See G1 section. |
| 6 | B4 N1, N4 | N1 CONFIRMED (defect D3); N4 PASS WITH NOTE | See below. |
| 7 | Motion setting | FAIL | UI and persistence work, but the Chromium switch has no effect (D2). |
| 8 | Preset picker | PASS | Immediate: clicking Scale set `data-motion-style="scale"` within 300 ms; arrow keys change it too. Persists across restart (value `scale` after three relaunches). Hover on "Slide left" ran `ptahMotionEnter` on its preview chip. Keyboard focus draws a 2px outline on the preview frame (`picker_focus_dark.png`, `picker_focus_light.png`). |
| 9 | Accessibility of new controls | PASS WITH NOTES | Contrast (measured, text 12px): dark `anubis`/`ptah-glass` legends and labels 15.7:1, descriptions (opacity .7) 8.2:1; light `anubis-light` 15.9:1 and 6.2:1. All above 4.5:1. Focus ring 2px solid, visible in both themes. Notes: the theme menu is a 448px scrolling popover, so Motion and Animation style are below the fold until scrolled (D5); the three Motion radios use the default radio focus (2px outline) and are fine. |

## G1 result (Gate G1): PASS

When RouterOutlet destroys a Marketplace page, Angular keeps the host `animate.leave` node until its leave animation ends. Evidence (`G1_page_*`, `m_*` in `t3m.out`, `t4.out`): on Overview -> Connectors -> MCP Servers -> Smithery -> Community -> Overview the old page element (`ptah-overview-page`, `ptah-connectors-page`, `ptah-installed-servers-page`, `ptah-server-source-host`) carries `.ptah-motion-leave` with a running `ptahMotionLeave` (y 0 -> -10, opacity 1 -> 0) for about 180 ms while the new page runs `ptahMotionEnter`. Max leaving nodes 1, max clones 0 in every sample. Also true for the docked-inspector close (2 leaving nodes) and the connector detail close. Do not change `MARKETPLACE_LEAVE_CLONE_DEFAULT`.

## Defects

**D1 - Visual breaking - Provider wizard: Back leaves the old step in the page and stacks panels.**
Steps: Settings > Providers > Connect provider > Connect (Claude API) > Continue (Credential step) > Back > Continue. Observed (`wiz_afterBack.png`, `wiz_fwdAgain.png`, `t3w2.out`): after Back the Provider panel is shown, but the Credential panel stays in the DOM for good (no `ptah-motion-leave`, not `inert`, not `aria-hidden`, `animation: none`, still 2 buttons/inputs). It sits below the Provider list (y=1271) and is never removed (still there after 4 s). Pressing Continue again then renders the whole Provider list ABOVE the Credential form (screenshot). Neither the leave nor the enter animation ran on Back (no animation events at all), while Continue (forward) animated normally. Impact: stacked panels, stale focusable credential controls, duplicate ids; Back and direct step clicks have no motion. Likely cause: the function-valued `[animate.leave]="leaveSensitivePanel"` on the credential step (`provider-setup-wizard.component.ts:641, 1615-1627`) is not invoked/does not complete on this removal path.

**D2 - Visual breaking (feature does not work) - Motion setting: "Reduce motion" has no effect.**
Steps: theme menu > Motion > Reduce motion ("Restart Ptah to apply" shows, `config.json` gets `{"ptah":{"motionPreference":"reduce"}}`), close, relaunch with the same profile. Result: `matchMedia('(prefers-reduced-motion: reduce)').matches` is still `false`, and Marketplace page changes still run `ptahMotionEnter/Leave` (`B_motion`). `app.commandLine.hasSwitch('force-prefers-reduced-motion')` is `true` (main.ts appended it) and launching with that switch explicitly also gives `false`. So the Chromium switch is not honoured by this Electron renderer. "Always animate" (value false) and "Follow system" (OS has no reduce preference: false) behave as expected, and the setting persists and the radio restores after restart. Because Reduce does not win, the "reduced motion path" of every B-batch cannot be verified in Electron, and the user decision "Reduce must still win over every preset" is not met. Needs a renderer-side mechanism (for example a `data-motion-reduced` attribute driven by the setting, or a CSS-level switch) instead of, or in addition to, the command-line switch.

**D3 - Serious - Connector card open at wide width: compounded rise (B4 N1).**
Steps: window 1693 px wide, Marketplace > Connectors > click the Notion card. Both the branch panel `div.ptah-motion-panel` and the routed `ptah-connector-detail` run `ptahMotionEnter` (y=18 at the same time, E=2 at t=353 ms in `N1_connector_open`), so the detail rises about 2x (36 px total) and opacity multiplies. Closing does the same in reverse (two leaves, `N1_connector_close`). Fix: gate one of the two for this swap.

**D4 - Serious - Top-level surface change is not a plain crossfade for Settings and Marketplace.**
Steps: any surface -> Settings or Marketplace with Rise, Slide left or Direction-aware (`t2b.out`, `t2c_*`). Alongside `ptahPageIn` the destination's first panel also plays the preset (`ptahMotionEnter` y=18 or x=32, opacity from 0), so you get crossfade plus rise/slide in the same 320 ms. Thoth and chat->chat are plain. Against user decision 2 ("plain whole-window crossfade, slides only inside surfaces"). Navbar and rails stay put. Fix: suppress the child entrance while `html.ptah-vt-active` is set.

**D5 - Moderate - Motion pickers sit below the fold of the theme popover.**
At 1186x738 the popover is 448 px tall with an inner scroll bar; Motion and Animation style are only reachable by scrolling (`pref_menu_dark.png`). Not wrong, but the new controls are hard to discover. Also the popover clips the top of the swatch grid after `scrollIntoView` (`picker_focus_light.png`).

**D6 - Moderate - Glass to plain flash (known, ~70-110 ms).** Marketplace page changes in `ptah-glass` start as `ptahMotionEnterGlass` and then switch to `ptahMotionEnter` (opacity animation restarts). Also seen on first Settings entry. Documented as known.

**D7 - Minor - `directional` session switch is not direction-aware.** Switching to an earlier session still slides forward (+30 px) (`sess_*Directionaware_toONE`, `..._toTWO`).

**D8 - Minor - Scroll offset carries over on Marketplace page change.** With the Overview scrolled 355 px, Connectors opens with the scroller still scrolled (its heading is off screen, `N4_leave_80ms.png`). Not part of the motion contract; noted from N4.

## B4 open items

- N1: confirmed, see D3.
- N4 (long Marketplace page leaving while scrolled): the leaving node is not clipped and stays anchored (rows of the old page sit within about 10 px of their original y; the -10 px leave drift), no overflow or jump (`N4_before.png`, `N4_leave_80ms.png`). The only oddity is the inherited scroll offset (D8).

## Not tested (with reason)

- Session inspector open/switch (not reached in the fake-RPC chat driver).
- Provider wizard credential-mode switch (API key <-> sign-in) and the reverse-in-the-middle-of-a-leave direction jump, drawer placement of list->detail->list for connectors and skills (the skills list shows skeletons; no network).
- Reduced-motion rows of the matrix (blocked by D2).
- Light-theme screenshots of the main surfaces (only the picker, in light).
- Output-style edit/preview tab and narrow-window drawer placements.

## Summary table by test

| # | Result |
|---|--------|
| 1 | PASS WITH NOTES |
| 2 | PASS WITH NOTES (D4) |
| 3 | FAIL (D1) |
| 4 | PASS WITH NOTES (D6) |
| 5 (G1) | PASS |
| 6 | N1 fail (D3), N4 pass |
| 7 | FAIL (D2) |
| 8 | PASS |
| 9 | PASS WITH NOTES (D5) |
