/**
 * Marketplace Library — harness disclosure entry point (eager-safe)
 *
 * A second narrow barrel beside `./services.ts`, for the same reason that one
 * exists: `@ptah-extension/marketplace` (the WIDE barrel) is reachable only
 * through a dynamic `import()`, because it pulls `MarketplaceHubComponent` and
 * the eight surfaces behind it — `SmitherySurfaceComponent` and
 * `ExternalMarketplacesComponent` alone are ~1,700 lines. A static import of
 * the wide barrel from eager code drags all of that into the initial bundle
 * and is rejected by `@nx/enforce-module-boundaries`
 * (`checkDynamicDependenciesExceptions`, `eslint.config.mjs`).
 *
 * The blocked-paths disclosure now has a second consumer that IS eager:
 * `DashboardGridComponent` is a static import in `AppShellComponent.imports`,
 * so the Dashboard harness card cannot reach the wide barrel. What it needs is
 * one leaf presentational component and one pure flattening function, neither
 * of which imports anything from marketplace beyond `@angular/core` and
 * `@ptah-extension/shared` — so exporting them here costs the initial bundle
 * only what the card actually renders.
 *
 * `HarnessHealthStore` is deliberately NOT re-exported here. It lives in
 * `./services.ts`, which is where `app.config.ts` already registers it in
 * `MESSAGE_HANDLERS`; one service, one entry point, no chance of a reader
 * concluding there are two singletons.
 *
 *   import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
 *   import { HarnessBlockedPathsComponent } from '@ptah-extension/marketplace/harness';
 *
 * `HarnessRepairDialogComponent` joined this barrel for Batch 9's Task 11.2:
 * the Dashboard harness card is the ONE route into the consent dialog, and the
 * card is eager, so the dialog has to be reachable without the wide barrel. It
 * `inject()`s `HarnessHealthStore` through a RELATIVE import inside this lib
 * rather than through `./services.ts` — same `providedIn: 'root'` class, same
 * single instance, and re-exporting it here would be the two-singleton
 * confusion the paragraph above exists to prevent.
 *
 * @see TASK_2026_187 — the split this preserves
 * @see TASK_2026_306 Batch 11 — the eager consumer that made a second narrow
 *      barrel necessary
 * @see TASK_2026_306 Batch 9 / Task 11.2 — the dialog the card routes into
 */

export { HarnessBlockedPathsComponent } from './lib/harness/harness-blocked-paths.component';
export { HarnessRepairDialogComponent } from './lib/harness/harness-repair-dialog.component';
export { harnessBlockedPaths } from './lib/harness/harness-health.model';
export type {
  HarnessBlockedDisclosure,
  HarnessBlockedGroup,
} from './lib/harness/harness-health.model';
