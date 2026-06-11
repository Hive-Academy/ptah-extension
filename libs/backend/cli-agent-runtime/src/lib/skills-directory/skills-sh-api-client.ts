import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { SkillShEntry } from '@ptah-extension/shared';
import { z } from 'zod';
import {
  SECRET_KEY,
  SkillsApiSearchResponseSchema,
  SkillsApiLeaderboardResponseSchema,
  SkillsApiCuratedResponseSchema,
  type SkillsApiSkill,
} from './skills-sh-api.schema';

export class SkillsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SkillsApiError';
  }
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const BASE_URL = 'https://skills.sh/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;
const SEARCH_TTL_MS = 60 * 1000;
const LISTING_TTL_MS = 10 * 60 * 1000;

@injectable()
export class SkillsShApiClient {
  private readonly searchCache = new Map<string, CacheEntry<SkillShEntry[]>>();
  private popularCache: CacheEntry<SkillShEntry[]> | null = null;
  private curatedCache: CacheEntry<SkillShEntry[]> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.SECRET_STORAGE)
    private readonly secretStorage: ISecretStorage,
  ) {}

  async hasKey(): Promise<boolean> {
    const key = await this.secretStorage.get(SECRET_KEY);
    return typeof key === 'string' && key.trim().length > 0;
  }

  async search(query: string, limit = 50): Promise<SkillShEntry[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const cacheKey = `${trimmed}::${limit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const path = `/skills/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`;
    const response = await this.request(path, SkillsApiSearchResponseSchema);
    const skills = response.data.map((s) => this.toSkillShEntry(s));

    this.searchCache.set(cacheKey, {
      data: skills,
      expires: Date.now() + SEARCH_TTL_MS,
    });
    return skills;
  }

  async getPopular(
    view: 'hot' | 'trending' | 'all-time' = 'hot',
  ): Promise<SkillShEntry[]> {
    if (this.popularCache && this.popularCache.expires > Date.now()) {
      return this.popularCache.data;
    }

    const path = `/skills?view=${view}&page=0&per_page=100`;
    const response = await this.request(
      path,
      SkillsApiLeaderboardResponseSchema,
    );
    const skills = response.data.map((s) => this.toSkillShEntry(s));

    this.popularCache = {
      data: skills,
      expires: Date.now() + LISTING_TTL_MS,
    };
    return skills;
  }

  async getCurated(): Promise<SkillShEntry[]> {
    if (this.curatedCache && this.curatedCache.expires > Date.now()) {
      return this.curatedCache.data;
    }

    const response = await this.request(
      '/skills/curated',
      SkillsApiCuratedResponseSchema,
    );
    const flattened: SkillShEntry[] = [];
    for (const owner of response.data) {
      for (const skill of owner.skills) {
        flattened.push(this.toSkillShEntry(skill));
      }
    }

    this.curatedCache = {
      data: flattened,
      expires: Date.now() + LISTING_TTL_MS,
    };
    return flattened;
  }

  invalidateInstallCaches(): void {
    this.popularCache = null;
    this.curatedCache = null;
  }

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const apiKey = await this.secretStorage.get(SECRET_KEY);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new SkillsApiError('Skills.sh API key is not configured');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SkillsApiError(`Skills.sh request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new SkillsApiError(
        `Skills.sh ${path} returned ${response.status}`,
        response.status,
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
      skillId: skill.slug,
      name: skill.name,
      description: '',
      installs: skill.installs,
      isInstalled: false,
      id: skill.id,
      slug: skill.slug,
      sourceType: skill.sourceType,
      url: skill.url,
      installUrl: skill.installUrl ?? undefined,
    };
  }
}
