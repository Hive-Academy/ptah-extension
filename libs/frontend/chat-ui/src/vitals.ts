/**
 * Lazy vitals entry for the deferred welcome, canvas empty board and empty chat.
 * Runtime molecules stay here so eager main-barrel imports cannot pull them
 * into the initial webview chunk. Their types are also exported type-only
 * from the main barrel; never re-export these runtime symbols there.
 */
export {
  PlanRingComponent,
  planRingCaption,
  type PlanRingData,
} from './lib/molecules/vitals/plan-ring.component';
export { SpendBarsComponent } from './lib/molecules/vitals/spend-bars.component';
export { StatRowComponent } from './lib/molecules/vitals/stat-row.component';
export {
  StatCellComponent,
  type StatCellState,
} from './lib/molecules/vitals/stat-cell.component';
export { StatValueComponent } from './lib/molecules/vitals/stat-value.component';
export {
  RecentWorkspaceListComponent,
  type RecentWorkspaceItem,
} from './lib/molecules/vitals/recent-workspace-list.component';
export {
  ReadinessRingComponent,
  type ReadinessAction,
  type ReadinessCheck,
} from './lib/molecules/vitals/readiness-ring.component';
export {
  PromptLaunchersComponent,
  buildLaunchers,
  type PromptLauncher,
} from './lib/molecules/vitals/prompt-launchers.component';
