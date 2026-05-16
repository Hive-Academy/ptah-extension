/**
 * Skill Junction Service
 *
 * Creates filesystem junctions from {workspace}/.claude/skills/{skillName}/
 * to {pluginsBasePath}/{pluginId}/skills/{skillName}/.
 *
 * Uses .claude/ because Claude Code's native skill discovery only looks in
 * {workspace}/.claude/skills/ and {workspace}/.claude/commands/. The SDK's
 * `plugins` option does NOT reliably load skills — filesystem junctions in
 * .claude/ are the proven mechanism (same approach used for CLI tool skills).
 *
 * Also migrates stale junctions from .ptah/ (previous approach that didn't work
 * because Claude Code doesn't discover skills from .ptah/).
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
import * as os from 'os';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
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
 * Manifest file name stored in .claude/commands/ to track which command files
 * were copied by Ptah (vs user-created). On Windows, command files are copies
 * (not symlinks), so without a manifest the service can't distinguish its own
 * files from user files after a restart (the in-memory managedJunctions set is lost).
 */
const COMMANDS_MANIFEST = '.ptah-managed.json';

/** Entry in the command manifest tracking a Ptah-managed command file. */
interface CommandManifestEntry {
  /** Absolute path to the source file in the plugin directory. */
  source: string;
  /** File size in bytes (fast check). */
  size: number;
  /** Source file mtime in ms (catches same-size content changes). */
  mtimeMs: number;
}

/** Manifest mapping command filename to its tracking entry. */
type CommandManifest = Record<string, CommandManifestEntry>;

/** Options for the activate() method */
export interface SkillJunctionActivateOptions {
  pluginPaths: string[];
  disabledSkillIds: string[];
  getPluginPaths: () => string[];
  getDisabledSkillIds: () => string[];
}

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
 * Uses .claude/ because Claude Code's native skill/command discovery
 * only looks in {workspace}/.claude/skills/ and .claude/commands/.
 */
const CLAUDE_WORKSPACE_DIR = '.claude';

/**
 * Old workspace directory used by previous versions.
 * Kept only for migration/cleanup purposes.
 */
const LEGACY_PTAH_WORKSPACE_DIR = '.ptah';

/**
 * Manages workspace .claude/skills/ junctions pointing to extension plugin skill directories.
 *
 * Uses a late-initialized singleton pattern: `initialize()` must be called from
 * main.ts after DI setup to provide the plugins base path. Workspace root is resolved
 * via the injected IWorkspaceProvider.
 */
@injectable()
export class SkillJunctionService {
  private pluginsBasePath: string | null = null;
  private synthesizedSkillsRoot: string | null = null;
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
   * @param synthesizedSkillsRoot - Optional path to synthesized skills directory. Defaults to ~/.ptah/skills/
   */
  initialize(pluginsBasePath: string, synthesizedSkillsRoot?: string): void {
    this.pluginsBasePath = pluginsBasePath;
    this.synthesizedSkillsRoot =
      synthesizedSkillsRoot ?? join(os.homedir(), '.ptah', 'skills');
    this.workspaceRoot = this.workspaceProvider.getWorkspaceRoot() ?? null;
    this.logger.debug('[SkillJunctionService] Initialized', {
      pluginsBasePath,
      synthesizedSkillsRoot: this.synthesizedSkillsRoot,
      workspaceRoot: this.workspaceRoot,
    });
  }

  /**
   * Full activation: create junctions + subscribe to workspace changes.
   * Always subscribes to workspace changes even if no plugins are currently enabled,
   * so junctions are created when the user enables plugins and switches workspaces.
   *
   * @param options - Activation options with plugin paths, disabled skill IDs, and callbacks
   * @returns Junction creation result
   */
  activate(options: SkillJunctionActivateOptions): SkillJunctionResult {
    const result = this.createJunctions(
      options.pluginPaths,
      options.disabledSkillIds,
    );
    this.subscribeToWorkspaceChanges(
      options.getPluginPaths,
      options.getDisabledSkillIds,
    );
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
  createJunctions(
    pluginPaths: string[],
    disabledSkillIds: string[] = [],
  ): SkillJunctionResult {
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

    // One-time migration: move junctions from old .ptah/skills/ to .claude/skills/
    // (previous versions used .ptah/ which Claude Code doesn't discover)
    this.migrateFromPtahDir(result);

    // Build skills map: skillName -> source absolute path
    const skillsMap = this.buildSkillsMap(
      pluginPaths,
      new Set(disabledSkillIds),
    );
    if (skillsMap.size === 0) {
      this.logger.debug(
        '[SkillJunctionService] No skills found in enabled plugins',
      );
      return result;
    }

    // Ensure .claude/skills/ directory exists
    const skillsDir = join(this.workspaceRoot, CLAUDE_WORKSPACE_DIR, 'skills');
    try {
      mkdirSync(skillsDir, { recursive: true });
    } catch (error) {
      result.errors.push(
        `Failed to create .claude/skills/ directory: ${
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
  subscribeToWorkspaceChanges(
    getPluginPaths: () => string[],
    getDisabledSkillIds: () => string[],
  ): void {
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
            this.createJunctions(getPluginPaths(), getDisabledSkillIds());
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

    // Remove all managed junctions and clean up the manifest
    this.removeAllManagedJunctions();
    this.cleanupManifest();

    this.logger.debug('[SkillJunctionService] Deactivated');
  }

  /**
   * Remove the command manifest file from .claude/commands/.
   * Called on deactivation to prevent stale entries from persisting.
   */
  private cleanupManifest(): void {
    if (!this.workspaceRoot) return;
    const manifestPath = join(
      this.workspaceRoot,
      CLAUDE_WORKSPACE_DIR,
      'commands',
      COMMANDS_MANIFEST,
    );
    try {
      unlinkSync(manifestPath);
    } catch {
      // Manifest may not exist — non-fatal
    }
  }

  // ============================================================
  // Private Methods
  // ============================================================

  /**
   * Build a map of skillName -> source absolute path from all enabled plugins.
   * Flat namespace: all skills from all plugins in one map.
   * First plugin wins on collision (logged as warning).
   */
  private buildSkillsMap(
    pluginPaths: string[],
    disabledSkillIds: Set<string> = new Set(),
  ): Map<string, string> {
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

        // Skip disabled skills
        if (disabledSkillIds.has(entry)) {
          this.logger.debug(
            `[SkillJunctionService] Skipping disabled skill: "${entry}"`,
          );
          continue;
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

    // Also scan synthesized skills root (~/.ptah/skills/) if set.
    // Plugin skills take precedence on slug collision.
    if (this.synthesizedSkillsRoot) {
      const synthSkillsDir = this.synthesizedSkillsRoot;
      let synthEntries: string[];
      try {
        synthEntries = readdirSync(synthSkillsDir);
      } catch {
        synthEntries = []; // Directory may not exist yet — non-fatal
      }

      for (const entry of synthEntries) {
        // Explicit guard — skip candidate staging area
        if (entry === '_candidates') continue;
        if (disabledSkillIds.has(entry)) continue;

        const entryPath = join(synthSkillsDir, entry);

        // Validate it's a directory
        try {
          const stat = statSync(entryPath);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }

        // Validate SKILL.md presence
        const skillMdPath = join(entryPath, 'SKILL.md');
        try {
          accessSync(skillMdPath, fsConstants.R_OK);
        } catch {
          continue; // No SKILL.md — not a valid skill
        }

        if (skillsMap.has(entry)) {
          // Plugin skill takes precedence
          this.logger.warn(
            `[SkillJunctionService] Synthesized skill "${entry}" collides with plugin skill — plugin skill takes precedence`,
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
   * Claude Code discovers slash commands from .claude/commands/ in the workspace.
   * This is the primary command discovery mechanism — the SDK's `plugins` option
   * does not reliably load commands.
   *
   * On Linux/macOS: creates file symlinks (updates flow through automatically).
   * On Windows: copies files (file symlinks require Developer Mode). A manifest
   * file (.ptah-managed.json) tracks which files Ptah owns so they can be
   * distinguished from user-created commands and re-copied when the source updates.
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
      CLAUDE_WORKSPACE_DIR,
      'commands',
    );
    try {
      mkdirSync(commandsDir, { recursive: true });
    } catch (error) {
      result.errors.push(
        `Failed to create .claude/commands/ directory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    // Load the manifest of Ptah-managed command files.
    // On Windows, copies lose their identity after restart (in-memory set is gone).
    // The manifest persists ownership so we know which files to update/remove.
    const manifest = this.loadCommandManifest(commandsDir);

    // Rebuild the managedJunctions set from the manifest (restores state after restart)
    for (const filename of Object.keys(manifest)) {
      this.managedJunctions.add(join(commandsDir, filename));
    }

    // Build a set of all command filenames from currently enabled plugins
    const currentCommandSources = new Map<string, string>(); // filename -> sourcePath
    for (const pluginPath of pluginPaths) {
      const pluginCommandsDir = join(pluginPath, 'commands');
      let entries: string[];
      try {
        entries = readdirSync(pluginCommandsDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        if (currentCommandSources.has(entry)) {
          const pluginId = basename(pluginPath);
          this.logger.warn(
            `[SkillJunctionService] Command name collision: "${entry}" already registered, skipping from ${pluginId}`,
          );
        } else {
          currentCommandSources.set(entry, join(pluginCommandsDir, entry));
        }
      }
    }

    // Clean up stale command files (from previously enabled but now disabled plugins)
    for (const [filename] of Object.entries(manifest)) {
      if (!currentCommandSources.has(filename)) {
        const entryPath = join(commandsDir, filename);
        try {
          unlinkSync(entryPath);
          this.managedJunctions.delete(entryPath);
          delete manifest[filename];
          result.removed++;
        } catch {
          /* non-fatal */
        }
      }
    }
    // Also clean symlink-based entries we detect as ours (Unix path, or previous runs)
    try {
      const existingEntries = readdirSync(commandsDir);
      for (const entry of existingEntries) {
        if (entry === COMMANDS_MANIFEST) continue;
        const entryPath = join(commandsDir, entry);
        if (
          !currentCommandSources.has(entry) &&
          this.isExtensionJunction(entryPath)
        ) {
          try {
            unlinkSync(entryPath);
            this.managedJunctions.delete(entryPath);
            result.removed++;
          } catch {
            /* non-fatal */
          }
        }
      }
    } catch {
      /* commandsDir listing failed — non-fatal */
    }

    // Sync each command from enabled plugins
    let manifestDirty = false;
    for (const [filename, sourcePath] of currentCommandSources) {
      const targetPath = join(commandsDir, filename);

      try {
        // Get source file stats for change detection (size + mtime)
        const sourceStat = statSync(sourcePath);
        const sourceEntry: CommandManifestEntry = {
          source: sourcePath,
          size: sourceStat.size,
          mtimeMs: sourceStat.mtimeMs,
        };

        // Check if something already exists at the target
        let existingStat: Stats | null = null;
        try {
          existingStat = lstatSync(targetPath);
        } catch {
          // Doesn't exist — will create
        }

        if (existingStat) {
          if (existingStat.isSymbolicLink()) {
            // Symlink exists — check if it points to the correct source
            const existingTarget = readlinkSync(targetPath);
            if (this.pathsEqual(existingTarget, sourcePath)) {
              this.managedJunctions.add(targetPath);
              manifest[filename] = sourceEntry;
              manifestDirty = true;
              continue; // Already correct
            }
            // Broken or wrong-target symlink — remove and recreate
            try {
              const resolvedStat = statSync(targetPath);
              if (resolvedStat.isFile()) {
                // Valid symlink to a different source — skip (likely user-created)
                result.skipped++;
                continue;
              }
            } catch {
              // Broken symlink — remove
            }
            unlinkSync(targetPath);
          } else if (manifest[filename]) {
            // We own this file (per manifest). Check if source changed.
            const prev = manifest[filename];
            if (
              prev.size === sourceEntry.size &&
              prev.mtimeMs === sourceEntry.mtimeMs
            ) {
              this.managedJunctions.add(targetPath);
              continue; // Unchanged, skip re-copy
            }
            // Source changed — re-copy
            unlinkSync(targetPath);
          } else {
            // Real file exists that we don't own — user-created, never touch it
            this.logger.debug(
              `[SkillJunctionService] Skipping command ${filename}: user-created file exists`,
              { targetPath },
            );
            result.skipped++;
            continue;
          }
        }

        // Create the command file
        if (IS_WINDOWS) {
          copyFileSync(sourcePath, targetPath);
        } else {
          symlinkSync(sourcePath, targetPath, 'file');
        }
        this.managedJunctions.add(targetPath);
        manifest[filename] = sourceEntry;
        manifestDirty = true;
        result.created++;
      } catch (error) {
        result.errors.push(
          `Failed to sync command ${filename}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Persist the manifest if anything changed
    if (manifestDirty || result.removed > 0) {
      this.saveCommandManifest(commandsDir, manifest);
    }
  }

  /**
   * Load the Ptah command manifest from .claude/commands/.ptah-managed.json.
   * Returns an empty object if the manifest doesn't exist or is corrupt.
   */
  private loadCommandManifest(commandsDir: string): CommandManifest {
    try {
      const raw = readFileSync(join(commandsDir, COMMANDS_MANIFEST), 'utf-8');
      return JSON.parse(raw) as CommandManifest;
    } catch {
      return {};
    }
  }

  /**
   * Persist the Ptah command manifest to .claude/commands/.ptah-managed.json.
   */
  private saveCommandManifest(
    commandsDir: string,
    manifest: CommandManifest,
  ): void {
    try {
      writeFileSync(
        join(commandsDir, COMMANDS_MANIFEST),
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );
    } catch {
      // Non-fatal — manifest is an optimization, not a hard requirement
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
   * Check if a path is a junction/symlink pointing to our plugins base directory
   * or our synthesized skills directory.
   * Uses prefix match (not a generic substring) to avoid false positives.
   */
  private isExtensionJunction(entryPath: string): boolean {
    try {
      const stat = lstatSync(entryPath);
      if (!stat.isSymbolicLink()) return false;
      const target = readlinkSync(entryPath);
      const normalizedTarget = this.normalizePath(target);

      // Check plugins base path (existing)
      if (this.pluginsBasePath !== null) {
        const normalizedPluginsPath = this.normalizePath(this.pluginsBasePath);
        if (normalizedTarget.startsWith(normalizedPluginsPath)) return true;
      }

      // Check synthesized skills root
      if (this.synthesizedSkillsRoot !== null) {
        const normalizedSynthPath = this.normalizePath(
          this.synthesizedSkillsRoot,
        );
        if (normalizedTarget.startsWith(normalizedSynthPath)) return true;
      }

      return false;
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
   * One-time migration: remove orphaned junctions from old .ptah/skills/ and
   * .ptah/commands/ directories that were created by previous extension versions.
   *
   * Previous versions created junctions in .ptah/ instead of .claude/, but
   * Claude Code only discovers skills from .claude/. This migrates by removing
   * the old .ptah/ junctions (new ones are created in .claude/ by createJunctions).
   */
  private migrateFromPtahDir(result: SkillJunctionResult): void {
    if (!this.workspaceRoot) return;

    const oldSkillsDir = join(
      this.workspaceRoot,
      LEGACY_PTAH_WORKSPACE_DIR,
      'skills',
    );
    const oldCommandsDir = join(
      this.workspaceRoot,
      LEGACY_PTAH_WORKSPACE_DIR,
      'commands',
    );

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
              `[SkillJunctionService] Migrated old .ptah/ entry: ${entry}`,
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
   * than ~/.ptah/plugins.
   *
   * On Windows, old command files were copied (not symlinked). We identify
   * them via the old .ptah-managed.json manifest. Only files listed there
   * are treated as ours — user-created .md files are never touched.
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

      // On Windows, old command files were copies. Check the old manifest
      // to confirm ownership rather than deleting all .md files blindly.
      if (IS_WINDOWS && stat.isFile() && basename(entryPath).endsWith('.md')) {
        const dir = join(entryPath, '..');
        const oldManifest = this.loadCommandManifest(dir);
        return basename(entryPath) in oldManifest;
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
