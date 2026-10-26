/**
 * Chat UI - Vitals entry point (`@ptah-extension/chat-ui/vitals`)
 *
 * The vitals molecules of the no-workspace welcome
 * (`ptah-electron-welcome`): plan ring, spend bars, the stat row with its
 * cells and values, and the recent workspace list. Electron-shell mounts the
 * welcome inside `@defer`, which the Angular compiler turns into a dynamic
 * `import()`. The main `@ptah-extension/chat-ui` barrel is statically imported
 * by eager code, so a deferred component importing these from there would land
 * them in the initial chunk; from this file, which nothing eager imports
 * statically, esbuild emits them in the welcome's lazy chunk (same pattern as
 * `@ptah-extension/chat-ui/turn-recap`).
 *
 * Their types (`PlanRingData`, `StatCellState`, `RecentWorkspaceItem`) are
 * also exported type-only from the main barrel. Do not re-export the runtime
 * symbols from `index.ts`.
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
