/**
 * Marketplace Library — wide entry point (LAZY ONLY).
 *
 * Reached through `loadChildren` in the webview's `app.routes.ts`; it pulls the
 * shell, every page and every discovery surface behind them. Eager code uses
 * the narrow barrels instead: `./services.ts` (`HarnessHealthStore`) and
 * `./harness.ts` (the Dashboard harness card's pieces).
 *
 * Pages, stores and surfaces are deliberately not exported: the route table
 * is the only way in, and nothing outside this library constructs them.
 */

// Routes
export { MARKETPLACE_ROUTES } from './lib/routes/marketplace.routes';

// Harness health presentation
export { HarnessHealthBadgeComponent } from './lib/harness/harness-health-badge.component';
export { HarnessTargetRowComponent } from './lib/harness/harness-target-row.component';
export { HarnessBlockedPathsComponent } from './lib/harness/harness-blocked-paths.component';
export { HarnessRepairDialogComponent } from './lib/harness/harness-repair-dialog.component';
export {
  HARNESS_FACET_ORDER,
  harnessBadgeTone,
  harnessBlockedPaths,
  harnessFacetLabel,
  harnessTargetLabel,
  harnessTargetNeedsAttention,
} from './lib/harness/harness-health.model';
export type {
  HarnessBadgeTone,
  HarnessBlockedDisclosure,
  HarnessBlockedGroup,
} from './lib/harness/harness-health.model';
