/**
 * Shared Skill Sync Utilities
 *
 * Extracted from CopilotSkillInstaller and GeminiSkillInstaller
 * to eliminate code duplication (~230 lines duplicated).
 *
 * Contains:
 * - stripAllowedToolsFromFrontmatter: Remove Claude-specific fields from SKILL.md
 * - copyDirectoryRecursive: Safe recursive copy with symlink protection
 * - normalizeCrlf: Normalize Windows CRLF to LF for regex compatibility
 */

import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  stat,
  rm,
} from 'fs/promises';
import { join, extname } from 'path';
import {
  mergeAgentsRegion,
  PTAH_AGENTS_REGION_BEGIN,
  PTAH_AGENTS_REGION_END,
  type AgentBody,
} from '@ptah-extension/shared';

/** Maximum directory recursion depth to prevent symlink loops */
const MAX_RECURSION_DEPTH = 20;

/** Manifest file recording which workspace entries Ptah owns (provenance, not name). */
export const CLI_MANAGED_MANIFEST = '.ptah-managed.json';

export {
  mergeAgentsRegion,
  PTAH_AGENTS_REGION_BEGIN,
  PTAH_AGENTS_REGION_END,
  type AgentBody,
};

/** Per-kind list of managed entry names (folder/file basenames) Ptah wrote. */
export interface CliManagedManifest {
  skills?: string[];
  commands?: string[];
  agents?: string[];
}

type ManagedKind = keyof CliManagedManifest;

/**
 * Normalize CRLF line endings to LF.
 * Required for reliable regex matching on Windows where git may
 * check out files with \r\n endings depending on core.autocrlf.
 */
export function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Detect whether the input content uses CRLF line endings.
 * Returns true if CRLF is present, false otherwise.
 *
 * Used to restore the original line-ending style after frontmatter
 * transformations, so we don't silently convert files between LF/CRLF on
 * round-trip writes (which would create noisy git diffs on Windows).
 */
function hasCrlf(content: string): boolean {
  return content.includes('\r\n');
}

/**
 * Restore CRLF line endings if the original content used them.
 * Operates on LF-normalized output: replaces all `\n` with `\r\n`.
 * No-op if `originalUsedCrlf` is false.
 */
function restoreCrlf(normalized: string, originalUsedCrlf: boolean): string {
  return originalUsedCrlf ? normalized.replace(/\n/g, '\r\n') : normalized;
}

/**
 * Strip `allowed-tools` field from YAML frontmatter.
 * This field is Claude-specific and has no meaning in other CLIs.
 *
 * Handles:
 * - `allowed-tools: value` (single line)
 * - Both LF and CRLF line endings (normalized before regex, restored on output)
 * - Preserves all other frontmatter fields
 * - Returns content unchanged if no frontmatter present
 */
export function stripAllowedToolsFromFrontmatter(content: string): string {
  const originalUsedCrlf = hasCrlf(content);
  const normalized = normalizeCrlf(content);
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return restoreCrlf(normalized, originalUsedCrlf);
  }

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const filteredLines = lines.filter(
    (line) => !line.trimStart().startsWith('allowed-tools:'),
  );
  if (filteredLines.length === lines.length) {
    return restoreCrlf(normalized, originalUsedCrlf);
  }

  const newFrontmatter = filteredLines.join('\n');
  const result = normalized.replace(
    frontmatterMatch[0],
    `---\n${newFrontmatter}\n---`,
  );
  return restoreCrlf(result, originalUsedCrlf);
}

/**
 * Ensure YAML description values containing colons are properly quoted.
 *
 * Strict YAML parsers (e.g., Codex's Rust-based serde_yaml) treat bare
 * colons followed by a space as mapping value indicators. Claude Code's
 * lenient JS parser tolerates unquoted colons, but other CLIs do not.
 *
 * This function finds `description: value` lines where the value contains
 * `: ` (colon-space) and wraps the value in double quotes if not already
 * quoted. Existing single-quoted values are also left unchanged.
 */
export function sanitizeYamlDescriptions(content: string): string {
  const originalUsedCrlf = hasCrlf(content);
  const normalized = normalizeCrlf(content);

  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return restoreCrlf(normalized, originalUsedCrlf);
  }

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const sanitizedLines = lines.map((line) => {
    const descMatch = line.match(/^(\s*description:\s*)(.+)$/);
    if (!descMatch) {
      return line;
    }

    const prefix = descMatch[1];
    const value = descMatch[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return line;
    }
    if (value.includes(': ')) {
      const escaped = value.replace(/"/g, '\\"');
      return `${prefix}"${escaped}"`;
    }

    return line;
  });

  const newFrontmatter = sanitizedLines.join('\n');
  const result = normalized.replace(
    frontmatterMatch[0],
    `---\n${newFrontmatter}\n---`,
  );
  return restoreCrlf(result, originalUsedCrlf);
}

/**
 * Rewrite the `name:` field in YAML frontmatter to match the target folder name.
 *
 * CLIs like Copilot validate that the skill name in SKILL.md matches the
 * containing folder name. When we copy skills into `ptah-{skillName}/`,
 * the name field must be updated to `ptah-{skillName}` accordingly.
 *
 * @param content - SKILL.md content (LF-normalized)
 * @param newName - The target folder name (e.g., "ptah-orchestration")
 * @returns Content with updated name field, or unchanged if no frontmatter
 */
export function rewriteSkillName(content: string, newName: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return content;
  }

  const frontmatter = frontmatterMatch[1];
  const lines = frontmatter.split('\n');
  const updatedLines = lines.map((line) => {
    const nameMatch = line.match(/^(\s*name:\s*)(.+)$/);
    if (!nameMatch) {
      return line;
    }
    return `${nameMatch[1]}${newName}`;
  });
  if (updatedLines.every((line, i) => line === lines[i])) {
    return content;
  }

  const newFrontmatter = updatedLines.join('\n');
  return content.replace(frontmatterMatch[0], `---\n${newFrontmatter}\n---`);
}

/**
 * Recursively copy directory contents, stripping allowed-tools from markdown files.
 * Returns count of files copied.
 *
 * @param options.skillFolderName - If provided, rewrites the `name:` field in
 *   SKILL.md files to match this folder name (for CLI name/folder validation).
 *
 * Safety features:
 * - Uses lstat() to detect symlinks (prevents symlink loop infinite recursion)
 * - Max recursion depth guard (20 levels)
 * - Skips symlinks entirely
 */
export async function copyDirectoryRecursive(
  sourceDir: string,
  targetDir: string,
  depth = 0,
  skillFolderName?: string,
): Promise<number> {
  if (depth > MAX_RECURSION_DEPTH) {
    return 0; // Prevent runaway recursion from symlink loops or deep nesting
  }

  let count = 0;
  const entries = await readdir(sourceDir);

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const entryStat = await lstat(sourcePath);

    if (entryStat.isSymbolicLink()) {
      continue;
    }

    if (entryStat.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      count += await copyDirectoryRecursive(
        sourcePath,
        targetPath,
        depth + 1,
        skillFolderName,
      );
    } else if (entryStat.isFile()) {
      if (extname(entry).toLowerCase() === '.md') {
        const content = await readFile(sourcePath, 'utf8');
        const stripped = stripAllowedToolsFromFrontmatter(content);
        const sanitized = sanitizeYamlDescriptions(stripped);
        const processed =
          skillFolderName && entry.toUpperCase() === 'SKILL.MD'
            ? rewriteSkillName(sanitized, skillFolderName)
            : sanitized;
        await writeFile(targetPath, processed, 'utf8');
      } else {
        const content = await readFile(sourcePath);
        await writeFile(targetPath, content);
      }
      count++;
    }
  }

  return count;
}

export async function readManagedManifest(
  dir: string,
): Promise<CliManagedManifest> {
  try {
    const raw = await readFile(join(dir, CLI_MANAGED_MANIFEST), 'utf8');
    const parsed = JSON.parse(raw) as CliManagedManifest;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeManagedManifest(
  dir: string,
  manifest: CliManagedManifest,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, CLI_MANAGED_MANIFEST),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

function manifestHas(
  manifest: CliManagedManifest,
  kind: ManagedKind,
  name: string,
): boolean {
  return (manifest[kind] ?? []).includes(name);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export interface WorkspaceSkillCopyResult {
  filesCopied: number;
  skipped: boolean;
  skipReason?: 'foreign';
}

export async function copyWorkspaceSkill(
  sourceSkillDir: string,
  skillsBaseDir: string,
  skillFolderName: string,
  manifest: CliManagedManifest,
): Promise<WorkspaceSkillCopyResult> {
  const targetDir = join(skillsBaseDir, skillFolderName);
  const exists = await pathExists(targetDir);
  if (exists && !manifestHas(manifest, 'skills', skillFolderName)) {
    return { filesCopied: 0, skipped: true, skipReason: 'foreign' };
  }

  await mkdir(targetDir, { recursive: true });
  const filesCopied = await copyDirectoryRecursive(
    sourceSkillDir,
    targetDir,
    0,
    skillFolderName,
  );
  return { filesCopied, skipped: false };
}

export interface WorkspaceCommandCopyResult {
  written: boolean;
  skipped: boolean;
  skipReason?: 'foreign';
}

export async function copyWorkspaceCommandMd(
  sourceFile: string,
  commandsBaseDir: string,
  fileName: string,
  manifest: CliManagedManifest,
): Promise<WorkspaceCommandCopyResult> {
  const targetFile = join(commandsBaseDir, fileName);
  const exists = await pathExists(targetFile);
  if (exists && !manifestHas(manifest, 'commands', fileName)) {
    return { written: false, skipped: true, skipReason: 'foreign' };
  }
  await mkdir(commandsBaseDir, { recursive: true });
  const content = await readFile(sourceFile, 'utf8');
  await writeFile(targetFile, content, 'utf8');
  return { written: true, skipped: false };
}

export async function writeWorkspaceCommandToml(
  sourceFile: string,
  commandsBaseDir: string,
  commandName: string,
  manifest: CliManagedManifest,
): Promise<WorkspaceCommandCopyResult> {
  const fileName = `${commandName}.toml`;
  const targetFile = join(commandsBaseDir, fileName);
  const exists = await pathExists(targetFile);
  if (exists && !manifestHas(manifest, 'commands', fileName)) {
    return { written: false, skipped: true, skipReason: 'foreign' };
  }
  await mkdir(commandsBaseDir, { recursive: true });
  const mdBody = await readFile(sourceFile, 'utf8');
  await writeFile(targetFile, emitGeminiCommandToml(mdBody), 'utf8');
  return { written: true, skipped: false };
}

function stripCommandFrontmatter(content: string): string {
  const normalized = normalizeCrlf(content);
  const match = normalized.match(/^---\n[\s\S]*?\n---\n?/);
  return match ? normalized.slice(match[0].length) : normalized;
}

export function emitGeminiCommandToml(mdBody: string): string {
  const body = stripCommandFrontmatter(mdBody).replace(/\n+$/, '');
  const escaped = body.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  return `prompt = """\n${escaped}\n"""\n`;
}

export async function reapPrefixedHomeEntries(
  dir: string,
  prefixes: string[],
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (prefixes.some((p) => entry.startsWith(p))) {
      await rm(join(dir, entry), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}

export async function reapExactEntries(
  dir: string,
  names: string[],
): Promise<number> {
  if (names.length === 0) {
    return 0;
  }
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  const wanted = new Set(names);
  let removed = 0;
  for (const entry of entries) {
    if (wanted.has(entry)) {
      await rm(join(dir, entry), { recursive: true, force: true });
      removed++;
    }
  }
  return removed;
}
