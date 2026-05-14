/**
 * @ptah-extension/workspace-indexing — Workspace indexing settings panel.
 *
 * Extracted from `@ptah-extension/chat/lib/settings/workspace-indexing` in
 * TASK_2026_119 Batch 3.5 so that both `@ptah-extension/chat` (legacy Settings
 * tab path, now removed) and `@ptah-extension/memory-curator-ui` (Memory tab)
 * can consume the same component without forming the
 * `memory-curator-ui → chat → thoth-shell → memory-curator-ui` cycle.
 */

export { WorkspaceIndexingComponent } from './lib/workspace-indexing.component';
export {
  WorkspaceIndexingService,
  type IndexingUiState,
} from './lib/workspace-indexing.service';
