/**
 * CLI Platform Options
 *
 * Configuration for registerPlatformCliServices().
 * All paths should be absolute. The registration function resolves
 * defaults for optional paths.
 */

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
}
