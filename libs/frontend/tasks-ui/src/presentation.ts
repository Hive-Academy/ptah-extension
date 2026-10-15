/**
 * Tasks UI Library - presentation-only entry point
 *
 * The narrow surface code outside the board needs to show ONE task: status
 * labels and ink, the derived Stage, document ordering, the workflow artifact
 * list, and a board-free `tasks:changed` feed. Nothing here reaches
 * `TasksStore` or a board component, so importing this entry from the chat
 * graph (the session inspector's TASK section) adds neither to its bundle:
 *
 *   import { deriveTaskStage, TasksChangedFeed } from '@ptah-extension/tasks-ui/presentation';
 *
 * Board components stay behind the main entry, reached only via `import()`;
 * eager message-handler registration of the store uses
 * `@ptah-extension/tasks-ui/services`.
 */

export {
  TASK_STATUS_LABELS,
  WORKFLOW_ARTIFACTS,
  type WorkflowArtifact,
} from './lib/task-presentation';
export {
  TASK_STATUS_INK,
  deriveTaskStage,
  orderTaskDocuments,
  type TaskStage,
} from './lib/task-stage';
export { TASKS_CHANGED_MESSAGE_TYPE } from './lib/tasks-changed';
export {
  TasksChangedFeed,
  type TasksChangedEvent,
} from './lib/services/tasks-changed-feed.service';
