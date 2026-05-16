/**
 * Skill namespace builder — exposes `ptah.skill.list` and `ptah.skill.describe` as MCP tools.
 *
 * Provides read-only access to promoted skills in ~/.ptah/skills/.
 * Uses node:fs synchronous APIs to avoid async complications during
 * sandboxed code execution. All errors are caught and returned as
 * structured results — never thrown to the caller.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ========================================
// Public Interfaces
// ========================================

/**
 * Represents a promoted skill record discovered in the skills root.
 */
export interface PromotedSkillRecord {
  /** Directory name (slug) under ~/.ptah/skills/ */
  slug: string;
  /** Human-readable description parsed from SKILL.md frontmatter */
  description: string;
  /** Absolute path to the SKILL.md file */
  path: string;
}

/**
 * Dependencies required to build the skill namespace.
 * Uses a factory function so the path is resolved lazily at call time.
 */
export interface SkillNamespaceDependencies {
  /** Returns the absolute path to the skills root directory */
  getSkillsRoot: () => string;
}

/**
 * The ptah.skill namespace interface.
 */
export interface SkillNamespace {
  /**
   * List all promoted skills in the skills root.
   * Returns { skills: [] } when the root directory does not exist — never throws.
   */
  list(): Promise<{ skills: PromotedSkillRecord[] }>;

  /**
   * Read full SKILL.md content for a promoted skill by its slug (directory name).
   * Returns { slug, content } on success, or { error } if not found or unreadable.
   */
  describe(
    skillId: string,
  ): Promise<{ slug: string; content: string } | { error: string }>;
}

// ========================================
// Builder
// ========================================

/**
 * Build the skill namespace with list() and describe() methods.
 *
 * @param deps - Dependencies containing the skills root path factory
 * @returns SkillNamespace implementation
 */
export function buildSkillNamespace(
  deps: SkillNamespaceDependencies,
): SkillNamespace {
  return {
    async list(): Promise<{ skills: PromotedSkillRecord[] }> {
      const skillsRoot = deps.getSkillsRoot();

      // Check if the skills root exists; return empty list rather than an error
      try {
        const stat = fs.statSync(skillsRoot);
        if (!stat.isDirectory()) {
          return { skills: [] };
        }
      } catch {
        // Directory does not exist or is inaccessible — not an error condition
        return { skills: [] };
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
      } catch {
        return { skills: [] };
      }

      const skills: PromotedSkillRecord[] = [];

      for (const entry of entries) {
        // Only process directories; skip _candidates (synthesis staging area)
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name === '_candidates') {
          continue;
        }

        const skillDir = path.join(skillsRoot, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        // Verify SKILL.md exists at the directory root
        try {
          const skillMdStat = fs.statSync(skillMdPath);
          if (!skillMdStat.isFile()) {
            continue;
          }
        } catch {
          // SKILL.md does not exist or is inaccessible — skip this directory
          continue;
        }

        // Parse frontmatter fields from SKILL.md
        let description = '';
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          description = parseFrontmatterDescription(content);
        } catch {
          // Could not read SKILL.md — include the skill with empty description
          description = '';
        }

        skills.push({
          slug: entry.name,
          description,
          path: skillMdPath,
        });
      }

      return { skills };
    },

    async describe(
      skillId: string,
    ): Promise<{ slug: string; content: string } | { error: string }> {
      if (!skillId || /[/\\.]/.test(skillId)) {
        return { error: 'Invalid skill ID: ' + skillId };
      }

      const skillsRoot = deps.getSkillsRoot();
      const skillMdPath = path.join(skillsRoot, skillId, 'SKILL.md');

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        return { slug: skillId, content };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        // Distinguish "not found" from other read errors for better agent UX
        const isNotFound =
          message.includes('ENOENT') || message.includes('no such file');
        if (isNotFound) {
          return { error: 'Skill not found: ' + skillId };
        }
        return { error: 'Failed to read skill ' + skillId + ': ' + message };
      }
    },
  };
}

// ========================================
// Frontmatter Parser (pure helper)
// ========================================

/**
 * Parse the `description:` field from a SKILL.md frontmatter block.
 *
 * Frontmatter is expected to be between two `---` delimiters at the top of the file.
 * Scans line-by-line for `description: <value>` and returns the trimmed value.
 * Returns an empty string if the field is absent or the frontmatter is malformed.
 *
 * @param content - Raw SKILL.md file content
 * @returns Description string or empty string
 */
function parseFrontmatterDescription(content: string): string {
  const lines = content.split(/\r?\n/);

  // First line must be opening ---
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return '';
  }

  let description = '';
  let inFrontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0) {
      // Opening ---
      inFrontmatter = true;
      continue;
    }

    if (inFrontmatter && line.trim() === '---') {
      // Closing --- — stop scanning
      break;
    }

    if (inFrontmatter) {
      // Match description: <value>
      const descriptionMatch = /^description:\s*(.+)/.exec(line);
      if (descriptionMatch) {
        description = descriptionMatch[1].trim();
      }
    }
  }

  return description;
}
