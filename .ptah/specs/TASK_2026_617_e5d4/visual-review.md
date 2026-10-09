# Visual Review - TASK_2026_617_e5d4 (Grok row, Orchestration CLI matrix)

## Summary

| Metric            | Value                             |
| ----------------- | --------------------------------- |
| Overall score     | 8/10                              |
| Assessment        | APPROVED                          |
| Visual breaking   | 0                                 |
| Serious           | 0                                 |
| Moderate          | 2 (neither Grok-specific)         |
| Viewports tested  | 2 (1440x900, 400x800) x 2 themes  |
| Screenshots taken | 36 PNG + 8 JSON measurement files |

## Environment

- After: worktree HEAD 2290819ad, fresh `nx build ptah-extension-webview` (production), served by the harness fixture server (`startFixtureServer({appBuild:true})`), host `vscode`, themes `anubis` (dark) and `anubis-light`. The harness's own `bootSettings` fixtures are used, so `detectedClis` includes grok 1.0.46 and the model list includes `grok-4.7`.
- Before: temporary worktree of origin/main (7910f34cf; grok count in cli-matrix-rows.ts = 0), built the same way, same specs. Note origin/main is newer than the task's merge base, so the before-shots could differ in non-Grok ways; none were seen. Temp worktree removed.
- Capture scripts lived in the OS temp dir (`review617/`), not in the repo. No source edits, no git writes.
- Viewports are an audit selection (1440 wide, 400 narrow), not a support contract.

## Findings by severity

### Visual breaking

None.

### Serious

None.

### Moderate and minor

1. Moderate, pre-existing, not Grok: at 400px the matrix table scrolls horizontally inside its container and the Effort and Permissions columns (and thus the Grok "Auto-approve" badge) are off-screen until scrolled. Page itself does not overflow (document scrollWidth 400 = viewport 400, both themes). Grok row is 630px wide, the same mechanism as every other row. Screenshots: `after-anubis-narrow-viewport.png`, `after-anubis-light-narrow-viewport.png`. The settings tab bar also wraps/overlaps ("Agent Orchestration" over the slider) at 400px in both before and after (`before-anubis-narrow-viewport.png`), so unrelated to this change.
2. Moderate, shared, unverified as a defect: pressing Escape with the model popover open left it open and focus on the search field (`provider-model-picker-search`), identically for Codex and Grok. This may be the combobox clearing/blurring first, or a harness artifact of a synthetic key press; it is not introduced by Grok (`cli-orchestration-matrix.component.ts` popover is shared). A backdrop click or the Close button remains available.
3. Minor: the "Auto-approve" badge is 9px text on a 10%-tinted warning background, same as Codex "Full auto" and Antigravity (identical markup, `cli-orchestration-matrix.component.ts:~528-535`). Dark-theme badge border (warning at 40% alpha) is faint on the dark card. Consistent with existing rows, so not filed against Grok.
4. Minor: Grok model cell shows monospace "provider default" and Effort shows "n/a", matching the OpenCode/Antigravity pattern (`cli-matrix-rows.ts:187-190`, effort null). No layout shift: Grok row height 30.5px at 1440, 42.5px at 400, matching peers.

## Prototype fidelity

- Approved prototype: None for this task (row addition to an existing surface).
- Fidelity assessment: NOT APPLICABLE.
- Before/after comparison:
  - Dark wide: `before-anubis-wide-matrix.png` vs `after-anubis-wide-matrix.png`. Only change is the new Grok row appended after OpenCode, above the "Uninstalled CLI agents" footer. No regressions.
  - Light wide: `before-anubis-light-wide-matrix.png` vs `after-anubis-light-wide-matrix.png`. Same result.
  - Dark narrow: `before-anubis-narrow-matrix.png` vs `after-anubis-narrow-matrix.png`. Same, plus one row.
  - Light narrow: `before-anubis-light-narrow-matrix.png` vs `after-anubis-light-narrow-matrix.png`. Same.

## Viewport results

| Screen     | Checked                   | Status                           | Screenshot                                     |
| ---------- | ------------------------- | -------------------------------- | ---------------------------------------------- |
| 1440 dark  | matrix, Grok row, popover | Pass                             | after-anubis-wide-matrix/-grokrow/-popover.png |
| 1440 light | same                      | Pass                             | after-anubis-light-wide-*                      |
| 400 dark   | matrix, overflow, popover | Pass (inner h-scroll, finding 1) | after-anubis-narrow-*                          |
| 400 light  | same                      | Pass (inner h-scroll)            | after-anubis-light-narrow-*                    |

Popover at 400px: 272x135 at x=36.9, fully inside the viewport (right edge 309 of 400).

## Component and interaction results

| Component        | States tested                                                                | Status | Screenshot                 |
| ---------------- | ---------------------------------------------------------------------------- | ------ | -------------------------- |
| Grok row         | default, enabled                                                             | Pass   | *-grokrow.png              |
| Model popover    | open; list = "Provider default" + `grok-4.7`; title "Model for Grok"         | Pass   | *-popover.png              |
| Permission badge | "Auto-approve", warning tone, with (i) info button `Grok permission details` | Pass   | *-grokrow.png              |
| Focus walk       | toggle, model cell, popover Close/search, permission info                    | Pass   | *-focus1.png, *-focus3.png |

Selecting grok-4.7 was not driven end to end (the Escape issue in finding 2 stalled the follow-up script); the option renders and is listed.

## Design system compliance

Grok badge uses the same classes and warning tone as Codex "Full auto": measured text color `oklch(0.925 ...)` (dark) / `oklch(0.236 ...)` (light), font 9px, identical across the three badges. No new tokens or hex values introduced.

## Accessibility audit

- Contrast (light): badge text vs. composited background 6.4:1 raw measure (computed against the un-composited tint; real value is higher). Pass AA 4.5:1. Dark: text is the near-white base-content on a 10% orange tint of the dark card; my raw measure (2.25) was against the semi-transparent tint alone and is not valid, so treat dark as visually legible (see `after-anubis-grokrow.png`) but not numerically verified. Same treatment as Codex.
- Targets (WCAG 2.2 AA 24x24 criterion): toggle 18x18, model cell 137x16, info button 20x20. These are below 24px but identical to every other row in the matrix (pre-existing, not Grok-specific; the 24px criterion has a spacing exception that may apply).
- Focus: every Grok control shows a solid 2px outline in base-content colour (visible in both themes). Tab order in-row: toggle, model cell, permission info. The model cell and info button have accessible names ("Grok model: provider default. Change", "Grok permission details").
- Semantics: row testid `cli-matrix-row-grok`, label "Grok", toggle `Grok enabled`.

## Visual performance

No layout movement observed between settle and capture (row boxes stable; page height consistent). No loading skeleton was captured because the fixture responds instantly.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH (dark badge contrast and Escape behaviour not numerically/functionally confirmed)
- Key concern: none for this change; the narrow-width hidden Permissions column (finding 1) is a pre-existing matrix limitation that now also hides Grok's Auto-approve warning on small webviews.

## Screenshot index (`visual/`)

- Full matrix: `{before,after}-{anubis,anubis-light}-{wide,narrow}-matrix.png`
- Full page viewport: `{before,after}-{anubis,anubis-light}-{wide,narrow}-viewport.png`
- Grok row close-up: `after-{anubis,anubis-light}-{wide,narrow}-grokrow.png`
- Popover (grok-4.7 listed): `after-{anubis,anubis-light}-{wide,narrow}-popover.png`
- Focus: `after-*-focus1.png` (model cell), `after-*-focus3.png`
- Measurements: `*.json`
