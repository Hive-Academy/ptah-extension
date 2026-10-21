# Batch B1: dashboard limits grid and harness placement

## Preserve list

| Old element | Result and evidence |
| --- | --- |
| Dashboard Tribunal route card | Removed from `dashboard-grid.component.html`; Tribunal remains in Electron and webview navigation. Showcase beat 4 points to Electron Tribunal tab. |
| Dashboard Command Center route card | Removed from grid; Electron Voice tab remains. Setup hub and chat input controls were not changed. |
| Dashboard “Your harness is short” card | Moved to Skills & Plugins harness badge popover; the old dashboard component and spec were deleted. The badge uses the existing shared blocked set and repair dialog. |
| Skill selection card | Stays after provider limits in `dashboard-grid.component.html`. |
| Provider section refresh | Stays on each owner cell, plus the empty-state Refresh button in `provider-account-card.component.ts`. |
| Selected provider first | Existing owner ordering remains in `provider-account-card.component.ts`; its spec still exercises reorder. |
| Tile border and section surfaces | Retained `surface-1`, tile `border-base-content/10`, and theme-token bar colors. |
| 90% near-limit tick | Retained on each mini bar; section heading tooltip names the threshold. |
| PlanLimitWindow used, resetsAt, label, status contract | Read by `buildPlanTile` without contract changes; `formatUsed` and `formatToolResetText` are reused. |
| In-house SVG charts, daily bars, Cost/Tokens toggle, Provider/Model donut, range 7d/30d/90d, spend RPC | Stay in the untouched usage components. |
| Honest usage gaps, provider marks/names, breakdown, session/message/subagent counts, top-five sessions, provenance tiles and cost footnote | Stay in the untouched usage components; provider marks also remain in compact owner cells. |
| One blocked-set derivation and one repair dialog | Badge still calls `harnessBlockedPaths` and mounts the existing `HarnessRepairDialogComponent`. |
| Builders card | Stays after analytics in the grid. |

## Changes

- `libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.component.html:18` and `.ts:10`: removed the two route buttons, dashboard harness mount, navigation handlers, and unused host injection. `dashboard-grid.layout.spec.ts` now checks section order and absence of those controls. `src/index.ts` no longer exports the deleted harness card.
- `libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.ts:58`: content-width container grid with 4/3/2/1 columns; removed intro sentence and equal-height implicit rows. Heading tooltip keeps the 90% meaning.
- `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:279`: added primary value/tone, up to three labeled window meters, short reset, and a full accessible label. `provider-account-tile.component.html:13` renders these as a compact numbers-first cell; the TypeScript style now drops old badge/icon helpers. Specs updated.
- `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:193`: blocked-only “Move these aside…” action beside “Reconcile now”; opens the existing repair dialog with `blocked()`. Shared blocked-path text names those controls. Badge spec covers the action.
- `libs/shared/src/lib/types/harness-blocked-wording.ts:105` and `libs/backend/harness-sync/src/lib/reconciler/harness-reconciler.service.ts:955`: warnings point to the Skills & Plugins badge. Backend assertion and comments updated.
- `apps/ptah-electron-e2e/src/showcase/dashboard-tour.scene.ts:104`: beat 4 targets the Tribunal nav tab. `scripts/dashboard-tour.json` retains the same seven lines, so `director.say(0..6)` indices still align.

## Deleted files

- `libs/frontend/dashboard/src/lib/components/harness-card/harness-card.component.ts`
- `libs/frontend/dashboard/src/lib/components/harness-card/harness-card.spec.ts`

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/dashboard-grid/dashboard-grid.layout.spec.ts libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts libs/frontend/dashboard/src/lib/components/provider-account-card/provider-account-card.component.spec.ts libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts --coverage=false --maxWorkers=1`: first run 59 passed, 5 failed on old markup expectations; second run 63 passed, 1 failed on `resets 3h` versus actual `resets 3h 0m`. The assertion was corrected. The three-run cap prevented another dashboard run.
- `npx jest -c libs/frontend/marketplace/jest.config.ts libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts --coverage=false --maxWorkers=1`: 25 passed.
- Scoped `ptah_get_diagnostics`: one completed check found no errors in requested production files; it found pre-existing sibling errors and two invalid keys in the new tile spec. The keys were corrected. A later check timed out while type checking; no final clean diagnostic result is claimed.

## Proposed Removals

- The now-unused public `dashboard-card` entry in `harness-blocked-wording.ts` and its tests could be removed after callers confirm no external dependency. Its user-facing prose has been updated, so it no longer points to the removed card.

## Decisions

- **Grid breakpoints:** chose CSS container queries (other option: viewport media queries). The requirement is based on available content width; `provider-account-card.component.ts` owns the container. Reversible CSS choice.
- **Windowless owner:** chose the existing status sentence and action in one small cell (other option: an empty meter). `statusPill` and `tileAction` already encode the cause and navigation. Reversible presentation choice.
- **Showcase beat:** chose the Tribunal nav tab (other option: drop beat 4). The tab is present in Electron and keeps the voiceover index stable without a dashboard button. Reversible selector choice.

## Not done

- No new Electron visual capture or e2e run; prohibited by the task verification limits.
- Shared and backend wording specs were not run after updates because the three Jest runs were used. The final dashboard assertion fix also remains unrerun.
- Stale `HarnessCardComponent` references in `skill-selection-card` comments are outside this batch's owned paths and were left for the owning lane.
