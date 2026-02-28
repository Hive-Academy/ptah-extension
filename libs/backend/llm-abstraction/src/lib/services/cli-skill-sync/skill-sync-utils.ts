/**
 * Shared Skill Sync Utilities
 * TASK_2025_160: Common utilities for CLI skill installers
 *
 * Extracted from CopilotSkillInstaller and GeminiSkillInstaller
 * to eliminate code duplication (~230 lines duplicated).
 *
 * Contains:
 * - stripAllowedToolsFromFrontmatter: Remove Claude-specific fields from SKILL.md
 * - copyDirectoryRecursive: Safe recursive copy with symlink protection
 * - normalizeCrlf: Normalize Windows CRLF to LF for regex compatibility
 */

import { mkdir, readFile, writeFile, readdir, lstat } from 'fs/promises';
import { join, extname } from 'path';

/** Maximum directory recursion depth to prevent symlink loops */
const MAX_RECURSION_DEPTH = 20;

/**
 * Normalize CRLF line endings to LF.
 * Required for reliable regex matching on Windows where git may
 * check out files with \r\n endings depending on core.autocrlf.
 */
export function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Strip `allowed-tools` field from YAML frontmatter.
 * This field is Claude-specific and has no meaning in other CLIs.
 *
 * Handles:
 * - `allowed-tools: value` (single line)
 * - Both LF and CRLF line endings (normalized before regex)
 * - Preserves all other frontmatter fields
 * - Returns content unchanged if no frontmatter present
 */
export function stripAllowedToolsFromFrontmatter(content: string): string {
  // Normalize CRLF to LF for reliable regex matching on Windows
  const normalized = normalizeCrlf(content);

  // Match YAML frontmatter block
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return normalized;
  }

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const filteredLines = lines.filter(
    (line) => !line.trimStart().startsWith('allowed-tools:')
  );

  // If nothing was filtered, return normalized content
  if (filteredLines.length === lines.length) {
    return normalized;
  }

  const newFrontmatter = filteredLines.join('\n');
  return normalized.replace(frontmatterMatch[0], `---\n${newFrontmatter}\n---`);
}

/**
 * Recursively copy directory contents, stripping allowed-tools from markdown files.
 * Returns count of files copied.
 *
 * Safety features:
 * - Uses lstat() to detect symlinks (prevents symlink loop infinite recursion)
 * - Max recursion depth guard (20 levels)
 * - Skips symlinks entirely
 */
export async function copyDirectoryRecursive(
  sourceDir: string,
  targetDir: string,
  depth = 0
): Promise<number> {
  if (depth > MAX_RECURSION_DEPTH) {
    return 0; // Prevent runaway recursion from symlink loops or deep nesting
  }

  let count = 0;
  const entries = await readdir(sourceDir);

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    // Use lstat() to NOT follow symlinks — prevents infinite loops
    const entryStat = await lstat(sourcePath);

    if (entryStat.isSymbolicLink()) {
      // Skip symlinks entirely for safety
      continue;
    }

    if (entryStat.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      count += await copyDirectoryRecursive(sourcePath, targetPath, depth + 1);
    } else if (entryStat.isFile()) {
      // For markdown files, strip Claude-specific frontmatter fields
      if (extname(entry).toLowerCase() === '.md') {
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
