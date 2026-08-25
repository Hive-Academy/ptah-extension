/**
 * Skills.sh description enricher.
 *
 * The public `skills.sh/api/search` endpoint returns `id`, `skillId`, `name`,
 * `installs` and `source` — and no description. That is not cosmetic: without
 * one, an agent choosing between `threejs-perf` and `threejs-pro` has only the
 * install count to go on, so the marketplace rewards popularity over fit. Every
 * skill's `SKILL.md` DOES carry a description in its frontmatter, and the
 * `source` field is the `owner/repo` that holds it, so the string is one raw
 * GitHub fetch away.
 *
 * Three rules keep that fetch from becoming a liability:
 *
 * - **Best-effort only.** Every failure leaves the description empty. A
 *   marketplace search must never fail because a repository moved.
 * - **Bounded.** Only the top N entries are probed, two candidate paths each,
 *   all in parallel under one timeout.
 * - **Cached, negatives included.** A repo whose layout we cannot guess is not
 *   re-probed for a day.
 */

import type { SkillShEntry } from '@ptah-extension/shared';

/** `owner/repo`, the only `source` shape that can become a raw GitHub URL. */
const SOURCE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Slug segments; `..` is rejected separately since `.` is legal inside one. */
const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_./-]*$/;

/**
 * Layouts observed in the wild (2026-08-24): `cloudai-x/threejs-skills` keeps
 * skills under `skills/`, other repos keep them at the root. `HEAD` resolves
 * whatever the repository calls its default branch, so neither `main` nor
 * `master` is hardcoded.
 */
const CANDIDATE_PATHS = (skillId: string): string[] => [
  `skills/${skillId}/SKILL.md`,
  `${skillId}/SKILL.md`,
];

const RAW_BASE_URL = 'https://raw.githubusercontent.com';

/** How many of the top results get a description probe. */
const DEFAULT_ENRICH_LIMIT = 8;

/** Per-request timeout. Deliberately shorter than the search request's. */
const REQUEST_TIMEOUT_MS = 6_000;

/** Only the frontmatter block is needed; SKILL.md bodies can be large. */
const MAX_BYTES = 4096;

/** Cache TTL for both hits and misses (24 hours). */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Descriptions longer than this are truncated — this is a picker hint. */
const MAX_DESCRIPTION_LENGTH = 500;

interface CacheEntry {
  description: string;
  expires: number;
}

/**
 * Pull `description` out of a SKILL.md YAML frontmatter block.
 *
 * Handles the plain scalar (`description: text`), the quoted scalar, and the
 * `>-` / `|` block scalar, which is how any description containing a colon has
 * to be written. Returns '' when there is no frontmatter or no description.
 */
export function parseSkillMdDescription(markdown: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown.trimStart());
  if (!match) return '';
  const frontmatter = match[1];
  const lines = frontmatter.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const keyMatch = /^description:\s*(.*)$/.exec(lines[i]);
    if (!keyMatch) continue;

    const inline = keyMatch[1].trim();
    if (inline.length > 0 && !/^[|>][-+]?$/.test(inline)) {
      return unquote(inline).slice(0, MAX_DESCRIPTION_LENGTH);
    }

    // Block scalar — take the indented continuation lines that follow.
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim().length === 0) {
        block.push('');
        continue;
      }
      if (!/^\s/.test(lines[j])) break;
      block.push(lines[j].trim());
    }
    return block.join(' ').trim().slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return '';
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Optional logger surface — matches the one `McpRegistryProvider` accepts. */
export interface EnricherLogger {
  debug(message: string, context?: Record<string, unknown>): void;
}

export class SkillsShDescriptionEnricher {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly logger?: EnricherLogger) {}

  /**
   * Fill in `description` on the entries that lack one, in place.
   *
   * Entries are probed in the order given (the API returns them ranked), so
   * `limit` cuts the tail rather than a random subset.
   */
  async enrich(
    entries: SkillShEntry[],
    limit = DEFAULT_ENRICH_LIMIT,
  ): Promise<void> {
    const candidates = entries
      .filter((entry) => entry.description.trim().length === 0)
      .slice(0, Math.max(0, limit));
    if (candidates.length === 0) return;

    const results = await Promise.allSettled(
      candidates.map((entry) => this.resolveDescription(entry)),
    );

    let filled = 0;
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled' || result.value.length === 0) return;
      candidates[index].description = result.value;
      filled++;
    });

    this.logger?.debug('Skills.sh description enrichment complete', {
      probed: candidates.length,
      filled,
    });
  }

  /** Drop cached descriptions — paired with the client's cache invalidation. */
  clear(): void {
    this.cache.clear();
  }

  private async resolveDescription(entry: SkillShEntry): Promise<string> {
    const cacheKey = `${entry.source}::${entry.skillId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.description;
    }

    let description = '';
    if (
      SOURCE_PATTERN.test(entry.source) &&
      SKILL_ID_PATTERN.test(entry.skillId) &&
      !entry.skillId.split('/').includes('..')
    ) {
      for (const candidate of CANDIDATE_PATHS(entry.skillId)) {
        const markdown = await this.fetchHead(
          `${RAW_BASE_URL}/${entry.source}/HEAD/${candidate}`,
        );
        if (markdown === null) continue;
        description = parseSkillMdDescription(markdown);
        if (description.length > 0) break;
      }
    }

    // Negatives are cached too: a repository whose layout we cannot guess would
    // otherwise cost two failed requests on every search that surfaces it.
    this.cache.set(cacheKey, {
      description,
      expires: Date.now() + CACHE_TTL_MS,
    });
    return description;
  }

  /** Returns the first `MAX_BYTES` of the file, or null on any failure. */
  private async fetchHead(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'text/plain',
          Range: `bytes=0-${MAX_BYTES - 1}`,
        },
        signal: controller.signal,
      });
      if (!response.ok && response.status !== 206) return null;
      const text = await response.text();
      return text.slice(0, MAX_BYTES);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
