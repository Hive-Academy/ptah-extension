/**
 * Gemini CLI Skill Installer
 *
 * Gemini CLI discovers skills from ~/.gemini/skills/{skillName}/SKILL.md
 * (flat structure, one level deep). Unlike Codex which supports nested
 * directories, Gemini requires each skill to be a direct child of the
 * skills/ directory.
 *
 * Deployment: ~/.gemini/skills/ptah-{skillName}/SKILL.md
 * Prefix "ptah-" enables cleanup via uninstall() without touching
 * Gemini's built-in skills.
 */

import {
  access,
  mkdir,
  readdir,
  lstat,
  rm,
  readFile,
  writeFile,
} from 'fs/promises';
import { homedir } from 'os';
import { join, basename } from 'path';
import type { CliSkillSyncStatus } from '@ptah-extension/shared';
import type {
  CliSkillInstallOptions,
  ICliSkillInstaller,
} from './cli-skill-installer.interface';
import { copyDirectoryRecursive } from './skill-sync-utils';

/**
 * Installs Ptah skills into Gemini CLI's user-level discovery directory.
 *
 * Target: ~/.gemini/skills/ptah-{skillName}/SKILL.md
 * Gemini CLI auto-discovers skills from ~/.gemini/skills/ directory
 * but only scans one level deep (no nested plugin directories).
 */
export class GeminiSkillInstaller implements ICliSkillInstaller {
  readonly target = 'gemini' as const;

  getSkillsBasePath(): string {
    return join(homedir(), '.gemini', 'skills');
  }

  getCommandsBasePath(): string {
    return join(homedir(), '.gemini', 'commands');
  }

  async install(
    pluginPaths: string[],
    options?: CliSkillInstallOptions,
  ): Promise<CliSkillSyncStatus> {
    const folderPrefix = options?.folderPrefix ?? 'ptah-';
    const syncCommandsEnabled = options?.syncCommands ?? true;
    const requireSkillMd = options?.requireSkillMdAtRoot ?? false;
    let skillCount = 0;
    const errors: string[] = [];

    try {
      const basePath = this.getSkillsBasePath();
      await mkdir(basePath, { recursive: true });

      // Track which prefixed skill folders are installed in this run
      // so we can remove stale ones afterwards without a delete-all gap.
      const installedFolders = new Set<string>();

      for (const pluginPath of pluginPaths) {
        try {
          const skillsSourceDir = join(pluginPath, 'skills');

          // Check if skills/ directory exists in plugin (use lstat for symlink safety)
          let skillsDirStat;
          try {
            skillsDirStat = await lstat(skillsSourceDir);
          } catch {
            continue; // No skills/ directory in this plugin, skip
          }

          if (!skillsDirStat.isDirectory() || skillsDirStat.isSymbolicLink()) {
            continue;
          }

          // Copy each skill directory FLAT into ~/.gemini/skills/ptah-{skillName}/
          const skillDirs = await readdir(skillsSourceDir);
          for (const skillDirName of skillDirs) {
            try {
              const skillSourcePath = join(skillsSourceDir, skillDirName);
              const skillSourceStat = await lstat(skillSourcePath);

              if (
                !skillSourceStat.isDirectory() ||
                skillSourceStat.isSymbolicLink()
              ) {
                continue;
              }

              if (requireSkillMd) {
                try {
                  await access(join(skillSourcePath, 'SKILL.md'));
                } catch {
                  continue; // Skip directories without a top-level SKILL.md (e.g. _candidates)
                }
              }

              const skillFolderName = `${folderPrefix}${skillDirName}`;
              const skillTargetPath = join(basePath, skillFolderName);
              await mkdir(skillTargetPath, { recursive: true });

              const copied = await copyDirectoryRecursive(
                skillSourcePath,
                skillTargetPath,
                0,
                skillFolderName,
              );
              skillCount += copied;
              installedFolders.add(skillFolderName);
            } catch (skillError) {
              errors.push(
                `Failed to copy skill ${skillDirName}: ${
                  skillError instanceof Error
                    ? skillError.message
                    : String(skillError)
                }`,
              );
            }
          }
        } catch (pluginError) {
          const pluginId = basename(pluginPath);
          errors.push(
            `Failed to process plugin ${pluginId}: ${
              pluginError instanceof Error
                ? pluginError.message
                : String(pluginError)
            }`,
          );
        }
      }

      // Cleanup is scoped to THIS call's prefix bucket only.
      try {
        const existingEntries = await readdir(basePath);
        for (const entry of existingEntries) {
          if (entry.startsWith(folderPrefix) && !installedFolders.has(entry)) {
            const entryPath = join(basePath, entry);
            await rm(entryPath, { recursive: true, force: true });
          }
        }
      } catch {
        // Non-fatal: best-effort cleanup of stale skills
      }

      // Sync command files from plugins
      if (syncCommandsEnabled) {
        await this.syncCommands(pluginPaths, errors);
      }

      return {
        cli: this.target,
        synced: errors.length === 0,
        skillCount,
        lastSyncedAt: new Date().toISOString(),
        error: errors.length > 0 ? errors.join('; ') : undefined,
      };
    } catch (error) {
      return {
        cli: this.target,
        synced: false,
        skillCount: 0,
        error: `Gemini skill install failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async syncCommands(
    pluginPaths: string[],
    errors: string[],
  ): Promise<void> {
    const commandsDir = this.getCommandsBasePath();
    try {
      await mkdir(commandsDir, { recursive: true });
    } catch {
      return;
    }

    // Clean up old ptah- prefixed command files
    try {
      const existing = await readdir(commandsDir);
      for (const entry of existing) {
        if (entry.startsWith('ptah-') && entry.endsWith('.md')) {
          await rm(join(commandsDir, entry), { force: true });
        }
      }
    } catch {
      // Non-fatal
    }

    for (const pluginPath of pluginPaths) {
      const commandsSourceDir = join(pluginPath, 'commands');
      let entries: string[];
      try {
        entries = await readdir(commandsSourceDir);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        try {
          const content = await readFile(
            join(commandsSourceDir, entry),
            'utf8',
          );
          // Prefix with ptah- for cleanup identification
          const targetName = `ptah-${entry}`;
          await writeFile(join(commandsDir, targetName), content, 'utf8');
        } catch (err) {
          errors.push(
            `Failed to copy command ${entry}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }

  async uninstall(): Promise<void> {
    try {
      const basePath = this.getSkillsBasePath();
      let entries;
      try {
        entries = await readdir(basePath);
      } catch {
        return; // Skills directory doesn't exist
      }

      for (const entry of entries) {
        if (entry.startsWith('ptah-') || entry.startsWith('ptahsynth-')) {
          const entryPath = join(basePath, entry);
          await rm(entryPath, { recursive: true, force: true });
        }
      }
    } catch {
      // Non-fatal: best-effort cleanup
    }
  }
}
