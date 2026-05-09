/**
 * skill-md-migration — idempotent migration of SKILL.md files to the
 * agentskills.io extended frontmatter format (adds `when_to_use:` field).
 *
 * Safe to re-run: files that already contain `when_to_use:` are skipped.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: string[];
}

/**
 * Recursively find all SKILL.md files under `skillsDir`, update frontmatter
 * to include a `when_to_use:` field if absent.
 *
 * @param skillsDir Root directory to search for SKILL.md files.
 * @param logger    Logger for debug/warn messages.
 * @returns Summary of migrated, skipped, and errored files.
 */
export function migrateSkillMdFiles(
  skillsDir: string,
  logger: Logger,
): MigrationResult {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };

  let files: string[];
  try {
    files = findSkillMdFiles(skillsDir);
  } catch (err) {
    // Directory doesn't exist or isn't readable — not an error at startup.
    logger.debug(
      '[skill-synthesis] migrateSkillMdFiles: dir not found or empty',
      {
        skillsDir,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return result;
  }

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Idempotent check — skip if already has when_to_use.
      if (/^when_to_use:/m.test(content)) {
        result.skipped++;
        continue;
      }

      const rewritten = addWhenToUseFrontmatter(content);
      if (rewritten === null) {
        // Could not parse frontmatter — skip safely.
        result.skipped++;
        continue;
      }

      fs.writeFileSync(filePath, rewritten, 'utf8');
      result.migrated++;
      logger.debug('[skill-synthesis] migrated SKILL.md', { filePath });
    } catch (err) {
      const msg = `${filePath}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      logger.warn(
        '[skill-synthesis] migrateSkillMdFiles: error processing file',
        {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  return result;
}

/**
 * Recursively collect all SKILL.md files under `dir`.
 */
function findSkillMdFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      try {
        results.push(...findSkillMdFiles(fullPath));
      } catch {
        // Permission error or broken symlink — skip.
      }
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse existing frontmatter and inject `when_to_use:` after `description:`.
 * Returns the rewritten content, or null if frontmatter cannot be parsed.
 */
function addWhenToUseFrontmatter(content: string): string | null {
  // Match the YAML frontmatter block.
  const fmMatch = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(content);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  const whenToUse = extractWhenToUse(body);

  // Inject when_to_use after the last frontmatter line.
  const newFrontmatter = `${frontmatter}\nwhen_to_use: ${whenToUse}`;

  return `---\n${newFrontmatter}\n---\n${body}`;
}

/**
 * Extract a single-line summary from a `## When to use` section.
 * Returns empty string if the section is not present.
 */
function extractWhenToUse(body: string): string {
  const match = /##\s+When to use\s*\n([\s\S]*?)(?=\n##|\s*$)/i.exec(body);
  if (!match) return '';
  const section = match[1];
  const bullets: string[] = [];
  for (const line of section.split('\n')) {
    const trimmed = line.replace(/^[-*]\s+/, '').trim();
    if (trimmed) bullets.push(trimmed);
  }
  return bullets.join('; ');
}
