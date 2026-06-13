import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SkillShEntry } from '@ptah-extension/shared';
import { z } from 'zod';
import {
  SkillsApiSearchResponseSchema,
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

const BASE_URL = 'https://skills.sh/api';
const REQUEST_TIMEOUT_MS = 15_000;
const SEARCH_TTL_MS = 60 * 1000;
const MAX_LIMIT = 50;

@injectable()
export class SkillsShApiClient {
  private readonly searchCache = new Map<string, CacheEntry<SkillShEntry[]>>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  async search(query: string, limit = MAX_LIMIT): Promise<SkillShEntry[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const cappedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const cacheKey = `${trimmed}::${cappedLimit}`;
    const cached = this.searchCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const path = `/search?q=${encodeURIComponent(trimmed)}&limit=${cappedLimit}`;
    const response = await this.request(path, SkillsApiSearchResponseSchema);
    const skills = response.skills.map((s) => this.toSkillShEntry(s));

    this.searchCache.set(cacheKey, {
      data: skills,
      expires: Date.now() + SEARCH_TTL_MS,
    });
    return skills;
  }

  invalidateInstallCaches(): void {
    this.searchCache.clear();
  }

  private async request<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      skillId: skill.skillId,
      name: this.formatSkillName(skill.skillId),
      description: '',
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
