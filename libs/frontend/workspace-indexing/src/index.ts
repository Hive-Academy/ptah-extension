/**
 * @ptah-extension/workspace-indexing — Workspace indexing settings panel.
 *
 * Shared by `@ptah-extension/chat` and `@ptah-extension/memory-curator-ui` so
 * neither has to depend on the other and the
 * `memory-curator-ui → chat → thoth-shell → memory-curator-ui` cycle is avoided.
 */

export { WorkspaceIndexingComponent } from './lib/workspace-indexing.component';
export {
  WorkspaceIndexingService,
  type IndexingUiState,
} from './lib/workspace-indexing.service';
