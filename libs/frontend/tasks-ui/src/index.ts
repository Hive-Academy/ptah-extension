export { TasksViewComponent } from './lib/components/tasks-view.component';
export { TaskBoardComponent } from './lib/components/board/task-board.component';
export { TaskColumnComponent } from './lib/components/board/task-column.component';
export { TaskCardComponent } from './lib/components/board/task-card.component';
export type {
  TaskSelectionToggle,
  TaskStartRequest,
  TaskStatusChange,
} from './lib/components/board/task-card.component';
export { TaskBulkBarComponent } from './lib/components/bulk/task-bulk-bar.component';
export { TaskBulkSummaryComponent } from './lib/components/bulk/task-bulk-summary.component';
export { TaskDetailComponent } from './lib/components/detail/task-detail.component';
export { TaskRelationsComponent } from './lib/components/detail/task-relations.component';
export type {
  TaskRelationEntry,
  TaskRelationGroupView,
} from './lib/components/detail/task-relations.component';
export { TaskMetadataEditorComponent } from './lib/components/detail/task-metadata-editor.component';
export { TaskFilterBarComponent } from './lib/components/filter/task-filter-bar.component';
export type {
  TaskFacetOption,
  TaskFilterChip,
} from './lib/components/filter/task-filter-bar.component';
export { TaskViewMenuComponent } from './lib/components/filter/task-view-menu.component';
export type {
  TaskViewMove,
  TaskViewRename,
} from './lib/components/filter/task-view-menu.component';
export { TaskCommandPaletteComponent } from './lib/components/palette/task-command-palette.component';
export {
  EMPTY_PALETTE_CONTEXT,
  TASK_PALETTE_GROUPS,
  TASK_PALETTE_GROUP_LABELS,
  buildPaletteEntries,
} from './lib/components/palette/palette-entries';
export type {
  TaskPaletteAction,
  TaskPaletteContext,
  TaskPaletteEntry,
  TaskPaletteGroup,
} from './lib/components/palette/palette-entries';
export {
  rankPaletteMatches,
  scorePaletteMatch,
} from './lib/components/palette/palette-match';
export type { PaletteLabelled } from './lib/components/palette/palette-match';
export type { TaskMetadataWrite } from './lib/components/detail/task-metadata-write';
export {
  LABEL_CHIP_CLASSES,
  TASK_RELATION_GROUPS,
  TASK_RELATION_GROUP_LABELS,
  TASK_RELATION_GROUP_ORIGIN,
  TASK_RELATION_ORIGIN_NOTES,
  labelChipClass,
  taskEstimateBadge,
  taskRelationHeading,
} from './lib/task-presentation';
export type {
  TaskRelationGroup,
  TaskRelationOrigin,
} from './lib/task-presentation';
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
export { TaskStartService } from './lib/services/task-start.service';
export {
  TaskViewsService,
  nextViewId,
  taskFilterEquals,
  taskSortEquals,
} from './lib/services/task-views.service';
export type { TaskViewMoveDirection } from './lib/services/task-views.service';
