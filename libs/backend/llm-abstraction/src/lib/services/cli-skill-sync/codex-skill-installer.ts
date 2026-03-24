/**
 * Codex CLI Skill Installer
 * Copies Ptah plugin skills to ~/.agents/skills/ptah-{pluginId}/
 *
 * Codex CLI auto-discovers skills from ~/.agents/skills/ directory.
 * Same installation pattern as Copilot/Gemini installers.
 */

import { mkdir, readdir, lstat, rm, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join, basename } from 'path';
import type { CliSkillSyncStatus } from '@ptah-extension/shared';
import type { ICliSkillInstaller } from './cli-skill-installer.interface';
import { copyDirectoryRecursive } from './skill-sync-utils';

/**
 * Installs Ptah skills into Codex CLI's user-level discovery directory.
 *
 * Target: ~/.agents/skills/ptah-{pluginId}/{skillName}/SKILL.md
 * Codex CLI auto-discovers skills from ~/.agents/skills/ directory.
 */
export class CodexSkillInstaller implements ICliSkillInstaller {
  readonly target = 'codex' as const;

  getSkillsBasePath(): string {
    return join(homedir(), '.agents', 'skills');
  }

  getCommandsBasePath(): string {
    return join(homedir(), '.agents', 'commands');
  }

  async install(pluginPaths: string[]): Promise<CliSkillSyncStatus> {
    let skillCount = 0;
    const errors: string[] = [];

    try {
      const basePath = this.getSkillsBasePath();
      await mkdir(basePath, { recursive: true });

      // Clean up old ptah- prefixed skills before re-installing
      try {
        const existingEntries = await readdir(basePath);
        for (const entry of existingEntries) {
          if (entry.startsWith('ptah-')) {
            const entryPath = join(basePath, entry);
            await rm(entryPath, { recursive: true, force: true });
          }
        }
      } catch {
        // Non-fatal: best-effort cleanup
      }

      for (const pluginPath of pluginPaths) {
        try {
          const pluginId = basename(pluginPath);
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

          // Target: ~/.agents/skills/ptah-{pluginId}/
          const targetDir = join(basePath, `ptah-${pluginId}`);
          await mkdir(targetDir, { recursive: true });

          // Copy each skill directory
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

              const skillTargetPath = join(targetDir, skillDirName);
              await mkdir(skillTargetPath, { recursive: true });

              const copied = await copyDirectoryRecursive(
                skillSourcePath,
                skillTargetPath
              );
              skillCount += copied;
            } catch (skillError) {
              errors.push(
                `Failed to copy skill ${skillDirName}: ${
                  skillError instanceof Error
                    ? skillError.message
                    : String(skillError)
                }`
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
            }`
          );
        }
      }

      // Sync command files from plugins (TASK_2025_201)
      await this.syncCommands(pluginPaths, errors);

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
        error: `Codex skill install failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async syncCommands(
    pluginPaths: string[],
    errors: string[]
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
            'utf8'
          );
          // Prefix with ptah- for cleanup identification
          const targetName = `ptah-${entry}`;
          await writeFile(join(commandsDir, targetName), content, 'utf8');
        } catch (err) {
          errors.push(
            `Failed to copy command ${entry}: ${
              err instanceof Error ? err.message : String(err)
            }`
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
        if (entry.startsWith('ptah-')) {
          const entryPath = join(basePath, entry);
          await rm(entryPath, { recursive: true, force: true });
        }
      }
    } catch {
      // Non-fatal: best-effort cleanup
    }
  }
}
