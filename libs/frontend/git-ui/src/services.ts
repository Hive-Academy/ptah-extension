/**
 * Git UI - Services-only entry point
 *
 * Lightweight barrel that exports only services (no components). Use this
 * import path when you need the git push-message services without pulling the
 * git dock, source control and diff view components — and Monaco behind
 * them — into the bundle:
 *
 *   import { GitStatusService } from '@ptah-extension/git-ui/services';
 *
 * For components, use the main entry point:
 *
 *   import { GitDockComponent } from '@ptah-extension/git-ui';
 *
 * These four services are `MESSAGE_HANDLERS` entries constructed at bootstrap
 * to receive git push events — they must stay EAGER. Only the components are
 * deferred (TASK_2026_576, Requirement 3.1).
 */

export { GitStatusService } from './lib/services/git-status.service';
export { GitBranchesService } from './lib/services/git-branches.service';
export { WorktreeService } from './lib/services/worktree.service';
export { DiffTabsService } from './lib/services/diff-tabs.service';
