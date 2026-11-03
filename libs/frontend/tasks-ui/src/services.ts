/**
 * Tasks UI Library - Services-only entry point
 *
 * Lightweight barrel for EAGER code (the webview's `app.config.ts`, which
 * registers push handlers in `MESSAGE_HANDLERS`). It exports no component and,
 * deliberately, not `TasksStore`: the store and its folder/document state live
 * in the lazily loaded board chunk and hear `tasks:changed` through the eager
 * `TasksChangedFeed` (`@ptah-extension/tasks-ui/presentation`). Exporting the
 * store here would put it back in the initial bundle (TASK_2026_871).
 *
 *   import { TaskSessionLinksService } from '@ptah-extension/tasks-ui/services';
 *
 * For components and the store, use the main entry point — which should only
 * ever be reached through a dynamic `import()`:
 *
 *   import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent);
 *
 * @see TASK_2026_187
 */

export {
  TaskSessionLinksService,
  type TaskSessionLinkMap,
} from './lib/services/task-session-links.service';
