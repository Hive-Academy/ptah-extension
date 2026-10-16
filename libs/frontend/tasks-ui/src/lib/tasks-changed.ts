/**
 * Raw webview message type broadcast by the backend `TasksRpcHandlers` whenever
 * the on-disk `.ptah/specs` index changes (write / watcher / reindex). Dispatched
 * by `MessageRouterService` purely by type string — mirrors `git:worktreeChanged`.
 *
 * Lives in its own module so the board-free `TasksChangedFeed` (and the
 * `@ptah-extension/tasks-ui/presentation` entry) can name it without importing
 * `TasksStore`. The store re-exports it under the same name.
 */
export const TASKS_CHANGED_MESSAGE_TYPE = 'tasks:changed';
