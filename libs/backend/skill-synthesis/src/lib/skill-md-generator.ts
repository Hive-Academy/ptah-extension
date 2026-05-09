/**
 * SkillMdGenerator — materializes SKILL.md files for candidates and promoted
 * skills.
 *
 * Frontmatter shape MUST match the plugin discovery format
 * (`libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts`):
 *
 *   ---
 *   name: <kebab-case slug>
 *   description: <one-line description>
 *   ---
 *
 *   <body markdown>
 *
 * Layout:
 *   ~/.ptah/skills/_candidates/<slug>/SKILL.md   (status='candidate')
 *   ~/.ptah/skills/<slug>/SKILL.md               (status='promoted')
 */
import { inject, injectable } from 'tsyringe';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';

const MAX_SLUG_RETRIES = 5;

export interface SkillMdInput {
  /** Desired slug (will be retried with `-2…-5` suffix if collision). */
  slug: string;
  /** Frontmatter description — MUST be a single line, < 200 chars. */
  description: string;
  /** Markdown body. */
  body: string;
  /**
   * Optional agentskills.io `when_to_use` frontmatter field.
   * If omitted, extracted from a `## When to use` section in the body.
   */
  whenToUse?: string;
}

export interface MaterializedSkill {
  /** Final slug used (possibly with collision suffix). */
  slug: string;
  /** Absolute path to the directory holding SKILL.md. */
  dir: string;
  /** Absolute path to the SKILL.md file itself. */
  filePath: string;
}

@injectable()
export class SkillMdGenerator {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /** Root for candidate skills (status='candidate'). */
  candidatesRoot(override?: string): string {
    if (override && override.length > 0) return override;
    return path.join(os.homedir(), '.ptah', 'skills', '_candidates');
  }

  /** Root for active/promoted skills (status='promoted'). */
  activeRoot(): string {
    return path.join(os.homedir(), '.ptah', 'skills');
  }

  /**
   * Write a candidate SKILL.md. Retries with `-2…-5` suffix on slug collision,
   * then throws so the caller can decide (synthesis service warns and skips).
   */
  writeCandidate(
    input: SkillMdInput,
    candidatesDir?: string,
  ): MaterializedSkill {
    const root = this.candidatesRoot(candidatesDir);
    return this.writeAtRoot(input, root);
  }

  /**
   * Move/copy a candidate's SKILL.md to the active root under its slug.
   * Returns the new absolute file path. The original candidate directory is
   * left in place — the candidate row in SQLite is the source of truth, and
   * the file system is just a materialization.
   */
  promoteToActive(
    input: SkillMdInput,
    candidatesDir?: string,
  ): MaterializedSkill {
    // Re-write the SKILL.md fresh at the active root so that we don't depend
    // on a candidate file that may have been edited or removed manually.
    void candidatesDir;
    const root = this.activeRoot();
    return this.writeAtRoot(input, root);
  }

  // ──────────────────────────────────────────────────────────────────

  private writeAtRoot(input: SkillMdInput, root: string): MaterializedSkill {
    fs.mkdirSync(root, { recursive: true });
    const baseSlug = this.sanitizeSlug(input.slug);
    let chosen = baseSlug;
    let dir = path.join(root, chosen);
    for (let attempt = 2; attempt <= MAX_SLUG_RETRIES; attempt++) {
      if (!fs.existsSync(dir)) break;
      chosen = `${baseSlug}-${attempt}`;
      dir = path.join(root, chosen);
      if (attempt === MAX_SLUG_RETRIES && fs.existsSync(dir)) {
        throw new Error(
          `[skill-synthesis] slug collision: ${baseSlug} (tried up to -${MAX_SLUG_RETRIES})`,
        );
      }
    }
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'SKILL.md');
    const content = this.renderSkillMd({
      slug: chosen,
      description: input.description,
      body: input.body,
    });
    fs.writeFileSync(filePath, content, 'utf8');
    this.logger.info('[skill-synthesis] SKILL.md materialized', {
      slug: chosen,
      filePath,
    });
    return { slug: chosen, dir, filePath };
  }

  private renderSkillMd(input: SkillMdInput): string {
    const safeDescription = input.description
      .replace(/[\r\n]+/g, ' ')
      .replace(/"/g, "'")
      .trim();
    const rawWhenToUse = (input.whenToUse ?? this.extractWhenToUse(input.body))
      .replace(/[\r\n]+/g, ' ')
      .trim();

    const lines = [
      '---',
      `name: ${input.slug}`,
      `description: ${safeDescription}`,
    ];

    // Emit when_to_use only when non-empty, always as a double-quoted YAML
    // scalar so colons, quotes, and other special characters can't break parsing.
    if (rawWhenToUse.length > 0) {
      const escaped = rawWhenToUse.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`when_to_use: "${escaped}"`);
    }

    lines.push('---', '', input.body.trim(), '');
    return lines.join('\n');
  }

  /**
   * Extract the content of a `## When to use` section from a markdown body.
   * Bullet items are joined with "; ". Returns empty string if not found.
   */
  private extractWhenToUse(body: string): string {
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

  private sanitizeSlug(slug: string): string {
    const cleaned = slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return cleaned.length > 0 ? cleaned : `skill-${Date.now().toString(36)}`;
  }
}
