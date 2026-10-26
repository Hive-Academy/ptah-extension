// Main-barrel part of the vitals molecules. The no-workspace welcome's
// molecules (plan ring, spend bars, stat row/cell/value, recent workspace
// list) are exported at runtime only from `@ptah-extension/chat-ui/vitals`
// (`src/vitals.ts`), so the welcome's lazy chunk keeps them out of the
// initial bundle. Their types stay here: a type-only export emits no import.
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
export {
  ReadinessRingComponent,
  type ReadinessAction,
  type ReadinessCheck,
} from './readiness-ring.component';
export {
  PromptLaunchersComponent,
  buildLaunchers,
  type PromptLauncher,
} from './prompt-launchers.component';
export type { RecentWorkspaceItem } from './recent-workspace-list.component';
