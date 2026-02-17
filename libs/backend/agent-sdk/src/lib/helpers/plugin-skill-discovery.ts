/**
 * Plugin Skill Discovery Utility
 *
 * Lightweight utility that reads plugin skill metadata from disk.
 * Used by analysis, generation, and enhancement pipelines to make
 * skill information available in prompts.
 *
 * @module @ptah-extension/agent-sdk/helpers
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Metadata about a single plugin skill.
 */
export interface PluginSkillInfo {
  pluginId: string;
  skillName: string;
  description: string;
}

/**
 * Discover plugin skills from resolved plugin paths.
 *
 * For each plugin path, reads the `skills/` directory and looks for
 * subdirectories containing a `SKILL.md` file. Parses the YAML-style
 * frontmatter to extract skill name and description.
 *
 * @param pluginPaths - Absolute paths to plugin directories
 * @returns Flat list of discovered plugin skills
 */
export function discoverPluginSkills(pluginPaths: string[]): PluginSkillInfo[] {
  const skills: PluginSkillInfo[] = [];

  for (const pluginPath of pluginPaths) {
    try {
      // Derive plugin ID from directory name
      const pluginId = pluginPath.split(/[\\/]/).pop() || 'unknown';
      const skillsDir = join(pluginPath, 'skills');

      let entries: string[];
      try {
        entries = readdirSync(skillsDir);
      } catch {
        // No skills directory — skip this plugin
        continue;
      }

      for (const entry of entries) {
        const entryPath = join(skillsDir, entry);
        try {
          if (!statSync(entryPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const skillMdPath = join(entryPath, 'SKILL.md');
        try {
          const content = readFileSync(skillMdPath, 'utf-8');
          const { name, description } = parseFrontmatter(content);
          if (name) {
            skills.push({
              pluginId,
              skillName: name,
              description: description || name,
            });
          }
        } catch {
          // SKILL.md not readable — skip this skill
        }
      }
    } catch {
      // Plugin path not accessible — skip
    }
  }

  return skills;
}

/**
 * Format discovered skills as a markdown list for prompt injection.
 *
 * @param skills - Discovered plugin skills
 * @returns Formatted markdown string, or empty string if no skills
 */
export function formatSkillsForPrompt(skills: PluginSkillInfo[]): string {
  if (skills.length === 0) return '';

  return skills
    .map(
      (s) => `- **${s.skillName}** (plugin: ${s.pluginId}): ${s.description}`
    )
    .join('\n');
}

/**
 * Parse simple YAML-like frontmatter from a SKILL.md file.
 * Extracts `name` and `description` fields from `---` delimited frontmatter.
 */
function parseFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { name: '', description: '' };

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : '',
    description: descMatch
      ? descMatch[1].trim().replace(/^['"]|['"]$/g, '')
      : '',
  };
}
