/**
 * Which materialized directory, if any, is PROVEN to belong to an accepted
 * suggestion, and what the startup reconcile does with the candidate row
 * already holding that slug (TASK_2026_578, the reconcile's rule A1).
 *
 * A suggestion accepted before promotion created a candidate row was written
 * by `SkillMdGenerator.promoteToActive` under its sanitized name, suffixed
 * `-2` … `-5` when that directory was taken. A slug is proven only when it is
 * the suggestion's base slug or one of its suffixes, and either:
 *  - `body-match`: a `kind='skill'` registry row of `authored` or `synth`
 *    holds it, `<activeRoot>/<slug>/SKILL.md` exists, and that file's body,
 *    after the frontmatter, is the suggestion's body; or
 *  - `diverged`: the registry row is `diverged` with no `originPluginId` (a
 *    synthesized skill the user edited, so its body no longer matches) and
 *    `<activeRoot>/<slug>/SKILL.md` exists.
 * A hand-written skill that merely shares the name is never adopted, and a
 * plugin's row (`clone`, or any `originPluginId` on a diverged row) never
 * proves a slug.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SkillRegistryEntry,
  SkillRegistryStore,
} from '../skill-registry.store';
import {
  MERGED_INTO_PREFIX,
  type SkillCandidateRow,
  type SkillSuggestionRow,
} from '../types';

/** `promoteToActive` suffixes a taken slug `-2` … `-5` (`MAX_SLUG_RETRIES`). */
const MATERIALIZED_SLUG_SUFFIXES = [2, 3, 4, 5] as const;

/** Prefix of every retirement reason (`RETIRED_UNUSED_REASON` is one). */
const RETIRED_REASON_PREFIX = 'retired:';

/** Which rule proved the slug (see the file header). */
export type AdoptionProof = 'body-match' | 'diverged';

export type AdoptableSlug =
  | { kind: 'found'; slug: string; filePath: string; proof: AdoptionProof }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; slugs: string[] };

/**
 * What the adopt does with the `skill_candidates` row named after a proven
 * slug (`name` is UNIQUE, so there is at most one):
 *  - `new-row`: none; a row is registered and promoted;
 *  - `link-promoted`: it is promoted; it is linked, nothing is registered;
 *  - `repromote-rejected`: it is `rejected` by any decision other than a
 *    merge or a retirement; it is re-promoted in place (the user accepted
 *    the suggestion);
 *  - `blocked`: it is a live `candidate`, was merged into a suggestion
 *    (`merged-into:*`), or was retired on purpose (`retired:*`); nothing is
 *    adopted.
 */
export type SlugHolderDecision =
  'new-row' | 'link-promoted' | 'repromote-rejected' | 'blocked';

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
  const proven: Array<{
    slug: string;
    filePath: string;
    proof: AdoptionProof;
  }> = [];
  for (const slug of slugs) {
    const entry = registry.getBySlug('skill', slug);
    const filePath = path.join(activeRoot, slug, 'SKILL.md');
    const proof = entry
      ? proveSlug(entry, filePath, suggestion.body, logger)
      : null;
    if (proof) proven.push({ slug, filePath, proof });
  }
  if (proven.length === 0) return { kind: 'missing' };
  if (proven.length > 1) {
    return { kind: 'ambiguous', slugs: proven.map((p) => p.slug) };
  }
  return { kind: 'found', ...proven[0] };
}

/** See {@link SlugHolderDecision}. */
export function slugHolderDecision(
  holder: SkillCandidateRow | null,
): SlugHolderDecision {
  if (!holder) return 'new-row';
  if (holder.status === 'promoted') return 'link-promoted';
  const reason = holder.rejectedReason ?? '';
  if (
    holder.status === 'rejected' &&
    !reason.startsWith(MERGED_INTO_PREFIX) &&
    !reason.startsWith(RETIRED_REASON_PREFIX)
  ) {
    return 'repromote-rejected';
  }
  return 'blocked';
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

/** The rule proving `entry`'s slug, or `null` when none does. */
function proveSlug(
  entry: SkillRegistryEntry,
  filePath: string,
  body: string,
  logger: Logger,
): AdoptionProof | null {
  if (entry.cloneStatus === 'authored' || entry.cloneStatus === 'synth') {
    return holdsBody(filePath, body, logger) ? 'body-match' : null;
  }
  if (entry.cloneStatus === 'diverged' && entry.originPluginId === null) {
    return fileExists(filePath, logger) ? 'diverged' : null;
  }
  return null;
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

/** Whether `filePath` is an existing regular file (a stat error is logged). */
function fileExists(filePath: string, logger: Logger): boolean {
  let exists = false;
  try {
    exists =
      fs.statSync(filePath, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch (err: unknown) {
    logger.warn('[skill-curator] could not read a skill directory', {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return exists;
}
