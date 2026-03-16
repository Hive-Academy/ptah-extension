/**
 * Skill Junction Service (TASK_2025_201)
 *
 * Creates filesystem junctions from {workspace}/.claude/skills/{skillName}/
 * to {extensionPath}/assets/plugins/{pluginId}/skills/{skillName}/.
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
 * Manages workspace .claude/skills/ junctions pointing to extension plugin skill directories.
 *
 * Uses a late-initialized singleton pattern: `initialize()` must be called from
 * main.ts after DI setup to provide the extension path. Workspace root is resolved
 * via the injected IWorkspaceProvider.
 */
@injectable()
export class SkillJunctionService {
  private extensionPath: string | null = null;
  private workspaceRoot: string | null = null;

  /** Track which junction paths we created, for cleanup */
  private managedJunctions = new Set<string>();

  /** Subscription disposer for workspace folder changes */
  private workspaceFolderDisposer: (() => void) | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider
  ) {}

  /**
   * Late initialization with extension path.
   * Must be called from main.ts after DI setup.
   */
  initialize(extensionPath: string): void {
    this.extensionPath = extensionPath;
    this.workspaceRoot = this.workspaceProvider.getWorkspaceRoot() ?? null;
    this.logger.debug('[SkillJunctionService] Initialized', {
      extensionPath,
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
    getPluginPaths: () => string[]
  ): SkillJunctionResult {
    const result = this.createJunctions(pluginPaths);
    this.subscribeToWorkspaceChanges(getPluginPaths);
    return result;
  }

  /**
   * Create junctions for skills and copy command files from all enabled plugins.
   *
   * Skills: Junctions in {workspace}/.claude/skills/{skillName}/ -> plugin skills dir
   * Commands: Copies to {workspace}/.claude/commands/{commandName}.md (file symlinks
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
        '[SkillJunctionService] No workspace open, skipping junction creation'
      );
      return result;
    }

    // Build skills map: skillName -> source absolute path
    const skillsMap = this.buildSkillsMap(pluginPaths);
    if (skillsMap.size === 0) {
      this.logger.debug(
        '[SkillJunctionService] No skills found in enabled plugins'
      );
      return result;
    }

    // Ensure .claude/skills/ directory exists
    const skillsDir = join(this.workspaceRoot, '.claude', 'skills');
    try {
      mkdirSync(skillsDir, { recursive: true });
    } catch (error) {
      result.errors.push(
        `Failed to create .claude/skills/ directory: ${
          error instanceof Error ? error.message : String(error)
        }`
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
            // Points elsewhere — remove and recreate
            // Use unlinkSync (not rmSync) to safely remove the link without following it
            unlinkSync(linkPath);
          } else if (existingStat.isDirectory()) {
            // Real directory exists — DO NOT touch it
            this.logger.info(
              `[SkillJunctionService] Skipping ${skillName}: real directory exists`,
              { linkPath }
            );
            result.skipped++;
            continue;
          } else {
            // Regular file or other entry — skip with clear message
            this.logger.info(
              `[SkillJunctionService] Skipping ${skillName}: non-directory entry exists`,
              { linkPath }
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
          }`
        );
      }
    }

    // Sync command files from plugins into .claude/commands/
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
            '[SkillJunctionService] Workspace folders changed, re-creating junctions'
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
            { error: error instanceof Error ? error.message : String(error) }
          );
        }
      }
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
            `[SkillJunctionService] Skill name collision: "${entry}" already registered, skipping from ${pluginId}`
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
   * {workspace}/.claude/commands/.
   *
   * On Linux/macOS: creates file symlinks (no restrictions).
   * On Windows: copies files (file symlinks require Developer Mode,
   * unlike directory junctions which work without admin).
   *
   * Tracks created entries in managedJunctions for cleanup on deactivation.
   */
  private syncCommandFiles(
    pluginPaths: string[],
    result: SkillJunctionResult
  ): void {
    if (!this.workspaceRoot) return;

    const commandsDir = join(this.workspaceRoot, '.claude', 'commands');
    try {
      mkdirSync(commandsDir, { recursive: true });
    } catch {
      return; // Can't create commands dir — non-fatal
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
              // Points elsewhere — remove and recreate
              unlinkSync(targetPath);
            } else if (!this.managedJunctions.has(targetPath)) {
              // Real file exists that we didn't create — don't overwrite
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
            }`
          );
        }
      }
    }
  }

  /**
   * Remove stale junctions from .claude/skills/ that point to extension paths
   * but are no longer in the current skills map.
   */
  private removeStaleJunctions(
    skillsDir: string,
    currentSkills: Map<string, string>
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
          `[SkillJunctionService] Removed stale junction: ${entry}`
        );
      } catch (error) {
        this.logger.warn(
          `[SkillJunctionService] Failed to remove stale junction: ${entry}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    return removed;
  }

  /**
   * Check if a path is a junction/symlink pointing to our extension's plugin assets.
   * Uses extensionPath prefix match (not a generic substring) to avoid false positives
   * with unrelated junctions that happen to contain 'assets/plugins' in their path.
   */
  private isExtensionJunction(entryPath: string): boolean {
    try {
      const stat = lstatSync(entryPath);
      if (!stat.isSymbolicLink()) return false;
      const target = readlinkSync(entryPath);
      if (this.extensionPath === null) return false;

      // Normalize and check that the target starts with our extension path
      const normalizedTarget = this.normalizePath(target);
      const normalizedExtPath = this.normalizePath(this.extensionPath);
      return normalizedTarget.startsWith(normalizedExtPath);
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
