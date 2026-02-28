/**
 * Copilot CLI Skill Installer
 * TASK_2025_160: Copies Ptah plugin skills to ~/.copilot/skills/ptah-{pluginId}/
 *
 * Pattern: Implements ICliSkillInstaller with fs/promises for file operations.
 * Evidence: GeminiCliAdapter.configureMcpServer() at gemini-cli.adapter.ts:193-229
 * uses the same homedir() + mkdir + writeFile pattern.
 *
 * Only copies the `skills/` subtree from each plugin directory.
 * Does NOT copy `.claude-plugin/` or `commands/` (Claude SDK-specific).
 * Strips `allowed-tools` from SKILL.md frontmatter during copy (Claude-specific field).
 */

import { mkdir, readFile, writeFile, readdir, stat, rm } from 'fs/promises';
import { homedir } from 'os';
import { join, basename, extname } from 'path';
import type { CliSkillSyncStatus } from '@ptah-extension/shared';
import type { ICliSkillInstaller } from './cli-skill-installer.interface';

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

          // Check if skills/ directory exists in plugin
          let skillsDirStat;
          try {
            skillsDirStat = await stat(skillsSourceDir);
          } catch {
            // No skills/ directory in this plugin, skip
            continue;
          }

          if (!skillsDirStat.isDirectory()) {
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
              const skillSourceStat = await stat(skillSourcePath);

              if (!skillSourceStat.isDirectory()) {
                continue;
              }

              const skillTargetPath = join(targetDir, skillDirName);
              await mkdir(skillTargetPath, { recursive: true });

              // Recursively copy skill directory contents
              const copied = await this.copyDirectoryRecursive(
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
        // Skills directory doesn't exist, nothing to uninstall
        return;
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

  /**
   * Recursively copy directory contents, stripping allowed-tools from SKILL.md files.
   * Returns count of files copied.
   */
  private async copyDirectoryRecursive(
    sourceDir: string,
    targetDir: string
  ): Promise<number> {
    let count = 0;
    const entries = await readdir(sourceDir);

    for (const entry of entries) {
      const sourcePath = join(sourceDir, entry);
      const targetPath = join(targetDir, entry);
      const entryStat = await stat(sourcePath);

      if (entryStat.isDirectory()) {
        await mkdir(targetPath, { recursive: true });
        count += await this.copyDirectoryRecursive(sourcePath, targetPath);
      } else if (entryStat.isFile()) {
        // For SKILL.md files, strip Claude-specific frontmatter fields
        if (
          entry.toUpperCase() === 'SKILL.MD' ||
          extname(entry).toLowerCase() === '.md'
        ) {
          const content = await readFile(sourcePath, 'utf8');
          const processed = stripAllowedToolsFromFrontmatter(content);
          await writeFile(targetPath, processed, 'utf8');
        } else {
          // Binary/other files: direct copy via read+write
          const content = await readFile(sourcePath);
          await writeFile(targetPath, content);
        }
        count++;
      }
    }

    return count;
  }
}

/**
 * Strip `allowed-tools` field from YAML frontmatter.
 * This field is Claude-specific and has no meaning in other CLIs.
 *
 * Handles:
 * - `allowed-tools: value` (single line)
 * - Preserves all other frontmatter fields
 * - Returns content unchanged if no frontmatter present
 */
function stripAllowedToolsFromFrontmatter(content: string): string {
  // Match YAML frontmatter block
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return content;
  }

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const filteredLines = lines.filter(
    (line) => !line.trimStart().startsWith('allowed-tools:')
  );

  // If nothing was filtered, return original
  if (filteredLines.length === lines.length) {
    return content;
  }

  const newFrontmatter = filteredLines.join('\n');
  return content.replace(
    frontmatterMatch[0],
    `---\n${newFrontmatter}\n---`
  );
}
