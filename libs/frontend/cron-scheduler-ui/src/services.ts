/**
 * Cron Scheduler UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need cron services without pulling
 * `CronSchedulerTabComponent` — and the Thoth shell graph behind it — into the
 * bundle:
 *
 *   import { CronRpcService } from '@ptah-extension/cron-scheduler-ui/services';
 *
 * For components, use the main entry point:
 *
 *   import { CronSchedulerTabComponent } from '@ptah-extension/cron-scheduler-ui';
 *
 * This lib reaches the webview graph through exactly two edges: the Thoth
 * shell (deferred) and `ThothStatusService` in the eager dashboard, which needs
 * only `CronRpcService`. Cutting the second edge with this barrel is what lets
 * the whole lib leave the initial bundle (TASK_2026_187, Unit 4).
 */

export { CronRpcService } from './lib/services/cron-rpc.service';
