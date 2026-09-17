/**
 * @ptah-extension/git-ui — the webview's entire git surface behind one public API.
 *
 * Owns git status, branches, worktrees, source control and the Monaco diff
 * view. Depends on `@ptah-extension/core` and `@ptah-extension/shared` only —
 * never on `chat`, `ui` or `editor`.
 *
 * `MonacoLoaderService` and `git-read-error-messages` are deliberately NOT
 * exported: they are implementation detail of `DiffViewComponent` and
 * `DiffTabsService` respectively.
 */

// Services
export { GitStatusService } from './lib/services/git-status.service';
export { GitBranchesService } from './lib/services/git-branches.service';
export {
  WorktreeService,
  WORKTREE_CHANGED_MESSAGE_TYPE,
} from './lib/services/worktree.service';
export { SourceControlService } from './lib/services/source-control.service';
export { DiffTabsService } from './lib/services/diff-tabs.service';
export { EditorLauncherService } from './lib/services/editor-launcher.service';
export { GitReviewService } from './lib/services/git-review.service';

// Components
export { DiffViewComponent } from './lib/diff-view/diff-view.component';
export { SourceControlPanelComponent } from './lib/source-control/source-control-panel.component';
export { SourceControlFileComponent } from './lib/source-control/source-control-file.component';
export { WorktreeSectionComponent } from './lib/worktree/worktree-section.component';
export { GitDockComponent } from './lib/git-dock/git-dock.component';
export { GitDockHeaderComponent } from './lib/git-dock/git-dock-header.component';
export { OpenInButtonComponent } from './lib/open-in/open-in-button.component';
export type {
  OpenInButtonMode,
  OpenInRequest,
} from './lib/open-in/open-in-button.component';

// Diff tab types + helpers
export type {
  DiffComparison,
  DiffProvenance,
  DiffSideRef,
  DiffTabState,
  DiffTabStatus,
  EditorTab,
  FileViewOpenRequest,
  GitApplyHunksOperation,
  GitApplyHunksResult,
  GitDiffFileResult,
  GitHunkRef,
  HunkApplyFn,
  HunkApplyRequest,
  OpenDiffRequest,
} from './lib/types/diff-tab.types';
export {
  diffComparisonLabel,
  diffTabKey,
  diffTabLabel,
  normalizeDiffPath,
} from './lib/types/diff-tab.types';
