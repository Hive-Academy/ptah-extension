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
  private userSkillsRoot: string | null = null;
  private userCommandsRoot: string | null = null;

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
   * Point junction creation at the user layer (~/.ptah/user/) instead of the
   * plugin directories. When set, buildSkillsMap reads skills from skillsRoot
   * as the sole source (ignoring pluginPaths + synthesizedSkillsRoot, since the
   * mirror has already unified plugin + synth skills under the user layer), and
   * command sync reads from commandsRoot.
   *
   * Driven from the activation layer (which owns UserLayerMirrorService); this
   * service takes plain string paths so agent-sdk never imports agent-generation.
   * Leaving these unset preserves the original plugin-path behavior for
   * backward-compatible / migration callers.
   */
  setSourceRoots(skillsRoot: string, commandsRoot?: string): void {
    this.userSkillsRoot = skillsRoot;
    this.userCommandsRoot = commandsRoot ?? null;
    this.logger.debug(
      '[SkillJunctionService] Source roots swapped to user layer',
      {
        userSkillsRoot: this.userSkillsRoot,
        userCommandsRoot: this.userCommandsRoot,
      },
    );
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
    this.migrateFromPtahDir(result);
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
    result.removed = this.removeStaleJunctions(skillsDir, skillsMap);
    for (const [skillName, sourcePath] of skillsMap) {
      const linkPath = join(skillsDir, skillName);

      try {
        let existingStat: Stats | null = null;
        try {
          existingStat = lstatSync(linkPath);
        } catch {
          existingStat = null;
        }

        if (existingStat) {
          if (existingStat.isSymbolicLink()) {
            const existingTarget = readlinkSync(linkPath);
            if (this.pathsEqual(existingTarget, sourcePath)) {
              this.managedJunctions.add(linkPath);
              continue;
            }

            try {
              const resolvedStat = statSync(linkPath);
              if (resolvedStat.isDirectory()) {
                this.logger.debug(
                  `[SkillJunctionService] Skipping ${skillName}: valid symlink already exists (likely SDK-created)`,
                  { linkPath, existingTarget },
                );
                result.skipped++;
                continue;
              }
            } catch {
              /* */
            }
            unlinkSync(linkPath);
          } else if (existingStat.isDirectory()) {
            this.logger.debug(
              `[SkillJunctionService] Skipping ${skillName}: real directory exists (likely SDK-created)`,
              { linkPath },
            );
            result.skipped++;
            continue;
          } else {
            this.logger.debug(
              `[SkillJunctionService] Skipping ${skillName}: non-directory entry exists`,
              { linkPath },
            );
            result.skipped++;
            continue;
          }
        }
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
    this.workspaceFolderDisposer?.();

    const disposable = this.workspaceProvider.onDidChangeWorkspaceFolders(
      () => {
        try {
          this.logger.debug(
            '[SkillJunctionService] Workspace folders changed, re-creating junctions',
          );
          this.removeAllManagedJunctions();
          this.workspaceRoot =
            this.workspaceProvider.getWorkspaceRoot() ?? null;
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
    this.workspaceFolderDisposer?.();
    this.workspaceFolderDisposer = null;
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
      /* */
    }
  }

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

    if (this.userSkillsRoot) {
      return this.buildSkillsMapFromUserLayer(
        this.userSkillsRoot,
        disabledSkillIds,
      );
    }

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
        const skillMdPath = join(entryPath, 'SKILL.md');
        try {
          accessSync(skillMdPath, fsConstants.R_OK);
        } catch {
          continue; // No SKILL.md, not a skill directory
        }
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
    if (this.synthesizedSkillsRoot) {
      const synthSkillsDir = this.synthesizedSkillsRoot;
      let synthEntries: string[];
      try {
        synthEntries = readdirSync(synthSkillsDir);
      } catch {
        synthEntries = []; // Directory may not exist yet — non-fatal
      }

      for (const entry of synthEntries) {
        if (entry === '_candidates') continue;
        if (disabledSkillIds.has(entry)) continue;

        const entryPath = join(synthSkillsDir, entry);
        try {
          const stat = statSync(entryPath);
          if (!stat.isDirectory()) continue;
        } catch {
          continue;
        }
        const skillMdPath = join(entryPath, 'SKILL.md');
        try {
          accessSync(skillMdPath, fsConstants.R_OK);
        } catch {
          continue; // No SKILL.md — not a valid skill
        }

        if (skillsMap.has(entry)) {
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
   * Build the skill map from the user layer (~/.ptah/user/skills/). This is the
   * SOLE source when source roots have been swapped: the mirror has already
   * unified plugin + synthesized skills here, so pluginPaths and the
   * synthesizedSkillsRoot append are intentionally ignored. disabledSkillIds
   * filtering is preserved.
   */
  private buildSkillsMapFromUserLayer(
    userSkillsRoot: string,
    disabledSkillIds: Set<string>,
  ): Map<string, string> {
    const skillsMap = new Map<string, string>();

    let entries: string[];
    try {
      entries = readdirSync(userSkillsRoot);
    } catch {
      return skillsMap; // User layer not yet populated — non-fatal
    }

    for (const entry of entries) {
      const entryPath = join(userSkillsRoot, entry);
      try {
        const stat = statSync(entryPath);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      const skillMdPath = join(entryPath, 'SKILL.md');
      try {
        accessSync(skillMdPath, fsConstants.R_OK);
      } catch {
        continue; // No SKILL.md, not a skill directory
      }
      if (disabledSkillIds.has(entry)) {
        this.logger.debug(
          `[SkillJunctionService] Skipping disabled skill: "${entry}"`,
        );
        continue;
      }

      skillsMap.set(entry, entryPath);
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
    const manifest = this.loadCommandManifest(commandsDir);
    for (const filename of Object.keys(manifest)) {
      this.managedJunctions.add(join(commandsDir, filename));
    }
    const currentCommandSources = new Map<string, string>(); // filename -> sourcePath
    const commandSourceDirs = this.userCommandsRoot
      ? [this.userCommandsRoot]
      : pluginPaths.map((pluginPath) => join(pluginPath, 'commands'));
    for (const pluginCommandsDir of commandSourceDirs) {
      let entries: string[];
      try {
        entries = readdirSync(pluginCommandsDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        if (currentCommandSources.has(entry)) {
          this.logger.warn(
            `[SkillJunctionService] Command name collision: "${entry}" already registered, skipping from ${pluginCommandsDir}`,
          );
        } else {
          currentCommandSources.set(entry, join(pluginCommandsDir, entry));
        }
      }
    }
    for (const [filename] of Object.entries(manifest)) {
      if (!currentCommandSources.has(filename)) {
        const entryPath = join(commandsDir, filename);

        try {
          unlinkSync(entryPath);
          this.managedJunctions.delete(entryPath);
          delete manifest[filename];
          result.removed++;
        } catch {
          /* */
        }
      }
    }

    let existingEntries: string[] = [];
    try {
      existingEntries = readdirSync(commandsDir);
    } catch {
      /* */
    }
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
          /* */
        }
      }
    }
    let manifestDirty = false;
    for (const [filename, sourcePath] of currentCommandSources) {
      const targetPath = join(commandsDir, filename);

      try {
        const sourceStat = statSync(sourcePath);
        const sourceEntry: CommandManifestEntry = {
          source: sourcePath,
          size: sourceStat.size,
          mtimeMs: sourceStat.mtimeMs,
        };
        let existingStat: Stats | null = null;
        try {
          existingStat = lstatSync(targetPath);
        } catch {
          existingStat = null;
        }

        if (existingStat) {
          if (existingStat.isSymbolicLink()) {
            const existingTarget = readlinkSync(targetPath);
            if (this.pathsEqual(existingTarget, sourcePath)) {
              this.managedJunctions.add(targetPath);
              manifest[filename] = sourceEntry;
              manifestDirty = true;
              continue;
            }

            try {
              const resolvedStat = statSync(targetPath);
              if (resolvedStat.isFile()) {
                result.skipped++;
                continue;
              }
            } catch {
              /* */
            }
            unlinkSync(targetPath);
          } else if (manifest[filename]) {
            const prev = manifest[filename];
            if (
              prev.size === sourceEntry.size &&
              prev.mtimeMs === sourceEntry.mtimeMs
            ) {
              this.managedJunctions.add(targetPath);
              continue; // Unchanged, skip re-copy
            }
            unlinkSync(targetPath);
          } else {
            this.logger.debug(
              `[SkillJunctionService] Skipping command ${filename}: user-created file exists`,
              { targetPath },
            );
            result.skipped++;
            continue;
          }
        }
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
      /* */
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
      if (!this.isExtensionJunction(entryPath)) continue;
      if (currentSkills.has(entry)) continue;
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
      if (this.pluginsBasePath !== null) {
        const normalizedPluginsPath = this.normalizePath(this.pluginsBasePath);
        if (normalizedTarget.startsWith(normalizedPluginsPath)) return true;
      }
      if (this.synthesizedSkillsRoot !== null) {
        const normalizedSynthPath = this.normalizePath(
          this.synthesizedSkillsRoot,
        );
        if (normalizedTarget.startsWith(normalizedSynthPath)) return true;
      }
      if (this.userSkillsRoot !== null) {
        const normalizedUserPath = this.normalizePath(this.userSkillsRoot);
        if (normalizedTarget.startsWith(normalizedUserPath)) return true;
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
        /* */
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
            /* */
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
        const target = this.normalizePath(readlinkSync(entryPath));
        return (
          target.includes('/assets/plugins/') ||
          target.includes('/ptah-extension-vscode/') ||
          target.includes('/ptah-extension/')
        );
      }
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
