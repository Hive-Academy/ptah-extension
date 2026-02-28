/**
 * CLI Skill Installer Interface
 * TASK_2025_160: Strategy interface for CLI-specific skill installation
 *
 * Each CLI target (Copilot, Gemini) has its own installer implementation
 * that knows how to copy Ptah plugin skills to the CLI's discovery directory.
 *
 * Pattern: Strategy pattern matching CliAdapter interface in cli-adapters/.
 */

import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';

/**
 * Strategy interface for installing Ptah skills into a specific CLI's
 * user-level discovery directory.
 *
 * Implementations handle:
 * - Recursive directory copying from extension assets
 * - Frontmatter stripping (Claude-specific fields like `allowed-tools`)
 * - Directory creation and cleanup
 */
export interface ICliSkillInstaller {
  /** Which CLI this installer targets */
  readonly target: CliTarget;

  /**
   * Install/sync Ptah plugin skills to the CLI's skill discovery directory.
   *
   * Copies skill directories from `{extensionPath}/assets/plugins/{pluginId}/skills/`
   * to the CLI's user-level skill directory (e.g., `~/.copilot/skills/ptah-{pluginId}/`).
   *
   * Only copies the `skills/` subtree from each plugin. Does NOT copy
   * `.claude-plugin/` or `commands/` directories (those are Claude SDK-specific).
   *
   * @param pluginPaths - Absolute paths to Ptah plugin directories (from PluginLoaderService)
   * @returns Sync status with skill count and any errors
   */
  install(pluginPaths: string[]): Promise<CliSkillSyncStatus>;

  /**
   * Remove all Ptah-installed skills from this CLI's directories.
   * Called on premium expiry or extension deactivation.
   * Removes all `ptah-*` prefixed directories from the CLI's skills directory.
   */
  uninstall(): Promise<void>;

  /**
   * Get the base directory where skills are installed for this CLI.
   * Used by manifest tracker for hash verification.
   *
   * @returns Absolute path to CLI's skills directory (e.g., `~/.copilot/skills/`)
   */
  getSkillsBasePath(): string;
}
