import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SkillShEntry } from '@ptah-extension/shared';
import { z } from 'zod';
import {
  SkillsApiSearchResponseSchema,
  type SkillsApiSkill,
} from './skills-sh-api.schema';
import { SkillsShDescriptionEnricher } from './skills-sh-description.enricher';

export class SkillsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Whether another attempt could plausibly succeed. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'SkillsApiError';
  }
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}

/** One page of marketplace results plus everything needed to page again. */
export interface SkillsShSearchPage {
  skills: SkillShEntry[];
  /** Echo of the window actually applied, after clamping. */
  offset: number;
  limit: number;
  /** True when at least one further row exists past this window. */
  hasMore: boolean;
  /** Present ONLY when the full result set was seen; never estimated. */
  total?: number;
  /**
   * True when the upstream 200-result ceiling was reached, so `total` is
   * unknowable and further pages are unreachable through this API. Narrow the
   * query.
   */
  limitedByUpstream: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BASE_URL = 'https://skills.sh/api';
const REQUEST_TIMEOUT_MS = 15_000;
const SEARCH_TTL_MS = 60 * 1000;

/** Rows returned when the caller names no limit. */
const DEFAULT_LIMIT = 50;

/**
 * The most rows `/api/search` will EVER return for one query, measured
 * 2026-08-24: `limit=500` and `limit=1000` both come back with exactly 200.
 *
 * This is the API's ceiling, not a policy of ours — which matters, because the
 * old hardcoded 50 was ours and was indistinguishable from it. Every response
 * carried `count: 50` with no total and no cursor, so a caller could not tell a
 * complete answer from the first sixth of one.
 */
const UPSTREAM_MAX_RESULTS = 200;

/** Total attempts for an idempotent read before the failure is surfaced. */
const MAX_ATTEMPTS = 3;

/** Backoff before attempt N+1. */
const RETRY_BACKOFF_MS = [300, 900];

/**
 * Statuses worth retrying: rate limiting and server-side faults. A 4xx other
 * than 429 means the request itself is wrong, so repeating it just adds latency.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

@injectable()
export class SkillsShApiClient {
  private readonly searchCache = new Map<string, CacheEntry<SkillShEntry[]>>();

  private readonly enricher: SkillsShDescriptionEnricher;

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {
    this.enricher = new SkillsShDescriptionEnricher(logger);
  }

  /**
   * Search the marketplace.
   *
   * THROWS on failure, deliberately. An empty array here is a real "the
   * marketplace has nothing" answer, and every caller is entitled to read it
   * that way — so a caught network error must never become one.
   */
  async search(query: string, limit = DEFAULT_LIMIT): Promise<SkillShEntry[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];
    // Exactly `limit` rows, no probe row: this form answers "give me the top
    // N", so it has no `hasMore` to observe and should not pay for one.
    return this.fetchRanked(
      trimmed,
      Math.min(Math.max(Math.trunc(limit), 1), UPSTREAM_MAX_RESULTS),
    );
  }

  /**
   * One window of results, with enough around it to page.
   *
   * `/api/search` accepts no `offset`, `page` or `cursor` — all three are
   * accepted and IGNORED, which is worse than rejecting them. What it does
   * accept is an arbitrary `limit`, and its ranking is prefix-stable (the first
   * N of `limit=60` are byte-identical to `limit=5`'s five followed by the
   * next 55). So the window is taken client-side over an over-fetch, which is
   * real pagination rather than a cursor we would have to invent.
   *
   * `total` is only reported when it is KNOWN — when the upstream returned
   * fewer rows than we asked for, which is the one condition that proves the
   * result set is exhausted. Otherwise it is absent rather than guessed.
   */
  async searchPage(
    query: string,
    limit = DEFAULT_LIMIT,
    offset = 0,
  ): Promise<SkillsShSearchPage> {
    const trimmed = query.trim();
    const safeLimit = Math.max(Math.trunc(limit), 1);
    const safeOffset = Math.max(Math.trunc(offset), 0);

    if (trimmed.length < 2) {
      return {
        skills: [],
        offset: safeOffset,
        limit: safeLimit,
        hasMore: false,
        total: 0,
        limitedByUpstream: false,
      };
    }

    // One row past the window, so `hasMore` is observed rather than inferred.
    const requested = Math.min(
      safeOffset + safeLimit + 1,
      UPSTREAM_MAX_RESULTS,
    );
    const rows = await this.fetchRanked(trimmed, requested);

    const exhausted = rows.length < requested;
    const atUpstreamCeiling = !exhausted && requested === UPSTREAM_MAX_RESULTS;
    const skills = rows.slice(safeOffset, safeOffset + safeLimit);

    return {
      skills,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: rows.length > safeOffset + safeLimit,
      // Known only when the upstream ran out. At the 200-row ceiling the true
      // total is unknowable through this API, so it stays absent.
      ...(exhausted ? { total: rows.length } : {}),
      limitedByUpstream: atUpstreamCeiling,
    };
  }

  /** The ranked prefix of `count` results, enriched and cached. */
  private async fetchRanked(
    query: string,
    count: number,
  ): Promise<SkillShEntry[]> {
    const cacheKey = `${query}::${count}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const path = `/search?q=${encodeURIComponent(query)}&limit=${count}`;
    const response = await this.request(path, SkillsApiSearchResponseSchema);
    const skills = response.skills.map((s) => this.toSkillShEntry(s));

    // Best-effort and never fatal: the search result stands on its own if the
    // frontmatter probe finds nothing.
    try {
      await this.enricher.enrich(skills);
    } catch (error: unknown) {
      this.logger.debug('Skills.sh description enrichment failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.searchCache.set(cacheKey, {
      data: skills,
      expires: Date.now() + SEARCH_TTL_MS,
    });
    return skills;
  }

  invalidateInstallCaches(): void {
    this.searchCache.clear();
    this.enricher.clear();
  }

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    let lastError: SkillsApiError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce(path, schema);
      } catch (error: unknown) {
        if (!(error instanceof SkillsApiError) || !error.retryable) throw error;
        lastError = error;
        this.logger.warn('Skills.sh request failed, retrying', {
          path,
          attempt,
          status: error.status,
          error: error.message,
        });
        if (attempt < MAX_ATTEMPTS) {
          await delay(RETRY_BACKOFF_MS[attempt - 1] ?? 900);
        }
      }
    }

    throw (
      lastError ??
      new SkillsApiError(`Skills.sh ${path} failed after ${MAX_ATTEMPTS} tries`)
    );
  }

  private async requestOnce<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Transport-level failures (DNS, reset, abort) are exactly the transient
      // class worth another attempt.
      throw new SkillsApiError(
        `Skills.sh request failed: ${message}`,
        undefined,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    this.logger.debug('Skills.sh request complete', {
      path,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });

    if (!response.ok) {
      throw new SkillsApiError(
        `Skills.sh ${path} returned ${response.status}`,
        response.status,
        isRetryableStatus(response.status),
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillsApiError(`Skills.sh JSON parse failed: ${message}`);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn('Skills.sh response schema mismatch', {
        path,
        issues: parsed.error.issues.slice(0, 3),
      });
      throw new SkillsApiError('Skills.sh response shape was unexpected');
    }
    return parsed.data;
  }

  private toSkillShEntry(skill: SkillsApiSkill): SkillShEntry {
    return {
      source: skill.source,
      skillId: skill.skillId,
      name: this.formatSkillName(skill.skillId),
      description: skill.description ?? '',
      installs: skill.installs,
      isInstalled: false,
      id: skill.id,
      slug: skill.skillId,
      url: `https://skills.sh/${skill.id}`,
    };
  }

  private formatSkillName(slug: string): string {
    return slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
