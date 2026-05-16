/**
 * CLI Skill Installer Interface
 *
 * Each CLI target (Copilot, Gemini) has its own installer implementation
 * that knows how to copy Ptah plugin skills to the CLI's discovery directory.
 *
 * Pattern: Strategy pattern matching CliAdapter interface in cli-adapters/.
 */

import type { CliTarget, CliSkillSyncStatus } from '@ptah-extension/shared';

/**
 * Options controlling install scope so two coexisting install() callers
 * (plugin sync vs synthesized-skill sync) do not stomp each other's
 * cleanup pass. Each call should own a distinct prefix bucket.
 */
export interface CliSkillInstallOptions {
  /**
   * Folder/file prefix applied to installed skill directories AND used as
   * the cleanup-loop ownership predicate. Default: `'ptah-'` (plugin sync).
   * Synthesized-skill sync uses `'ptah-synth-'` so it never deletes plugin skills.
   */
  folderPrefix?: string;
  /**
   * When false, skip the command-file sync (copy + cleanup). Synthesized
   * skills have no commands; running cleanup would erase plugin commands.
   * Default: true.
   */
  syncCommands?: boolean;
  /**
   * When true, skip directories that lack a top-level `SKILL.md` at scan time.
   * Defends against `_candidates/` and similar non-skill subtrees being copied
   * as fake skills. Default: false (preserve existing plugin-sync behaviour).
   */
  requireSkillMdAtRoot?: boolean;
}

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
   * Only copies the `skills/` subtree from each plugin.
   * Also copies command `.md` files from each plugin's `commands/` directory.
   *
   * @param pluginPaths - Absolute paths to Ptah plugin directories (from PluginLoaderService)
   * @returns Sync status with skill count and any errors
   */
  install(
    pluginPaths: string[],
    options?: CliSkillInstallOptions,
  ): Promise<CliSkillSyncStatus>;

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

  /**
   * Get the base directory where commands are installed for this CLI.
   * @returns Absolute path to CLI's commands directory (e.g., `~/.copilot/commands/`)
   */
  getCommandsBasePath(): string;
}
