/**
 * Tasks UI Library - Services-only entry point
 *
 * Lightweight barrel that exports only services — no components. Use this
 * import path from eager code (e.g. the webview's `app.config.ts`, which
 * registers `TasksStore` in `MESSAGE_HANDLERS`) so that registering the
 * message handler does not drag the 14-component board into the initial
 * bundle:
 *
 *   import { TasksStore } from '@ptah-extension/tasks-ui/services';
 *
 * For components, use the main entry point — which should only ever be reached
 * through a dynamic `import()`:
 *
 *   import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent);
 *
 * @see TASK_2026_187
 */

export {
  BULK_CONFIRM_THRESHOLD,
  TasksStore,
  TASKS_CHANGED_MESSAGE_TYPE,
} from './lib/services/tasks-store.service';
export type {
  ApplyMetadataOptions,
  BulkFailure,
  BulkProgress,
  BulkSummary,
  BulkUntouched,
  TaskBoardColumn,
  TaskBulkOutcome,
  TaskEstimateBuckets,
} from './lib/services/tasks-store.service';
