// Eager vitals exports. Welcome, empty-board and empty-chat-only molecules
// (plan/readiness rings, prompt launchers, spend bars, stat rows/cells/values
// and recent workspaces) live at runtime only in @ptah-extension/chat-ui/vitals.
// Keep their types here without creating an eager runtime import.
export { ProgressRingComponent } from './progress-ring.component';
export type { PlanRingData } from './plan-ring.component';
export {
  ActivityGridComponent,
  activityLevels,
  type ActivityDay,
  type ActivityLevel,
} from './activity-grid.component';
export type { StatCellState } from './stat-cell.component';
export {
  StagedStepsComponent,
  type StagedStep,
} from './staged-steps.component';
export type {
  ReadinessAction,
  ReadinessCheck,
} from './readiness-ring.component';
export type { PromptLauncher } from './prompt-launchers.component';
export type { RecentWorkspaceItem } from './recent-workspace-list.component';
