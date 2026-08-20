/**
 * The three markdown rewrites a skill needs before a rival CLI will accept it.
 *
 * Carried over from `cli-skill-sync/skill-sync-utils.ts` (cli-agent-runtime,
 * deleted in TASK_2026_278 Batch 2). Each rule exists because a specific CLI
 * rejected a file Claude was happy with:
 *
 * - `allowed-tools` is a Claude-only frontmatter field. Strict frontmatter
 *   validators treat the unknown key as a schema error.
 * - Claude's YAML parser tolerates an unquoted `description:` containing
 *   `colon-space`; Codex's Rust `serde_yaml` reads it as a nested mapping and
 *   fails the whole file.
 * - Copilot validates that a skill's frontmatter `name` matches its containing
 *   folder. Ptah copies by folder slug, which is not always the authored name.
 *
 * The Claude target does NOT use any of this — it copies bytes, so its copies
 * hash equal to their sources. The rival targets transform, which is precisely
 * why their manifest entries carry both a source hash and an output hash.
 *
 * CRLF is detected before the regex work and restored after, so a Windows
 * checkout does not gain a whole-file diff on every reconcile.
 */

/** Normalize CRLF line endings to LF. */
export function normalizeCrlf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

function hasCrlf(content: string): boolean {
  return content.includes('\r\n');
}

function restoreCrlf(normalized: string, originalUsedCrlf: boolean): string {
  return originalUsedCrlf ? normalized.replace(/\n/g, '\r\n') : normalized;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;

/**
 * Rewrite the frontmatter block through `edit`, preserving the original line
 * endings and returning the content untouched when there is no frontmatter or
 * the edit changed nothing.
 */
function editFrontmatter(
  content: string,
  edit: (lines: string[]) => string[],
): string {
  const originalUsedCrlf = hasCrlf(content);
  const normalized = normalizeCrlf(content);
  const match = normalized.match(FRONTMATTER);
  if (match === null) return restoreCrlf(normalized, originalUsedCrlf);

  const lines = match[1].split('\n');
  const edited = edit(lines);
  if (
    edited.length === lines.length &&
    edited.every((line, index) => line === lines[index])
  ) {
    return restoreCrlf(normalized, originalUsedCrlf);
  }

  const replaced = normalized.replace(
    match[0],
    `---\n${edited.join('\n')}\n---`,
  );
  return restoreCrlf(replaced, originalUsedCrlf);
}

/** Drop the Claude-only `allowed-tools` frontmatter field. */
export function stripAllowedToolsFromFrontmatter(content: string): string {
  return editFrontmatter(content, (lines) =>
    lines.filter((line) => !line.trimStart().startsWith('allowed-tools:')),
  );
}

/**
 * Quote a `description:` value that contains `colon-space`, so strict YAML
 * parsers read it as one scalar rather than a nested mapping. Already-quoted
 * values are left alone.
 */
export function sanitizeYamlDescriptions(content: string): string {
  return editFrontmatter(content, (lines) =>
    lines.map((line) => {
      const match = line.match(/^(\s*description:\s*)(.+)$/);
      if (match === null) return line;

      const value = match[2].trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted || !value.includes(': ')) return line;

      return `${match[1]}"${value.replace(/"/g, '\\"')}"`;
    }),
  );
}

/** Force the frontmatter `name` to match the directory the skill is copied into. */
export function rewriteSkillName(content: string, folderName: string): string {
  return editFrontmatter(content, (lines) =>
    lines.map((line) => {
      const match = line.match(/^(\s*name:\s*)(.+)$/);
      return match === null ? line : `${match[1]}${folderName}`;
    }),
  );
}

/**
 * Every markdown rewrite a rival CLI needs, in the order they must run.
 *
 * `rewriteSkillName` applies only to the skill's own `SKILL.md`; reference
 * documents inside the directory keep their own frontmatter.
 */
export function transformSkillMarkdown(
  content: string,
  options: { isSkillManifest: boolean; folderName: string },
): string {
  const sanitized = sanitizeYamlDescriptions(
    stripAllowedToolsFromFrontmatter(content),
  );
  return options.isSkillManifest
    ? rewriteSkillName(sanitized, options.folderName)
    : sanitized;
}

/** True for the file whose frontmatter `name` must equal the folder name. */
export function isSkillManifestFile(fileName: string): boolean {
  return fileName.toUpperCase() === 'SKILL.MD';
}
