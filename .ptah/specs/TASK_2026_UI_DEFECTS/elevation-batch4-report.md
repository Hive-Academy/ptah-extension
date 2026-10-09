# Elevation Batch 4 — Dashboard, analytics, Thoth

## Delivered

Dashboard and the Thoth Memory and Skills shells now follow the shared ladder: page `bg-surface-0`, sections `surface-1` (`rounded-xl p-5 gap-5` where the section is a titled block), detail and stat cards `surface-2` (`rounded-xl p-4`), hovered rows `hover:bg-surface-3`, and the active Thoth tab, selected timeline row, and floating session/skill dialogs `surface-3`. Status and tier colours stay status colours.

`ptah-stat-card` was not used. The KPI tiles carry tier or status colour, icons, meters, or a lower-bound marker, and the primitive's label/value slot would drop that content. Shells use the `surface-*` classes directly, the same way Marketplace did.

## Before → after

| Element                                                                 | Before                                                            | After                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard page                                                          | `bg-base-100`                                                     | `bg-surface-0` (`dashboard-grid.component.html:1`)                                                                                                                                                                                                                     |
| Tribunal launcher                                                       | `border-base-300 bg-base-200/60`, hover `bg-base-200`             | `surface-2 rounded-xl p-4`, hover `bg-surface-3` (`dashboard-grid.component.html:20`)                                                                                                                                                                                  |
| Session analytics section                                               | Daisy `card bg-base-200/40`                                       | `surface-1 rounded-xl p-5 gap-5` plus a one-line description (`analytics-card.component.html:2`)                                                                                                                                                                       |
| Provider account card                                                   | `border bg-base-100 p-3 shadow-sm`                                | `surface-2 rounded-xl p-4`; empty state `surface-2 rounded-lg p-3`; meter track `bg-surface-0` (`provider-account-card.component.ts:155`, `:325`, `:233`). Host is a column with `gap: 0.75rem` so the refresh notice stays the previous sibling of the first section. |
| Aggregate metric tiles                                                  | `bg-base-200/50` plus a category border                           | `bg-surface-2 rounded-lg p-3` with the same `border-success/20`, `border-warning/20`, `border-info/20`, cyan, and purple borders (`metrics-cards.component.ts:37`)                                                                                                     |
| Session stat card                                                       | `bg-base-200/50 border-base-300`                                  | `surface-2 rounded-xl p-4`, hover `bg-surface-3` (`session-stats-card.component.html:9`). Inner cost/message tiles keep semantic borders on `bg-surface-0`.                                                                                                            |
| Session detail dialog                                                   | `modal-box` plus `border-base-content/10`                         | `modal-box surface-3` (`session-detail-modal.component.html:4`)                                                                                                                                                                                                        |
| Harness card                                                            | `card bg-base-200/40 border-warning/30 shadow-sm`                 | `surface-2 rounded-xl p-4` plus `ring-warning/40`. Warning icon tile unchanged (`harness-card.component.ts:99`)                                                                                                                                                        |
| Skill-selection card                                                    | Daisy `card bg-base-200/40`                                       | `surface-2 rounded-xl p-4`; dialog `modal-box surface-3` (`skill-selection-card.component.ts:82`, `:136`)                                                                                                                                                              |
| Builders card                                                           | Daisy `card bg-base-200/40`                                       | `surface-2 rounded-xl p-4` (`builders-card.component.html:3`)                                                                                                                                                                                                          |
| Thoth page / rail / active tab                                          | `bg-base-100`, rail `bg-base-200/40`, active tab `bg-base-300/50` | page `bg-surface-0`, rail `surface-1`, active tab `surface-3`, inactive hover `bg-surface-2` (`thoth-shell.component.ts:61`, `:63`, `:102`)                                                                                                                            |
| Memory and Skills tab sections                                          | bare `space-y-6` stacks                                           | `surface-1 rounded-xl p-5 gap-5`; icon wells `bg-surface-0` (`memory-curator-tab.component.ts:98`, `skill-synthesis-tab.component.ts:111`)                                                                                                                             |
| Memory and Skills stat strips                                           | Daisy `stats bg-base-200/40 shadow-sm`                            | `surface-2 rounded-xl`. Stat figures keep primary/info/success/error/secondary colour (`memory-stats-strip.component.ts:30`, `skill-stats-strip.component.ts:24`)                                                                                                      |
| Memory lists, suggestions, diagnostics shells                           | `rounded-xl border-base-300 bg-base-200/40`                       | `surface-2 rounded-xl`; row hover `hover:bg-surface-3`; selected timeline row `surface-3` (`corpus-list.component.ts:137`, `timeline-view.component.ts:85`)                                                                                                            |
| Skills pipeline, digest, activity, triggers, suggestions, orchestration | same Daisy card shell                                             | `surface-2 rounded-xl`. Pipeline and histogram tracks use `bg-surface-0` (`skill-pipeline-status.component.ts:129`, `eligibility-histogram.component.ts:32`)                                                                                                           |

List shells do not add section `p-5`. Row padding and dividers stay edge to edge inside `surface-2`.

## Test ids

- `analytics-section-session` — `analytics-card.component.html:4`
- `analytics-section-provider-accounts` — `analytics-card.component.html:78` (rendered once sessions are shown)
- `analytics-section-builders` — `builders-card.component.html:5`
- `thoth-section-nav`, `thoth-section-panel` — `thoth-shell.component.ts:64`, `:175`
- `thoth-section-memory` — `memory-curator-tab.component.ts:99`
- `thoth-section-memory-entries` — `memory-entry-list.component.ts:24`
- `thoth-section-memory-timeline` — `timeline-view.component.ts:58`
- `thoth-section-memory-diagnostics` — `memory-diagnostics-accordion.component.ts:35`
- `thoth-section-skills` — `skill-synthesis-tab.component.ts:112`
- `thoth-section-skills-pipeline` — `skill-pipeline-status.component.ts:130` (replaces `skills-pipeline-status`; the tab spec queries the new id)
- `thoth-section-skills-orchestration` — `skill-synthesis-tab.component.ts:499`

## Specs

Updated assertions, intent unchanged:

- `analytics-card.component.spec.ts` — section is `surface-1`; provider-accounts id exists after the first page renders
- `provider-account-card.component.spec.ts` — section is `surface-2`; 94% bar stays `bg-warning`
- `metrics-cards.component.spec.ts` — cost tile keeps `border-success` and `bg-surface-2`
- `harness-card.spec.ts` — card is `surface-2` and `ring-warning`
- `thoth-shell.component.spec.ts` — page `bg-surface-0`, nav `surface-1`, active tab `surface-3`
- `skill-synthesis-tab.component.spec.ts` — pipeline strip id is `thoth-section-skills-pipeline`

## Results

- Dashboard Jest (8 suites): **88 passed**.
- `@ptah-extension/thoth-shell` Jest: **7 passed**.
- `@ptah-extension/memory-curator-ui` Jest (8 changed component suites): **97 passed**.
- `@ptah-extension/skill-synthesis-ui` Jest (8 changed component suites): **128 passed**.
- `npx nx typecheck` `--parallel=1` for `@ptah-extension/dashboard`, `@ptah-extension/thoth-shell`, `@ptah-extension/memory-curator-ui`, and `@ptah-extension/skill-synthesis-ui`: **all passed**. Nx Cloud reported its existing disabled-org notice only.

## Not done

- Schedules (`cron-scheduler-ui`) and Messaging (`messaging-gateway-ui`) shells. Those belong to batch 7.
- Skill clone cards, drawers, and settings form controls. Only section and card shells were changed.
- Memory danger-zone and warning, error, info, and success banners. Those borders are status, not elevation.
- The memory trigger-toggle row. It is a form control.
- No Electron or browser pass. This lane does not build or serve.
- `ptah_agent_report` is not available in this session (no MCP tool by that name).
