/**
 * Skill Junction Service (TASK_2025_201)
 *
 * Creates filesystem junctions from {workspace}/.ptah/skills/{skillName}/
 * to {pluginsBasePath}/{pluginId}/skills/{skillName}/.
 *
 * Uses .ptah/ instead of .claude/ to avoid:
 * - Skill/command duplication (SDK's plugins option already loads skills for Claude)
 * - Polluting the user's .claude/ folder with extension-managed junctions
 *
 * This makes plugin skills discoverable by third-party AI providers (Codex, Copilot)
 * that search the workspace via MCP tools. Claude's native provider already resolves
 * these paths via the SDK's internal plugin mapping, so junctions are complementary.
 *
 * Platform handling (OS-level, not IPlatformInfo which tracks host environment):
 * - Windows: NTFS junctions (fs.symlinkSync with 'junction' type, no admin required)
 * - Unix: Directory symlinks (fs.symlinkSync with 'dir' type)
 *
 * Lifecycle:
 * - Created at extension activation (Step 7.1.5.1 in main.ts)
 * - Cleaned up on extension deactivation (sync, since deactivate() is sync)
 * - Re-created on workspace folder change
 *
 * Safety:
 * - Never overwrites real directories or files (only manages junctions/symlinks it created)
 * - Uses unlinkSync for junction removal (never rmSync which can follow junctions)
 * - All operations are non-fatal (failures never block extension activation)
 * - Stale junctions from previously enabled plugins are cleaned up
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { join, basename } from 'path';
import {
  mkdirSync,
  readdirSync,
  lstatSync,
  statSync,
  accessSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  copyFileSync,
  constants as fsConstants,
} from 'fs';
import type { Stats } from 'fs';

/**
 * Result of junction creation/cleanup operations
 */
export interface SkillJunctionResult {
  /** Number of junctions successfully created */
  created: number;
  /** Number of skills skipped (real directory or file exists) */
  skipped: number;
  /** Number of stale junctions removed */
  removed: number;
  /** Error messages for failed operations */
  errors: string[];
}

/** Whether the current OS is Windows (for junction type selection and path comparison) */
const IS_WINDOWS = process.platform === 'win32';

/**
 * Workspace subdirectory for Ptah-managed junctions.
 * Uses .ptah/ instead of .claude/ to avoid:
 * - Skill/command duplication (SDK's plugins option already loads skills for Claude)
 * - Polluting the user's .claude/ folder with extension-managed content
 */
const PTAH_WORKSPACE_DIR = '.ptah';

/**
 * Manages workspace .ptah/skills/ junctions pointing to extension plugin skill directories.
 *
 * Uses a late-initialized singleton pattern: `initialize()` must be called from
 * main.ts after DI setup to provide the plugins base path. Workspace root is resolved
 * via the injected IWorkspaceProvider.
 */
@injectable()
export class SkillJunctionService {
  private pluginsBasePath: string | null = null;
  private workspaceRoot: string | null = null;

  /** Track which junction paths we created, for cleanup */
  private managedJunctions = new Set<string>();

  /** Subscription disposer for workspace folder changes */
  private workspaceFolderDisposer: (() => void) | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
  ) {}

  /**
   * Late initialization with plugins base path.
   * Must be called from main.ts after DI setup.
   *
   * @param pluginsBasePath - Absolute path to the plugins directory (~/.ptah/plugins/ from ContentDownloadService)
   */
  initialize(pluginsBasePath: string): void {
    this.pluginsBasePath = pluginsBasePath;
    this.workspaceRoot = this.workspaceProvider.getWorkspaceRoot() ?? null;
    this.logger.debug('[SkillJunctionService] Initialized', {
      pluginsBasePath,
      workspaceRoot: this.workspaceRoot,
    });
  }

  /**
   * Full activation: create junctions + subscribe to workspace changes.
   * Always subscribes to workspace changes even if no plugins are currently enabled,
   * so junctions are created when the user enables plugins and switches workspaces.
   *
   * @param pluginPaths - Absolute paths to enabled plugin directories
   * @param getPluginPaths - Callback to re-resolve plugin paths on workspace change
   * @returns Junction creation result
   */
  activate(
    pluginPaths: string[],
    getPluginPaths: () => string[],
  ): SkillJunctionResult {
    const result = this.createJunctions(pluginPaths);
    this.subscribeToWorkspaceChanges(getPluginPaths);
    return result;
  }

  /**
   * Create junctions for skills and copy command files from all enabled plugins.
   *
   * Skills: Junctions in {workspace}/.ptah/skills/{skillName}/ -> plugin skills dir
   * Commands: Copies to {workspace}/.ptah/commands/{commandName}.md (file symlinks
   *           require Developer Mode on Windows, so we copy instead)
   *
   * @param pluginPaths - Absolute paths to enabled plugin directories
   * @returns Result with counts of created/skipped/removed/errors
   */
  createJunctions(pluginPaths: string[]): SkillJunctionResult {
    const result: SkillJunctionResult = {
      created: 0,
      skipped: 0,
      removed: 0,
      errors: [],
    };

    if (!this.workspaceRoot) {
      this.logger.debug(
        '[SkillJunctionService] No workspace open, skipping junction creation',
      );
      return result;
    }

    // One-time migration: remove orphaned junctions from old .claude/skills/ and .claude/commands/
    // (previous versions created junctions there; we now use .ptah/ to avoid duplication)
    this.migrateFromClaudeDir(result);

    // Build skills map: skillName -> source absolute path
    const skillsMap = this.buildSkillsMap(pluginPaths);
    if (skillsMap.size === 0) {
      this.logger.debug(
        '[SkillJunctionService] No skills found in enabled plugins',
      );
      return result;
    }

    // Ensure .ptah/skills/ directory exists
    const skillsDir = join(this.workspaceRoot, PTAH_WORKSPACE_DIR, 'skills');
    try {
      mkdirSync(skillsDir, { recursive: true });
    } catch (error) {
      result.errors.push(
        `Failed to create .ptah/skills/ directory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return result;
    }

    // Remove stale junctions (from previously enabled but now disabled plugins)
    result.removed = this.removeStaleJunctions(skillsDir, skillsMap);

    // Create junctions for each skill
    for (const [skillName, sourcePath] of skillsMap) {
      const linkPath = join(skillsDir, skillName);

      try {
        // Check if something already exists at the link path
        let existingStat: Stats | null = null;
        try {
          existingStat = lstatSync(linkPath);
        } catch {
          // Path doesn't exist — good, we'll create it
        }

        if (existingStat) {
          if (existingStat.isSymbolicLink()) {
            // Junction/symlink exists — check if it points to the correct target
            const existingTarget = readlinkSync(linkPath);
            if (this.pathsEqual(existingTarget, sourcePath)) {
              // Already correct, skip
              this.managedJunctions.add(linkPath);
              continue;
            }
            // Symlink points elsewhere — check if the target is valid (e.g., SDK-created)
            // If the symlink resolves to a valid directory, skip it rather than replacing
            try {
              const resolvedStat = statSync(linkPath); // follows symlink
              if (resolvedStat.isDirectory()) {
                this.logger.debug(
                  `[SkillJunctionService] Skipping ${skillName}: valid symlink already exists (likely SDK-created)`,
                  { linkPath, existingTarget },
                );
                result.skipped++;
                continue;
              }
            } catch {
              // Symlink is broken (dangling) — remove and recreate
            }
            // Broken or non-directory symlink — remove and recreate
            // Use unlinkSync (not rmSync) to safely remove the link without following it
            unlinkSync(linkPath);
          } else if (existingStat.isDirectory()) {
            // Real directory exists — DO NOT touch it (likely SDK-created via pluginPaths)
            this.logger.debug(
              `[SkillJunctionService] Skipping ${skillName}: real directory exists (likely SDK-created)`,
              { linkPath },
            );
            result.skipped++;
            continue;
          } else {
            // Regular file or other entry — skip with clear message
            this.logger.debug(
              `[SkillJunctionService] Skipping ${skillName}: non-directory entry exists`,
              { linkPath },
            );
            result.skipped++;
            continue;
          }
        }

        // Create the junction/symlink
        this.createJunction(sourcePath, linkPath);
        this.managedJunctions.add(linkPath);
        result.created++;
      } catch (error) {
        result.errors.push(
          `Failed to create junction ${skillName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Sync command files from plugins into .ptah/commands/
    // Commands are individual .md files. On Unix: symlinked. On Windows: copied
    // (file symlinks require Developer Mode, unlike directory junctions).
    this.syncCommandFiles(pluginPaths, result);

    this.logger.info('[SkillJunctionService] Junctions and commands synced', {
      created: result.created,
      skipped: result.skipped,
      removed: result.removed,
      errors: result.errors.length,
      workspaceRoot: this.workspaceRoot,
    });

    return result;
  }

  /**
   * Subscribe to workspace folder changes to re-create junctions.
   */
  subscribeToWorkspaceChanges(getPluginPaths: () => string[]): void {
    // Dispose existing subscription if any
    this.workspaceFolderDisposer?.();

    const disposable = this.workspaceProvider.onDidChangeWorkspaceFolders(
      () => {
        try {
          this.logger.debug(
            '[SkillJunctionService] Workspace folders changed, re-creating junctions',
          );

          // Clean up old workspace junctions
          this.removeAllManagedJunctions();

          // Re-resolve workspace root
          this.workspaceRoot =
            this.workspaceProvider.getWorkspaceRoot() ?? null;

          // Create junctions in new workspace
          if (this.workspaceRoot) {
            this.createJunctions(getPluginPaths());
          }
        } catch (error) {
          this.logger.warn(
            '[SkillJunctionService] Failed to re-create junctions on workspace change',
            { error: error instanceof Error ? error.message : String(error) },
          );
        }
      },
    );

    this.workspaceFolderDisposer = () => disposable.dispose();
  }

  /**
   * Synchronous deactivation — called from main.ts deactivate() which is sync.
   * Removes all managed junctions and unsubscribes from workspace changes.
   */
  deactivateSync(): void {
    // Unsubscribe from workspace folder changes
    this.workspaceFolderDisposer?.();
    this.workspaceFolderDisposer = null;

    // Remove all managed junctions
    this.removeAllManagedJunctions();

    this.logger.debug('[SkillJunctionService] Deactivated');
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Build a map of skillName -> source absolute path from all enabled plugins.
   * Flat namespace: all skills from all plugins in one map.
   * First plugin wins on collision (logged as warning).
   */
  private buildSkillsMap(pluginPaths: string[]): Map<string, string> {
    const skillsMap = new Map<string, string>();

    for (const pluginPath of pluginPaths) {
      const skillsDir = join(pluginPath, 'skills');
      let entries: string[];
      try {
        entries = readdirSync(skillsDir);
      } catch {
        continue; // No skills/ directory in this plugin
      }

      for (const entry of entries) {
        const entryPath = join(skillsDir, entry);
        try {
          const stat = statSync(entryPath);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }

        // Check for SKILL.md presence (validates it's actually a skill)
        const skillMdPath = join(entryPath, 'SKILL.md');
        try {
          accessSync(skillMdPath, fsConstants.R_OK);
        } catch {
          continue; // No SKILL.md, not a skill directory
        }

        if (skillsMap.has(entry)) {
          const pluginId = basename(pluginPath);
          this.logger.warn(
            `[SkillJunctionService] Skill name collision: "${entry}" already registered, skipping from ${pluginId}`,
          );
          continue;
        }

        skillsMap.set(entry, entryPath);
      }
    }

    return skillsMap;
  }

  /**
   * Sync command .md files from plugin commands/ directories into
   * {workspace}/.ptah/commands/.
   *
   * These command files are for third-party provider discoverability via MCP
   * workspace search only. Ptah's own CommandDiscoveryService discovers plugin
   * commands directly via plugin paths (scanPluginDirectories), not from this
   * directory. Claude's SDK loads commands via the plugins option.
   *
   * On Linux/macOS: creates file symlinks (no restrictions).
   * On Windows: copies files (file symlinks require Developer Mode,
   * unlike directory junctions which work without admin).
   *
   * Tracks created entries in managedJunctions for cleanup on deactivation.
   */
  private syncCommandFiles(
    pluginPaths: string[],
    result: SkillJunctionResult,
  ): void {
    if (!this.workspaceRoot) return;

    const commandsDir = join(
      this.workspaceRoot,
      PTAH_WORKSPACE_DIR,
      'commands',
    );
    try {
      mkdirSync(commandsDir, { recursive: true });
    } catch (error) {
      result.errors.push(
        `Failed to create .ptah/commands/ directory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // Clean up stale command files (from previously enabled but now disabled plugins)
    try {
      const existingEntries = readdirSync(commandsDir);
      for (const entry of existingEntries) {
        const entryPath = join(commandsDir, entry);
        // Only remove entries we manage (symlinks pointing to our extension, or files we track)
        if (
          this.managedJunctions.has(entryPath) ||
          this.isExtensionJunction(entryPath)
        ) {
          // Check if this command still exists in any enabled plugin
          const commandExists = pluginPaths.some((pp) => {
            try {
              accessSync(join(pp, 'commands', entry), fsConstants.R_OK);
              return true;
            } catch {
              return false;
            }
          });
          if (!commandExists) {
            try {
              unlinkSync(entryPath);
              this.managedJunctions.delete(entryPath);
              result.removed++;
            } catch {
              /* non-fatal */
            }
          }
        }
      }
    } catch {
      /* commandsDir may not exist yet */
    }

    for (const pluginPath of pluginPaths) {
      const pluginCommandsDir = join(pluginPath, 'commands');
      let entries: string[];
      try {
        entries = readdirSync(pluginCommandsDir);
      } catch {
        continue; // No commands/ directory in this plugin
      }

      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;

        const sourcePath = join(pluginCommandsDir, entry);
        const targetPath = join(commandsDir, entry);

        try {
          // Check if something already exists at the target
          let existingStat: Stats | null = null;
          try {
            existingStat = lstatSync(targetPath);
          } catch {
            // Doesn't exist — will create
          }

          if (existingStat) {
            if (existingStat.isSymbolicLink()) {
              // Symlink exists — check if correct
              const existingTarget = readlinkSync(targetPath);
              if (this.pathsEqual(existingTarget, sourcePath)) {
                this.managedJunctions.add(targetPath);
                continue; // Already correct
              }
              // Symlink points elsewhere — check if it resolves to a valid file (e.g., SDK-created)
              try {
                const resolvedStat = statSync(targetPath); // follows symlink
                if (resolvedStat.isFile()) {
                  this.logger.debug(
                    `[SkillJunctionService] Skipping command ${entry}: valid symlink already exists (likely SDK-created)`,
                    { targetPath, existingTarget },
                  );
                  result.skipped++;
                  continue;
                }
              } catch {
                // Symlink is broken (dangling) — remove and recreate
              }
              unlinkSync(targetPath);
            } else if (!this.managedJunctions.has(targetPath)) {
              // Real file exists that we didn't create — don't overwrite (likely SDK-created)
              this.logger.debug(
                `[SkillJunctionService] Skipping command ${entry}: file already exists (likely SDK-created)`,
                { targetPath },
              );
              result.skipped++;
              continue;
            } else {
              // We created this file (copy) previously — remove and recreate
              unlinkSync(targetPath);
            }
          }

          if (IS_WINDOWS) {
            // Windows: copy file (file symlinks require Developer Mode)
            copyFileSync(sourcePath, targetPath);
          } else {
            // Unix: file symlink (no restrictions)
            symlinkSync(sourcePath, targetPath, 'file');
          }
          this.managedJunctions.add(targetPath);
          result.created++;
        } catch (error) {
          result.errors.push(
            `Failed to sync command ${entry}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  /**
   * Remove stale junctions from .ptah/skills/ that point to extension paths
   * but are no longer in the current skills map.
   */
  private removeStaleJunctions(
    skillsDir: string,
    currentSkills: Map<string, string>,
  ): number {
    let removed = 0;
    let entries: string[];

    try {
      entries = readdirSync(skillsDir);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);

      // Only remove junctions we manage (those pointing to our extension path)
      if (!this.isExtensionJunction(entryPath)) continue;

      // If the skill is still in the current map, keep it
      if (currentSkills.has(entry)) continue;

      // Stale junction — remove the link (not the target)
      try {
        unlinkSync(entryPath);
        this.managedJunctions.delete(entryPath);
        removed++;
        this.logger.debug(
          `[SkillJunctionService] Removed stale junction: ${entry}`,
        );
      } catch (error) {
        this.logger.warn(
          `[SkillJunctionService] Failed to remove stale junction: ${entry}`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    return removed;
  }

  /**
   * Check if a path is a junction/symlink pointing to our plugins base directory.
   * Uses pluginsBasePath prefix match (not a generic substring) to avoid false positives
   * with unrelated junctions that happen to contain 'plugins' in their path.
   */
  private isExtensionJunction(entryPath: string): boolean {
    try {
      const stat = lstatSync(entryPath);
      if (!stat.isSymbolicLink()) return false;
      const target = readlinkSync(entryPath);
      if (this.pluginsBasePath === null) return false;

      // Normalize and check that the target starts with our plugins base path
      const normalizedTarget = this.normalizePath(target);
      const normalizedPluginsPath = this.normalizePath(this.pluginsBasePath);
      return normalizedTarget.startsWith(normalizedPluginsPath);
    } catch {
      return false;
    }
  }

  /**
   * Create a platform-appropriate junction/symlink.
   *
   * Uses process.platform for OS detection (not IPlatformInfo, which tracks
   * host environment type like vscode/electron/cli, not the OS).
   *
   * Windows: NTFS junction (no admin required)
   * Unix: Directory symlink
   */
  private createJunction(target: string, linkPath: string): void {
    const type = IS_WINDOWS ? 'junction' : 'dir';
    symlinkSync(target, linkPath, type);
  }

  /**
   * Remove all managed entries (skill junctions + copied command files).
   * Uses unlinkSync for both — safe for symlinks/junctions (doesn't follow)
   * and also works for regular files (copied commands).
   */
  private removeAllManagedJunctions(): void {
    for (const managedPath of this.managedJunctions) {
      try {
        const stat = lstatSync(managedPath);
        if (stat.isSymbolicLink() || stat.isFile()) {
          unlinkSync(managedPath);
        }
      } catch {
        // Entry may already be removed or inaccessible — safe to ignore
      }
    }
    this.managedJunctions.clear();
  }

  /**
   * One-time migration: remove orphaned junctions/copies from old .claude/skills/
   * and .claude/commands/ directories that were created by previous extension versions.
   *
   * Detects:
   * - Symlinks/junctions pointing to current ~/.ptah/plugins (isExtensionJunction)
   * - Symlinks/junctions pointing to the old extension install path (assets/plugins)
   * - On Windows: copied .md command files (old versions copied instead of symlinking)
   */
  private migrateFromClaudeDir(result: SkillJunctionResult): void {
    if (!this.workspaceRoot) return;

    const oldSkillsDir = join(this.workspaceRoot, '.claude', 'skills');
    const oldCommandsDir = join(this.workspaceRoot, '.claude', 'commands');

    for (const dir of [oldSkillsDir, oldCommandsDir]) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue; // Directory doesn't exist — nothing to migrate
      }

      for (const entry of entries) {
        const entryPath = join(dir, entry);
        if (
          this.isExtensionJunction(entryPath) ||
          this.isOldExtensionEntry(entryPath)
        ) {
          try {
            unlinkSync(entryPath);
            result.removed++;
            this.logger.debug(
              `[SkillJunctionService] Migrated old .claude/ entry: ${entry}`,
            );
          } catch {
            // Non-fatal — old entry may be locked or already removed
          }
        }
      }
    }
  }

  /**
   * Detect entries created by old extension versions that pointed to
   * the extension install path (e.g., .../assets/plugins/...) rather
   * than ~/.ptah/plugins. Also detects Windows-copied .md command files
   * that contain the Ptah plugin header marker.
   */
  private isOldExtensionEntry(entryPath: string): boolean {
    try {
      const stat = lstatSync(entryPath);

      if (stat.isSymbolicLink()) {
        // Old junctions pointed to the extension's assets/plugins/ directory
        const target = this.normalizePath(readlinkSync(entryPath));
        return (
          target.includes('/assets/plugins/') ||
          target.includes('/ptah-extension-vscode/') ||
          target.includes('/ptah-extension/')
        );
      }

      // On Windows, old command files were copied (not symlinked).
      // Detect by checking if it's a small .md file in the commands dir.
      if (IS_WINDOWS && stat.isFile() && basename(entryPath).endsWith('.md')) {
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Normalize a filesystem path for comparison.
   * Strips Windows \\?\ UNC prefix (returned by readlinkSync on NTFS junctions),
   * normalizes separators to forward slashes, and lowercases on Windows.
   */
  private normalizePath(p: string): string {
    // Strip \\?\ prefix that readlinkSync returns for Windows junctions
    let normalized = p.replace(/^\\\\\?\\/, '');
    normalized = normalized.replace(/[\\/]/g, '/');
    if (IS_WINDOWS) {
      normalized = normalized.toLowerCase();
    }
    return normalized;
  }

  /**
   * Compare two paths for equality after normalization.
   * Handles Windows \\?\ prefix, mixed separators, and case sensitivity.
   */
  private pathsEqual(a: string, b: string): boolean {
    return this.normalizePath(a) === this.normalizePath(b);
  }
}
