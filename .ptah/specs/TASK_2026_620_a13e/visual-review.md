# Visual Review - TASK_2026_620_a13e (B-P: Memory and Skills pause switches)

## Summary

| Metric            | Value                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall score     | 8/10                                                                                                                                                        |
| Assessment        | NEEDS_REVISION (verdict: REVISE)                                                                                                                            |
| Visual breaking   | 0                                                                                                                                                           |
| Serious           | 1                                                                                                                                                           |
| Moderate          | 3                                                                                                                                                           |
| Minor             | 2                                                                                                                                                           |
| Viewports tested  | 2 (1366x768, 900x700) x 2 themes (dark `anubis`, light `anubis-light`)                                                                                      |
| Screenshots taken | 80 PNG (plus 4 metrics JSON files) in `screenshots/b-p/`                                                                                                    |
| Components tested | Memory switch, Skills switch, sidebar Paused badges, Memory Run curator now, Skills Run Curator / Analyze / Enhance, Library paused banner, Skills Settings |

Why 8 and not 9-10: the feature is correct and obvious in every state I rendered. One reproducible layout shift on the Skills switch at 900 px costs a point and decides the verdict (it moves the switch out from under the pointer on click). Why not 6-7: no breakage, contrast passes everywhere that matters, role/aria and keyboard are right.

## Environment

- Build verified: ran `npx nx build ptah-extension-webview --skip-nx-cache` in the worktree (production build, succeeded, about 58 s) so the bundle in `dist/apps/ptah-extension-webview` is from the tree under review. No workspace-wide build.
- Rendered with the webview e2e harness (`libs/frontend/webview-e2e-harness`: fixture server, CSP stub, postMessage bridge, Chromium via Playwright, `useAppBuild: true`). Mocked RPC only; no Electron app was launched, so no real `~/.ptah/settings.json` was touched.
- The driver was a TEMPORARY spec (`.../scenarios/thoth/tmp-pause-review.e2e.spec.ts`, modelled on `thoth-feed-visual.e2e.spec.ts`). It has been deleted; `git status` shows no harness or product change. The mock was stateful: `memory:getTriggers`/`memory:setTriggers` and `skillSynthesis:getSettings`/`skillSynthesis:updateSettings` returned and persisted `enabled`, each write delayed 150 ms so the "Saving…" state is real. One skill clone fixture was seeded for the Library view.
- Base URL: fixture server (random localhost port), `ptahConfig.isElectron: true`, Thoth reached via `switchView: thoth`.
- Viewports: 1366x768 (typical desktop) and 900x700 (narrow, as requested). This is an audit selection, not a support contract. The repository documents no support policy I relied on; WCAG 2.2 AA is applied (4.5:1 text, 3:1 non-text, 24x24 target).
- No Electron, node or dev-server process of mine remains. Playwright's Chromium exits with the test run. The `chrome.exe` processes visible in the task list are the user's own browser.
- Harness limits: `memory:diagnostics` is unmocked, so the Maintenance accordion shows its loading state (a spinner inside the greyed "Run curator now"). That spinner is a harness artefact, not a defect. With no active session, "Run curator now" is also disabled when not paused (the existing "Open a session to run curator manually" hint), so the Memory "running" Maintenance capture shows a disabled button for that other reason.

## Findings by severity

### Visual breaking

None.

### Serious

#### 1. Skills switch card jumps 44 px down when toggled at 900 px (target moves out from under the pointer)

- File: `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts:143-168` (paused hint `data-testid="run-curator-paused-hint"` added inside the header's right-hand `flex items-center gap-2` group, next to the Run Curator button)
- Viewports affected: 900 (dark and light). 1366 is stable. The Memory tab is stable at both widths (no hint in its header).
- Screenshots: `08-skills-running-light-900.png` (before, card y=305) vs `10-skills-paused-light-900.png` (after, card y=349); same for dark. Measured via bounding boxes: card y 305 -> 349, stats strip 417 -> 461, view tabs 627 -> 671 (`metrics-*-900.json`, `sk_toggle_shift`).
- Problem: when Skills pauses, the "Paused — resume Skills to run" hint appears beside Run Curator. At 900 px the header row can no longer hold title block + hint + button, so the action group wraps onto its own row and pushes everything below, including the switch card, down by 44 px. Resuming moves it back up.
- Impact: the user clicks the switch, and it slides away on the next frame. A second click or a double-click lands on the card background or the stats strip. It also breaks the "pause/resume must work without issues" and "no layout shift" requirements. Keyboard users get a content jump too.
- Fix: reserve the space whatever the state. Options: (a) put the reason only in the button `title` and `aria-describedby` plus the amber card (the card already says Paused), (b) render the hint in a fixed-height row below the header in both states, or (c) allow the header to wrap in both states (`flex-wrap`, hint always rendered with `invisible` while running). Re-measure at 900 and about 700 px.

### Moderate and minor

1. **Moderate - the greyed manual action can sit far from the switch (Memory).** `memory-diagnostics-accordion.component.ts:183-210` puts "Run curator now" and its paused hint at the bottom of Maintenance, about y=1075 at 768 px high (`06b-memory-maintenance-run-button-paused-*.png`, needs scrolling; `06-...` does not show it). The amber card and Paused badge at the top make the state obvious, so this is not blocking. Consider also surfacing the hint where the button is first seen, or leave as is.
2. **Moderate - disabled action contrast is intentionally low.** Disabled "Run curator now" measured 1.73:1 dark and 1.47:1 light (`mem_hint_contrast`). WCAG 1.4.3 exempts inactive components, and the adjacent hint text passes (6.05:1 / 6.04:1), so it is acceptable. Listed because the greyed look is only just distinguishable from the card in light theme (`06b-...-light-*.png`, `14b-skills-library-enhance-paused-light-1366.png`). The button `title` carries the reason on hover only; the visible hint is the sole non-hover cue on Memory and Skills header.
3. **Moderate - "Paused" badges use very small type.** In-card badge `badge-sm` renders at 10 px (`memory-pause-switch.component.ts:55`, `skills-pause-switch.component.ts:55`); sidebar badge `badge-xs` renders at 9 px (`thoth-shell.component.ts:133`). Contrast passes, but 9 px on a 14 px-high pill is hard to read on a high-DPI desktop and at 900 px the badge sits tight to the tile label. Guidance (not an AA minimum): 11-12 px minimum.
4. **Minor - Skills "Paused" hint wraps to a lone row on the header at 900 px** even after the fix idea above is not applied; included in finding 1.
5. **Minor - the switch thumb/track in the paused state is neutral grey** (`toggle-primary` off state), while the card turns amber. Fine for state clarity (border measures 6.9:1 light, 7.9:1 dark against the card), but the toggle itself carries no amber accent. Optional polish.

No other defects found. Specifically absent: horizontal scroll (docW == winW at both widths, all states), clipping, overlapped elements, stale "Enabled" checkbox in Skills Settings (`sk_settings_enabledCheckbox: false`, `15-skills-settings-*.png`).

## Prototype fidelity

- Approved prototype: None found in the task folder for B-P (no `prototype/` consulted; the report and plan section 3.7 were the reference).
- Fidelity assessment: NOT APPLICABLE
- Before/after comparison (no prototype): the base-commit app was not captured. The feature is additive (a new card at the top of two tabs, a badge on the sidebar tile); the existing stats strip, tab chips and views were unchanged in the captures. Dark and light "after" captures for each affected screen are listed below, with no regression seen outside the new card:
  - Memory tab: `01-memory-running-{dark,light}-{1366,900}.png`, `03-memory-paused-...`
  - Skills tab: `08-skills-running-...`, `10-skills-paused-...`

## Viewport results

| Viewport            | Screen                                      | Elements checked                                                                                                                                                         | Status                           | Screenshot                                      |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------- |
| 1366x768 dark/light | Memory running                              | card at y=130, first block under header, fully visible; no scroll needed; no h-scroll                                                                                    | PASS                             | `01-memory-running-{dark,light}-1366.png`       |
| 1366x768 dark/light | Memory paused                               | amber card + Paused badge + sidebar badge; no shift (card/strip/tabs unchanged)                                                                                          | PASS                             | `03-memory-paused-{dark,light}-1366.png`        |
| 1366x768 dark/light | Memory Maintenance paused                   | Run curator now disabled, hint "Paused — resume Memory to run"                                                                                                           | PASS (button below fold, see M1) | `06-...`, `06b-...`                             |
| 1366x768 dark/light | Skills running / paused                     | switch top; Run Curator greyed with hint in header; no shift                                                                                                             | PASS                             | `08-skills-running-...`, `10-skills-paused-...` |
| 1366x768 dark/light | Skills Activity / Library / Settings paused | Analyze greyed with hint; Library amber banner and Enhance now greyed with title; no "Enabled" checkbox                                                                  | PASS                             | `13-...`, `14-...`, `14b-...`, `15-...`         |
| 900x700 dark/light  | Memory running / paused                     | card y=305 (tab strip is below the fold of the sidebar-layout, card is first block under the header); no shift; no h-scroll; switch wraps to its own row inside the card | PASS                             | `01-...-900`, `03-...-900`                      |
| 900x700 dark/light  | Skills running / paused                     | card moves 44 px on toggle                                                                                                                                               | FAIL (Serious 1)                 | `08-...-900`, `10-...-900`                      |
| 900x700 dark/light  | Maintenance, Activity, Library paused       | hints and notices present, legible                                                                                                                                       | PASS                             | `06*-900`, `13-...-900`, `14*-900`              |

At 900 px the card is the first block under the tab header but sits at y=305 (under the Thoth tile strip), still inside the 700 px viewport and visible without scrolling.

## Component and interaction results

| Component                      | States tested                                                                                                                                                 | Status                        | Screenshot                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Memory switch                  | running (On, green dot), focus via Tab (6 presses from the title), Space toggles, Saving… (150 ms), Paused, aria                                              | PASS                          | `01`, `02-memory-switch-focus-*`, `03`, `04-memory-switch-paused-closeup-*` |
| Skills switch                  | same, Tab (7 presses), Space, Saving, Paused                                                                                                                  | PASS, apart from shift at 900 | `08`, `09-skills-switch-focus-*`, `10`, `11-skills-switch-paused-closeup-*` |
| Sidebar badge                  | paused on Memory tile and Skills tile; gone after resume (`badge_after_resume: 0`)                                                                            | PASS (size: M3)               | `05-sidebar-badge-memory-paused-*`, `12-sidebar-badge-skills-paused-*`      |
| Memory Run curator now         | disabled, `title` and hint "Paused — resume Memory to run"                                                                                                    | PASS                          | `06b-*`                                                                     |
| Skills Run Curator (header)    | disabled, title and visible hint                                                                                                                              | PASS (shift at 900)           | `10-*`                                                                      |
| Skills Analyze current session | disabled, title and hint                                                                                                                                      | PASS                          | `13-skills-activity-paused-*`                                               |
| Skills Enhance now (card)      | disabled with reason title; amber banner `clones-paused-notice`; re-enabled after resume (`sk_library_running`)                                               | PASS                          | `14-*`, `14b-*`, `16-skills-library-running-*`                              |
| Skills Settings                | no Enabled checkbox                                                                                                                                           | PASS                          | `15-skills-settings-*`                                                      |
| Apply on change                | no Save button; `memory:setTriggers {triggers:{}, enabled:false}` and `skillSynthesis:updateSettings {settings:{enabled:false}}` sent on toggle, nothing else | PASS                          | metrics JSON `*_rpc_after_toggle`                                           |

Not exercised (needs a real host): a PAUSED refusal from the host rendering the paused notice, the external-change refresh on window focus, and the drawer's "Enhance now" reason text. These are covered by the P4 unit specs only.

## Design system compliance

Uses the DaisyUI tokens already in the app (`badge-warning`, `border-warning/60`, `bg-warning/10`, `toggle-primary`, `text-base-content(-muted)`); no hard-coded hex. Card geometry matches the stats-strip cards (rounded-xl border). No violations found. Note: paused card colours resolve per theme (dark bg rgb 42,29,23 over base; light 250,235,220).

## Accessibility audit

Criterion: WCAG 2.2 AA (4.5:1 normal text, 3:1 non-text, 24x24 target). Contrast computed in-page, compositing the translucent card over its ancestors.

| Pair                                                 | Dark          | Light         |
| ---------------------------------------------------- | ------------- | ------------- |
| Card label "Memory"/"Skills" (14 px) on running card | 14.53:1       | 15.27:1       |
| Card label on paused amber card                      | 13.08:1       | 14.50:1       |
| Help text (12 px, muted) running / paused card       | 5.92 / 5.33:1 | 5.79 / 5.50:1 |
| "On" state text running                              | 14.53:1       | 15.27:1       |
| "Paused" badge text on warning fill (in card, 10 px) | 6.61:1        | 5.66:1        |
| Sidebar "Paused" badge (9 px)                        | 6.61:1        | 5.66:1        |
| Hint "Paused — resume X to run" (12 px)              | 6.05:1        | 6.04:1        |
| Library paused banner text                           | 13.08:1       | 14.50:1       |
| Disabled "Run curator now" (exempt, 1.4.3 inactive)  | 1.73:1        | 1.47:1        |
| Paused toggle border vs paused card (non-text)       | 7.85:1        | 6.91:1        |

All required pairs pass AA in both themes.

- Semantics: `<input type="checkbox" role="switch">` with `aria-checked` bound to state (true running, false paused) and `aria-describedby` to the help and a live status region; `<label for>` names it "Memory"/"Skills". Confirmed in `mem_running_aria`, `mem_paused_aria`, `sk_running_aria`.
- Focus: Tab reaches the switch (6 presses from the title on Memory, 7 on Skills), `:focus-visible` matches, a 2 px solid outline with 2 px offset is drawn in `base-content` colour (about 14:1 / 15:1 against the card); see `02-memory-switch-focus-*`, `09-skills-switch-focus-*`. Space toggles it.
- Target size: label wrapper `min-h-6 min-w-6` (24x24); `toggle-sm` itself is about 32x20. Meets 2.5.8 through the wrapper. (44 px would be guidance only, not AA.)
- Pause state is conveyed by text ("Paused", "On") and not only by colour.

## Visual performance

- Layout shift on toggle: Memory 0 px at both widths; Skills 0 px at 1366, 44 px at 900 (Serious 1).
- A visible "Saving…" state appears for the write window and the switch is disabled while saving; "Checking…" state exists for the initial read. The toggle applies immediately, no Save button.
- No janky animation or delayed assets observed; horizontal scroll absent in all states.

## Screenshot index

All under `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\.ptah\specs\TASK_2026_620_a13e\screenshots\b-p\`. Suffix is `-{dark|light}-{1366|900}.png`.

| File prefix                                                                | Content                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `01-memory-running`                                                        | Memory tab running                                          |
| `02-memory-switch-focus`                                                   | Memory switch card, keyboard focus ring                     |
| `03-memory-paused`                                                         | Memory tab paused (amber card, Paused badge, sidebar badge) |
| `04-memory-switch-paused-closeup`                                          | Memory card closeup, paused                                 |
| `05-sidebar-badge-memory-paused`                                           | Thoth sidebar Memory tile, Paused badge                     |
| `06-memory-maintenance-paused`, `06b-memory-maintenance-run-button-paused` | Maintenance, greyed Run curator now + hint                  |
| `07-memory-maintenance-running`                                            | Maintenance after resume                                    |
| `08-skills-running`                                                        | Skills tab running                                          |
| `09-skills-switch-focus`                                                   | Skills card, focus ring                                     |
| `10-skills-paused`                                                         | Skills tab paused, Run Curator greyed with hint             |
| `11-skills-switch-paused-closeup`                                          | Skills card closeup, paused                                 |
| `12-sidebar-badge-skills-paused`                                           | Sidebar Skills tile, Paused badge                           |
| `13-skills-activity-paused`                                                | Activity, Analyze greyed                                    |
| `14-skills-library-paused`, `14b-skills-library-enhance-paused`            | Library banner, Enhance now greyed                          |
| `15-skills-settings`                                                       | Settings, no Enabled checkbox                               |
| `16-skills-library-running`, `17-skills-running-recommended`               | After resume                                                |
| `metrics-{theme}-{width}.json`                                             | measured contrast, bounding boxes, aria, RPC payloads       |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for what was rendered (mocked host, real bundle); MEDIUM for host-driven paths not exercised (PAUSED refusal, external change on focus).
- Key concern: at about 900 px the Skills paused hint pushes the switch card 44 px down the moment it is toggled (`skill-synthesis-tab.component.ts:143-168`). Fix that and re-measure; everything else (visibility at the top, labels, contrast, role=switch/aria-checked, focus ring, apply-on-change, greyed actions with hints) passes in both themes.

---

# Round 2

Reviewed commit `e43f7dc63` ("keep the pause switches still when toggled and make their effect visible"). The webview was rebuilt (`npx nx build ptah-extension-webview --skip-nx-cache`, succeeded) and re-rendered with the same method as round 1: the e2e harness with a stateful mocked RPC (150 ms write delay), no Electron, no real settings. The temporary spec and `test-results` are deleted. `git status` is clean apart from the untracked `screenshots/` folder; no process of mine is running.

The screenshot folder `screenshots/b-p/` now holds only the round-2 set: 84 files = 6 viewport/theme combinations (1366x768, 900x700, 700x700 x dark `anubis`, light `anubis-light`) x 13 PNG captures, plus 6 `metrics-*.json`. The round-1 files were deleted. The round-1 sections above describe superseded screenshot names.

| Prefix                                                                                     | Content                                               |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `01-memory-running`, `02-memory-switch-focus`, `03-memory-paused`, `04-memory-card-paused` | Memory tab running, focus ring, paused, card closeup  |
| `05-skills-running`, `06-skills-switch-focus`, `07-skills-paused`, `08-skills-card-paused` | Skills tab, same states                               |
| `09-sidebar-badge-memory`, `10-sidebar-badge-skills`                                       | Thoth sidebar tile, paused                            |
| `11-memory-maintenance-paused`                                                             | Greyed Run curator now plus hint                      |
| `12-skills-activity-paused`, `13-skills-library-paused`                                    | Analyze greyed; Library banner and Enhance now greyed |

Suffix: `-{dark|light}-{1366|900|700}.png`.

## Round-1 findings re-checked

| Round-1 finding                                            | Result                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serious 1: Skills card jumped 44 px at 900 px              | FIXED. Switch, card and tab-strip y deltas on pause are 0 px at 1366, 900 and 700, dark and light, for both Memory and Skills (`*_shift` in the metrics: `dy`, `dCardY`, `dCardH`, `dTabsY` all 0). Resume is also 0 px at 900 and 700. The header hint is gone (`hintEls: 0`); Run Curator keeps `title` "Paused — resume Skills to run" and `aria-describedby="skills-pause-help"`. Help text is byte-identical in both states. |
| Moderate 1: paused effect not discoverable from the switch | FIXED. The card's fixed help text now reads "Pausing stops capture, background processing and manual runs (Run curator now)…" (Memory) and "…manual runs (Run Curator, Analyze current session and Enhance now)…" (Skills). See `04-memory-card-paused-*`, `08-skills-card-paused-*`. The greyed buttons still carry the visible "Paused — resume Memory to run" hint (Maintenance) and titles.                                   |
| Moderate 3: badges too small                               | NOT FIXED in the browser (see New finding 1).                                                                                                                                                                                                                                                                                                                                                                                     |
| Moderate 2 (disabled-button contrast), minor items         | Unchanged and accepted (WCAG-exempt inactive control).                                                                                                                                                                                                                                                                                                                                                                            |

## Measurements

- Layout: no horizontal scroll in any state at any width. At 1366 the longer help text wraps the toggle onto its own row in the card (card height constant between states, so nothing moves on toggle).
- One apparent 18 px shift (Skills, 1366, resume from the Library sub-view) is the page re-clamping its scroll when the Library "paused" banner (below the switch) disappears. It is content below the switch changing, not the switch card moving; the first toggle on the Recommended view was 0 px. Not a defect.
- Contrast (AA 4.5:1 text), paused, dark / light: label 13.08 / 14.50; help text 5.33 / 5.50; in-card Paused badge 6.61 / 5.66; sidebar Paused badge 6.61 / 5.66. Running: label 14.53 / 15.27; help 5.92 / 5.79. All pass.
- Semantics and focus: `role="switch"`, `aria-checked` true running, false paused (all 6 combinations); Tab reaches Memory in 6 presses and Skills in 7 from the title; `:focus-visible` true with a 2 px solid outline; Space toggles; one `setTriggers {triggers:{}, enabled:false}` / `updateSettings {settings:{enabled:false}}` per toggle, no Save button.
- Paused effects: Memory Run curator now disabled with title and hint; Skills Run Curator disabled with title; Analyze current session disabled with title; Library "Enhance now" disabled; sidebar badge shows on the right tile and clears on resume (`badges_after_resume: 0`).

## New finding

### Moderate

#### 1. The 12 px badge fix does not take effect: Paused badges still render at 10 px

- Files: `libs/frontend/memory-curator-ui/src/lib/components/memory-pause-switch.component.ts:57` and `libs/frontend/skill-synthesis-ui/src/lib/components/skills-pause-switch.component.ts` (`badge badge-warning badge-sm text-xs`); `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:133` (same classes).
- Cause: `apps/ptah-extension-webview/src/styles.css:1737-1741` defines an unlayered `.badge { font-size: 10px; height: 16px; }` that beats the layered Tailwind `text-xs` utility.
- Evidence: computed font size is 10 px in the card and in the sidebar in all six runs (`*_paused_contrast`, `fontSize`). The sidebar badge moved from 9 px to 10 px only because `badge-xs` was dropped. Screenshots: `04-memory-card-paused-dark-1366.png`, `09-sidebar-badge-memory-dark-1366.png`.
- Impact: small status text; contrast is fine (5.66:1 minimum), and the badge is accompanied by the amber card, so this is Moderate and not blocking. 12 px is vendor guidance, not an AA minimum.
- Fix: force the size, for example `text-xs!` (Tailwind important modifier) or `style="font-size: 12px"`, and raise the badge `height` accordingly (the global rule also pins `height: 16px`); then re-measure. Alternatively accept 10 px and update the report.

## Round 2 verdict

- Counts: 0 visual-breaking, 0 serious, 1 moderate (new, badge size), plus the unchanged accepted moderate and minor items from round 1.
- Score: 9/10.
- Recommendation: APPROVE (the rubric reserves REVISE for serious findings; the serious round-1 issue is fixed and measured at 0 px at all three widths in both themes). The badge font size is worth a one-line follow-up.
- Confidence: HIGH for the rendered paths; host-driven paths (PAUSED refusal, refresh on focus) remain unexercised and are covered only by unit specs.
- Out-of-scope observation: at 700 px the Thoth tile strip scrolls horizontally and clips the first tile (`07-skills-paused-light-700.png`); this is pre-existing shell chrome, not part of B-P.
