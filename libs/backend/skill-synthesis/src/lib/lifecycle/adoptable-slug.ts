/**
 * Which materialized directory, if any, is PROVEN to belong to an accepted
 * suggestion (TASK_2026_578, the startup reconcile's rule A1).
 *
 * A suggestion accepted before promotion created a candidate row was written
 * by `SkillMdGenerator.promoteToActive` under its sanitized name, suffixed
 * `-2` … `-5` when that directory was taken. A slug is proven only when all of
 * these hold, so a hand-written skill that merely shares the name is never
 * adopted:
 *  - it is the suggestion's base slug or one of its suffixes;
 *  - a `kind='skill'` registry row of `authored` or `synth` holds it;
 *  - `<activeRoot>/<slug>/SKILL.md` exists;
 *  - that file's body, after the frontmatter, is the suggestion's body.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SkillRegistryStore } from '../skill-registry.store';
import type { SkillSuggestionRow } from '../types';

/** `promoteToActive` suffixes a taken slug `-2` … `-5` (`MAX_SLUG_RETRIES`). */
const MATERIALIZED_SLUG_SUFFIXES = [2, 3, 4, 5] as const;

export type AdoptableSlug =
  | { kind: 'found'; slug: string; filePath: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; slugs: string[] };

/**
 * The one proven directory, `missing` when none is, `ambiguous` when more
 * than one is. Never throws for an unreadable file (logged, not proven).
 */
export function findAdoptableSlug(
  suggestion: SkillSuggestionRow,
  registry: SkillRegistryStore,
  activeRoot: string,
  logger: Logger,
): AdoptableSlug {
  const base = materializedBaseSlug(suggestion.name);
  if (!base) return { kind: 'missing' };
  const slugs = [
    base,
    ...MATERIALIZED_SLUG_SUFFIXES.map((n) => `${base}-${n}`),
  ];
  const proven: Array<{ slug: string; filePath: string }> = [];
  for (const slug of slugs) {
    const entry = registry.getBySlug('skill', slug);
    const filePath = path.join(activeRoot, slug, 'SKILL.md');
    if (
      entry &&
      (entry.cloneStatus === 'authored' || entry.cloneStatus === 'synth') &&
      holdsBody(filePath, suggestion.body, logger)
    ) {
      proven.push({ slug, filePath });
    }
  }
  if (proven.length === 0) return { kind: 'missing' };
  if (proven.length > 1) {
    return { kind: 'ambiguous', slugs: proven.map((p) => p.slug) };
  }
  return { kind: 'found', ...proven[0] };
}

/**
 * The directory slug `promoteToActive` derives from a suggestion name (its
 * `sanitizeSlug`), or `null` where that would fall back to a time-based slug
 * no reconcile can predict.
 */
export function materializedBaseSlug(name: string): string | null {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

/** Whether `filePath` exists and its body (after frontmatter) is `body`. */
function holdsBody(filePath: string, body: string, logger: Logger): boolean {
  let matches = false;
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      const content = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
      matches = content === body.replace(/\r\n/g, '\n').trim();
    }
  } catch (err: unknown) {
    logger.warn('[skill-curator] could not read a skill directory', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return matches;
}
