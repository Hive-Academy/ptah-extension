import {
  NESTED_WORKSPACE_PATH_RULES,
  toWorkspaceExcludeGlobs,
} from '@ptah-extension/shared';

/**
 * Glob excludes shared by every workspace walk and glob-based watcher: the
 * file index and its watcher, the indexer, context gathering, TypeScript
 * diagnostics and the MCP `findFiles` builders.
 *
 * The nested-checkout rules (agent worktrees) are DERIVED from
 * `NESTED_WORKSPACE_PATH_RULES` rather than hand-listed, so the segment
 * predicate and these globs cannot drift apart (TASK_2026_437 INV-2, pinned by
 * `workspace-default-excludes.spec.ts`).
 */
export const DEFAULT_WORKSPACE_EXCLUDES: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/out/**',
  '**/target/**',
  '**/.nx/**',
  '**/.angular/**',
  '**/.cache/**',
  '**/.vite/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.turbo/**',
  '**/.output/**',
  '**/.vscode-test/**',
  '**/coverage/**',
  '**/.nyc_output/**',
  '**/tmp/**',
  '**/.DS_Store',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  ...toWorkspaceExcludeGlobs(NESTED_WORKSPACE_PATH_RULES),
];
