/**
 * Git UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need the git push-message services without pulling the
 * review shell and its renderers into the bundle:
 *
 *   import { GitStatusService } from '@ptah-extension/git-ui/services';
 *
 * For the review shell, use the main entry point by dynamic import:
 *
 *   import('@ptah-extension/git-ui').then((m) => m.ReviewShellComponent);
 *
 * These services are `MESSAGE_HANDLERS` entries constructed at bootstrap to
 * receive git push events — they must stay EAGER. Only the components are
 * deferred (TASK_2026_576, Requirement 3.1).
 */

export { GitStatusService } from './lib/services/git-status.service';
export { GitBranchesService } from './lib/services/git-branches.service';
export { WorktreeService } from './lib/services/worktree.service';
export { FileContentChangesService } from './lib/services/file-content-changes.service';
export { GitOperationOutputService } from './lib/services/git-operation-output.service';
export { ReviewDiffService } from './lib/services/review-diff.service';
export { GitReviewService } from './lib/services/git-review.service';
