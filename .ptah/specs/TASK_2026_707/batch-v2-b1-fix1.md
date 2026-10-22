# Batch B1 review fixes, round 1

| Defect | Fix and location | Evidence |
| --- | --- | --- |
| 2 | The compact reset now derives its relative text from `formatToolResetText`, including exhaustion-only resets: `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:985`. | `plan-tile-view.model.spec.ts:86` covers an at-limit window whose reset exists only on `exhaustion`. |
| 3 | Retargeted the removed dashboard action to the Electron Tribunal tab in `apps/ptah-docs/src/content/docs/tribunal/{relay.md:37,crucible.md:81,race.md:55,forge.md:50,council.md:94,index.mdx:74}`. | Text search across `apps/ptah-docs/src/content/docs` found no remaining instruction to use the removed dashboard action. The index page was an additional hit. |
| 4 | `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts:965,1003` retains windows after the third meter as `+N more` tooltip notes with their usage, reset, and facts. | `plan-tile-view.model.spec.ts:96` covers five windows. |
| 5 | `libs/shared/src/lib/types/harness-blocked-wording.ts:107` registers the actual popover clause under `marketplace-popover` and removes the unused `dashboard-card` surface. `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts:18,29` reads that registry entry. | `harness-health-badge.component.spec.ts:193` checks the rendered clause; `harness-blocked-wording.spec.ts` checks the shared allowlist. Search found no remaining `dashboard-card` wording usage in these files. |
| 6 | `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.ts:102` collects status, cooldown, and evidence details for the title and accessible label. `provider-account-tile.component.html:40` shows the first detail in a compact muted line with the full set in its tooltip. | `provider-account-tile.component.spec.ts:51` covers visible cooldown and accessible evidence while meters are present. |

## Files touched

- `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.ts`
- `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.html`
- `libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts`
- `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.ts`
- `libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts`
- `libs/shared/src/lib/types/harness-blocked-wording.ts`
- `libs/shared/src/lib/types/harness-blocked-wording.spec.ts`
- `apps/ptah-docs/src/content/docs/tribunal/relay.md`
- `apps/ptah-docs/src/content/docs/tribunal/crucible.md`
- `apps/ptah-docs/src/content/docs/tribunal/race.md`
- `apps/ptah-docs/src/content/docs/tribunal/forge.md`
- `apps/ptah-docs/src/content/docs/tribunal/council.md`
- `apps/ptah-docs/src/content/docs/tribunal/index.mdx`
- `.ptah/specs/TASK_2026_707/batch-v2-b1-fix1.md`

## Verification

- `npx jest -c libs/frontend/dashboard/jest.config.ts libs/frontend/dashboard/src/lib/components/provider-account-card/plan-tile-view.model.spec.ts libs/frontend/dashboard/src/lib/components/provider-account-tile/provider-account-tile.component.spec.ts --coverage=false --maxWorkers=1` — 2 suites, 50 tests passed.
- `npx jest -c libs/frontend/marketplace/jest.config.ts libs/frontend/marketplace/src/lib/harness/harness-health-badge.component.spec.ts --coverage=false --maxWorkers=1` — 1 suite, 25 tests passed.
- `npx jest -c libs/shared/jest.config.ts libs/shared/src/lib/types/harness-blocked-wording.spec.ts --coverage=false --maxWorkers=1` — 1 suite, 42 tests passed.
- `ptah_get_diagnostics` was called twice after edits with the four changed source files. Both calls reported the TypeScript check still running after 45 seconds; no diagnostic verdict was available.

## Decisions

- Updated the Tribunal index as well as the five named guides. Search found the same obsolete dashboard instruction there; the page states Tribunal is available in Electron and the CLI, so the Electron top tab is the relevant click path. This is reversible copy.
- Kept one visible status detail in windowed cells and included all detail lines in title and `aria-label`. This preserves the compact cell height while exposing cooldown, status, and evidence. This is reversible presentation code.
- Removed the `dashboard-card` wording surface because code search found no production reader after the card move; the shared allowlist and its specs now cover the active badge. This is reversible registry cleanup.

## Not done

- TypeScript diagnostics could not complete through `ptah_get_diagnostics`; Jest compiled and exercised the changed Angular and shared specs.
- No build, e2e, or workspace-wide checks were run under the task's verification limits.
