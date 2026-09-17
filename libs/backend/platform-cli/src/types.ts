/**
 * CLI Platform Options
 *
 * Configuration for registerPlatformCliServices().
 * All paths should be absolute. The registration function resolves
 * defaults for optional paths.
 */

import type { CliWorkspaceWatcherOptions } from './implementations/cli-workspace-watcher';

export interface CliPlatformOptions {
  /** Resolved application binary/entry path */
  appPath: string;

  /** Workspace directory — defaults to process.cwd() if not provided */
  workspacePath?: string;

  /** User data directory — defaults to ~/.ptah/ */
  userDataPath?: string;

  /** Log file directory — defaults to ~/.ptah/logs/ */
  logsPath?: string;

  /** Mirror log output to stderr for debugging */
  verbose?: boolean;

  /**
   * Watch host wiring for `PLATFORM_TOKENS.WORKSPACE_WATCHER` (TASK_2026_437
   * C9): the host bundle path plus the log and degradation sinks. The token is
   * left unregistered when omitted — a host that never watches forks nothing.
   */
  workspaceWatchHost?: CliWorkspaceWatcherOptions;
}
