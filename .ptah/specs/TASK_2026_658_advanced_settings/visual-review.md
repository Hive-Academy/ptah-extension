# Visual Review - TASK_2026_658_advanced_settings

## Summary

| Metric            | Value                                                             |
| ----------------- | ----------------------------------------------------------------- |
| Verdict           | NEEDS_FIX (PASS on layout, focus, contrast; one Serious issue)    |
| Overall score     | 7/10                                                              |
| Assessment        | NEEDS_REVISION                                                    |
| Visual breaking   | 0                                                                 |
| Serious           | 1                                                                 |
| Moderate          | 3                                                                 |
| Minor             | 3                                                                 |
| Viewports tested  | 2 widths (360, 1000) x 2 themes (dark `anubis`, light `anubis-light`), host `vscode` |
| Screenshots taken | 40 PNG (8 before, 32 after)                                       |
| Components tested | `ptah-advanced-settings-group` (6 groups), Fine-tuning `<details>`, Orchestration deferred block |

Score separation: no overflow, no clipping, contrast and focus rings all pass, and the new groups match the existing Session budget and Lane guards cards. It does not reach 8 because the client validation error is nearly invisible in the light theme and is not styled as an error in either theme.

## Environment

- Rendering path: Playwright (chromium, headless) driving the `webview-e2e-harness` helpers (`bootSettings`, `installHost('vscode')`, `installRpcAutoResponder`, theme set through `localStorage ptah-theme`). The scratch specs are `_capture/capture.spec.ts` and `_capture/focus.spec.ts` in this task folder. Nothing was added to the repo.
- The plan note that fixtures answer `settings:get` for any key is only half true. `settingsGetResolver` (`settings.fixtures.ts:244`) returns the `ptahCliAgents` object for any key it does not know, so the new groups would not get numeric values. The scratch spec overrides `settings:get` (default value per key, taken from `ADVANCED_SETTINGS`) and `settings:set` (success) through the `overrides` argument of `bootSettings`. No source change was needed.
- BEFORE: the existing build in `D:\projects\ptah-extension\dist\apps\ptah-extension-webview\browser` (built from `main`) was served with the harness `startFixtureServer`. `advanced-setting-*` test ids: 0 on both tabs, `fine-tuning-details`: 0 (`_capture/metrics-before.json`).
- AFTER: `npx nx serve ptah-extension-webview --parallel=1 --port=4377 --prebundle=false` run in the worktree (commit 4d8959dc2). No `nx build`, no e2e suite, no run-many. One server at a time; stopped after each capture (verified no listener on 4377).
- Deviations the reviewer had to make, with effect:
  - The dev server could not resolve the optional package `marked-katex-extension` (not installed; the production build tolerates it). I put a 2-line stub in the git-ignored `.angular/node_modules/` of the worktree and removed it afterwards. It only affects katex rendering in chat markdown, not Settings.
  - The dev server runs with HMR, which loads every `@defer` block eagerly (Angular NG0751). So the "defer on viewport" timing (placeholder footprint, layout shift) was NOT measured. Only the final rendered state is reviewed.
  - Narrow after-screenshots of full tabs are cut at the 3600 px viewport (the Settings page scrolls inside a fixed-height shell), so the last new group of the Orchestration tab at 360 px is shown through the section crops (`after-validation-error-*-360.png`).
- Viewports are an audit selection, not a support contract (no documented policy was found for the settings webview): 360 px approximates a narrow VS Code sidebar, 1000 px a wide editor-area webview.
- Theme tokens come from daisyUI `anubis` / `anubis-light`; the accessibility standard is WCAG 2.2 AA (none declared by the repo): 4.5:1 text, 3:1 components and focus, 24x24 target (SC 2.5.8).

## Screenshots

All paths are under `D:\projects\ptah-extension\.ptah\specs\TASK_2026_658_advanced_settings\screenshots\`.

| File | Theme | Width | State |
| --- | --- | --- | --- |
| before-orchestration-dark-1000.png | dark | 1000 | BEFORE Orchestration tab (main) |
| before-orchestration-dark-360.png | dark | 360 | BEFORE Orchestration tab |
| before-orchestration-light-1000.png | light | 1000 | BEFORE Orchestration tab |
| before-orchestration-light-360.png | light | 360 | BEFORE Orchestration tab |
| before-advanced-dark-1000.png | dark | 1000 | BEFORE Advanced tab |
| before-advanced-dark-360.png | dark | 360 | BEFORE Advanced tab |
| before-advanced-light-1000.png | light | 1000 | BEFORE Advanced tab |
| before-advanced-light-360.png | light | 360 | BEFORE Advanced tab |
| after-orchestration-dark-1000.png | dark | 1000 | AFTER Orchestration with Context budgets, Codex agents, Background query limits |
| after-orchestration-dark-360.png | dark | 360 | AFTER (cut at 3600 px, see Environment) |
| after-orchestration-light-1000.png | light | 1000 | AFTER |
| after-orchestration-light-360.png | light | 360 | AFTER (cut at 3600 px) |
| after-orchestration-focus-{dark,light}-{360,1000}.png | both | 360, 1000 | keyboard focus ring on `advanced-setting-compaction.toolOutputBudgetTokens` (4 files) |
| after-validation-error-{dark,light}-{360,1000}.png | both | 360, 1000 | `0` typed in `advanced-setting-internalQuery.maxConcurrent` (min 1), blurred (4 files) |
| after-advanced-closed-{dark,light}-{360,1000}.png | both | 360, 1000 | Advanced tab, Fine-tuning closed (4 files) |
| after-advanced-open-{dark,light}-{360,1000}.png | both | 360, 1000 | Fine-tuning open, 4 groups loaded (4 files; 360 cut at 3600 px) |
| after-restart-note-{dark,light}-{360,1000}.png | both | 360, 1000 | Scheduled jobs group with the "Restart" badge and "Restart Ptah to apply." (4 files) |
| after-fine-tuning-summary-focus-{dark,light}-360.png | both | 360 | `fine-tuning-summary` reached by Tab, focus-visible ring (2 files) |
| after-toggle-focus-{dark,light}-360.png | both | 360 | Enter opens Fine-tuning, Tab moves to the first toggle (2 files) |

Raw measurements: `_capture/metrics-before.json`, `_capture/metrics-after.json`, `_capture/metrics-focus-after.json`.

## Findings

### Serious

#### 1. Client validation error is not styled as an error and the error border is not visible in the light theme

- Element: `advanced-setting-internalQuery.maxConcurrent` and its `advanced-setting-internalQuery.maxConcurrent-error` (affects every number field in all 6 groups).
- Source: `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts` lines 215-222 (the error `<p>` has no class) and the `input-error` class on the input (line ~186).
- Screenshots: `after-validation-error-light-360.png`, `after-validation-error-light-1000.png`, `after-validation-error-dark-360.png`.
- Problem: after typing `0` and blurring, the message "Use a whole number from 1 to 16 queries." renders in plain body text colour (computed fg 232,230,225 dark / 41,19,52 light), 12 px, no icon, no weight change, and it sits between the help text and the next field. In the dark theme the input gets a thin red border. In the light theme the input shows no visible red border at all, so the only cue is the unstyled sentence below the field. The message text is readable (14.0:1 dark, 14.4:1 light), so this is not a contrast failure, but the invalid state is easy to miss in a long form.
- Impact: a user who types an out-of-range value in the light theme can scroll past it without noticing the field was rejected (nothing is saved, no toast). The error is also not announced: it has no `role="alert"`, and the group `role="status"` line stays empty for a client-side error (it only reports failed writes).
- Fix: give the error `<p>` an error colour class (for example `text-error`, check the 4.5:1 contrast of `text-error` on both surfaces) plus `role="alert"` or write the message into the `role="status"` line; make the `input-error` border visible in the light theme (the daisyUI `--color-error` border is not rendering; check that `input-bordered` is not overriding the border colour).

### Moderate

#### 2. Restart badge is 9 px

- Element: the `Restart` badge in `advanced-setting-cron.maxConcurrentJobs-field`, `advanced-setting-cron.catchupWindowMs-field`, `advanced-setting-skillSynthesis.triggers.bootScanDelayMs-field`; source line 142 and 172 (`badge-xs`).
- Screenshots: `after-restart-note-light-360.png`, `after-restart-note-dark-1000.png`.
- Problem: computed font size is 9 px (weight 500). Contrast is fine (12.6:1 dark, 13.1:1 light). The badge is `aria-hidden`, which is acceptable because the help text ends with "Restart Ptah to apply.", which was verified in the screenshots.
- Fix: use `badge-sm` (or `text-[11px]`, the help text size) so the badge is not the smallest text on the screen.

#### 3. Static "Enabled" next to every toggle

- Element: `advanced-setting-agentOrchestration.codexWebSearch`, `advanced-setting-memory.symbolInjectionEnabled`, `advanced-setting-harness.manageGitignore`; source line ~163 (`<span>Enabled</span>`).
- Problem: the text reads "Enabled" whether the toggle is on or off (the `off` state was not rendered because every fixture default is true; this comes from the template, not a screenshot). It matches the existing Session budget toggle ("Enabled" in `before-orchestration-dark-1000.png`), so it is a pattern issue rather than a regression.
- Fix: bind the text to the value (`Enabled` / `Disabled`) or drop it and rely on the label.

#### 4. Nested card-in-card and empty status row waste space inside Fine-tuning

- Element: `fine-tuning-details` containing four `settings-section-*` cards, plus the empty `advanced-group-*-status` row (`min-h-4`).
- Screenshots: `after-advanced-open-dark-1000.png`, `after-advanced-open-light-360.png`.
- Problem: each group is a bordered card inside the bordered Fine-tuning card, which costs about 46 px of horizontal space at 360 px (inputs end up about 270 px wide), and each card ends with an empty strip below the last help text. No overflow or clipping results.
- Fix: drop the outer surface padding or render the inner groups without their own border when nested; keep the status row but remove its height when empty.

### Minor

- Large numbers in the inputs have no thousands separator (`3000000`, `86400000`), although the help text shows `3,000,000`. The existing Session budget has the same style but adds a "50M tokens" hint line. Screenshots: `after-orchestration-dark-1000.png`.
- Success feedback reads "Saved Keep processed records for." (label used as a noun phrase) in the `role="status"` line; the grammar is awkward for labels that are not nouns (`_capture/metrics-after.json`, `adv-*-saveStatus`).
- The chevron of `fine-tuning-summary` is `text-info` and decorative; it is faint against the light surface (`after-advanced-closed-light-1000.png`). The text next to it carries the meaning.

## Prototype fidelity

- Approved prototype: no `prototype/` folder exists in the task folder (checked); the plan (Components 5-6) is the only visual reference.
- Fidelity assessment: NOT APPLICABLE.
- Before/after comparison (no prototype), one entry per theme and width:
  - Dark 1000: `before-orchestration-dark-1000.png` vs `after-orchestration-dark-1000.png`: the matrix, roles, TTL, Session budget and Lane guards are unchanged; three new cards follow Lane guards. No regression. `before-advanced-dark-1000.png` vs `after-advanced-closed-dark-1000.png`: the only difference is the new closed Fine-tuning card at the end. No regression.
  - Dark 360: `before-orchestration-dark-360.png` vs `after-orchestration-dark-360.png`; `before-advanced-dark-360.png` vs `after-advanced-closed-dark-360.png`: same result.
  - Light 1000: `before-orchestration-light-1000.png` vs `after-orchestration-light-1000.png`; `before-advanced-light-1000.png` vs `after-advanced-closed-light-1000.png`: same result.
  - Light 360: `before-orchestration-light-360.png` vs `after-orchestration-light-360.png`; `before-advanced-light-360.png` vs `after-advanced-closed-light-360.png`: same result.
- Pre-existing defects seen in BEFORE as well (not caused by this change): at 360 px the "Order:" row overlaps the "Re-detect CLIs" button in the Orchestration matrix header (`before-orchestration-light-360.png`), and the MCP port hint text is clipped at 360 px (`before-advanced-light-360.png`). The layout probe reports the policy-order chips overflow their bar at 360 px in both builds (`orch-*-360-layout`).

## Viewport results

| Screen | Width | Checked | Status | Screenshot |
| --- | --- | --- | --- | --- |
| Orchestration, new groups | 1000 | 3-column grid, no clipping, document overflow 0 | PASS | after-orchestration-{dark,light}-1000.png |
| Orchestration, new groups | 360 | single column, document overflow 0, no overflow in the 3 new sections | PASS | after-validation-error-*-360.png, after-orchestration-focus-*-360.png |
| Advanced, Fine-tuning closed | 1000, 360 | one extra card at the end, nothing else moved | PASS | after-advanced-closed-*.png |
| Advanced, Fine-tuning open | 1000 | 3-column groups, document overflow 0, no clipped text | PASS | after-advanced-open-*-1000.png |
| Advanced, Fine-tuning open | 360 | single column, nested cards, no overflow, no clipped text | PASS (see Moderate 4) | after-advanced-open-*-360.png |

## Component and interaction results

| Component | States tested | Status | Screenshot |
| --- | --- | --- | --- |
| Number field | default, focus (keyboard), error, typed save (`9` into `memory.retention.processedDays`, status "Saved ...") | error state fails visibility in light theme (Serious 1) | after-orchestration-focus-*, after-validation-error-* |
| Boolean toggle | default (on), keyboard focus | PASS (off state not rendered) | after-toggle-focus-*-360.png |
| Restart badge and note | default | PASS with 9 px caveat (Moderate 2) | after-restart-note-* |
| Fine-tuning `<details>` | closed, open by Enter, keyboard focus on summary | PASS | after-fine-tuning-summary-focus-*, after-advanced-open-* |
| Load error, loading, retry states | not rendered (needs failing RPC fixtures) | NOT TESTED | - |

## Design system compliance

- The new groups reuse the `ptah-surface-section` card, `input input-bordered input-sm`, `toggle toggle-sm toggle-primary` and the 11 px muted help text of the Session budget card; spacing and type scale match (`after-orchestration-dark-1000.png`).
- Deviation: the `badge-xs` Restart badge (9 px) is smaller than any other text on the screen.
- Deviation: error `<p>` has no token-based colour (expected `text-error` / `input-error` visible border; observed body text colour).

## Accessibility audit

- Contrast (measured by compositing real computed colours, `_capture/metrics-after.json`): lowest text pair in the new groups is the muted help text, 5.65:1 dark and 5.39:1 light (11-12 px), all above 4.5:1. Group titles 14.0:1 / 14.4:1. Restart badge 12.6:1 / 13.1:1. Error text 14.0:1 / 14.4:1.
- Focus: number fields, toggles and the Fine-tuning summary show a 2 px solid outline, 2 px offset, `base-content` colour (dark `oklch(0.925 ...)`, light `oklch(0.236 ...)`), `:focus-visible` true when reached by Tab. The summary is reachable by Tab and the first Tab after opening it lands on `advanced-setting-memory.symbolInjectionEnabled`.
- Labels: number inputs have `<label for>`, toggles have `aria-label`; both carry `aria-describedby` (help, error, stored notice) and `aria-invalid` when in error. The visible "Restart" badge is `aria-hidden`, the help text says "Restart Ptah to apply."
- Target size: the toggle input is 32x20 (below 24 px high) but sits inside a full-width label 32 px tall, so the clickable target is 32 px high; number inputs are 32 px high. No target below 24x24 that is not inside a larger label.
- Announcements: validation error is not announced (Serious 1). Save results are announced through the `role="status"` line.

## Visual performance

- Not measured for deferral: the dev server forces eager `@defer` (see Environment). In the final state no layout shift was seen between placeholder and groups at the sampled moments, but this is not evidence for the production build.
- No animation other than the chevron rotation.

## Verdict

- Recommendation: REVISE (NEEDS_FIX)
- Confidence: MEDIUM-HIGH for layout, contrast and focus (measured on rendered pages in both themes and both widths); MEDIUM for the deferred loading behaviour (not exercised).
- Key concern: Serious 1, the invalid-value state of every number field is almost invisible in the light theme and is not announced.
