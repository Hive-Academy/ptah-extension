/**
 * Editor Library - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components with heavy deps
 * like Monaco). Use this import path when you need editor services without
 * pulling monaco into the bundle:
 *
 *   import { EditorService } from '@ptah-extension/editor/services';
 *
 * For components, use the main entry point:
 *
 *   import { EditorPanelComponent } from '@ptah-extension/editor';
 */

export { EditorService } from './lib/services/editor.service';
export {
  EDITOR_INTERNAL_STATE,
  type EditorInternalState,
} from './lib/services/editor/editor-internal-state';
export { provideEditorInternalState } from './lib/services/editor-internal-state.provider';
export type { FileTreeNode } from './lib/models/file-tree.model';
