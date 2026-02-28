/**
 * Copilot CLI Skill Installer
 * TASK_2025_160: Copies Ptah plugin skills to ~/.copilot/skills/ptah-{pluginId}/
 *
 * Only copies the `skills/` subtree from each plugin directory.
 * Does NOT copy `.claude-plugin/` or `commands/` (Claude SDK-specific).
 * Strips `allowed-tools` from SKILL.md frontmatter during copy (Claude-specific field).
 */

import { mkdir, readdir, lstat, rm } from 'fs/promises';
import { homedir } from 'os';
import { join, basename } from 'path';
import type { CliSkillSyncStatus } from '@ptah-extension/shared';
import type { ICliSkillInstaller } from './cli-skill-installer.interface';
import { copyDirectoryRecursive } from './skill-sync-utils';

/**
 * Installs Ptah skills into Copilot CLI's user-level discovery directory.
 *
 * Target: ~/.copilot/skills/ptah-{pluginId}/{skillName}/SKILL.md
 * Copilot CLI auto-discovers skills from ~/.copilot/skills/ directory.
 */
export class CopilotSkillInstaller implements ICliSkillInstaller {
  readonly target = 'copilot' as const;

  getSkillsBasePath(): string {
    return join(homedir(), '.copilot', 'skills');
  }

  async install(pluginPaths: string[]): Promise<CliSkillSyncStatus> {
    let skillCount = 0;
    const errors: string[] = [];

    try {
      const basePath = this.getSkillsBasePath();
      await mkdir(basePath, { recursive: true });

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

          // Target: ~/.copilot/skills/ptah-{pluginId}/
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
        error: `Copilot skill install failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
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
