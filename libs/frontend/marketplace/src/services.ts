/**
 * Marketplace Library - Services-only entry point
 *
 * Lightweight barrel that exports only services — no components. Use this
 * import path from eager code (e.g. the webview's `app.config.ts`, which
 * registers `HarnessHealthStore` in `MESSAGE_HANDLERS`) so that registering the
 * message handler does not drag the Marketplace shell, its pages and the
 * surfaces behind them into the initial bundle:
 *
 *   import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
 *
 * For the Marketplace itself, use the main entry point — which should only
 * ever be reached through a dynamic `import()`:
 *
 *   loadChildren: () =>
 *     import('@ptah-extension/marketplace').then((m) => m.MARKETPLACE_ROUTES)
 *
 * @see TASK_2026_187
 */

export { HarnessHealthStore } from './lib/harness/harness-health.store';
