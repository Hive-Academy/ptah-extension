/**
 * Smithery MCP registry source.
 *
 * Discovery against the Smithery registry (per-server hosted model). Mirrors
 * `McpRegistryProvider`: raw `globalThis.fetch` + 15s AbortController timeout +
 * 10-min cache + permissive Zod `.passthrough()`.
 *
 * SECURITY: never logs the API key or any built URL.
 */

import { z } from 'zod';
import type {
  McpRegistryConnection,
  McpRegistryEntry,
  McpRegistryListResponse,
} from '@ptah-extension/shared';
import type { IMcpRegistrySource } from './mcp-registry-source.interface';
import { SmitheryKeyMissingError } from './smithery-errors';
import {
  SMITHERY_CACHE_TTL_MS,
  SMITHERY_DEFAULT_PAGE_SIZE,
  SMITHERY_DEFAULT_REGISTRY_BASE,
  SMITHERY_FIRST_PAGE,
  SMITHERY_REQUEST_TIMEOUT_MS,
} from './smithery-wire.constants';

/** Optional logger surface — keeps this source DI-free for legacy call sites. */
export interface SmitheryLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface SmitheryRegistrySourceOptions {
  /** Reads the configured key. Resolves `null` when no key is set. */
  getApiKey: () => Promise<string | null>;
  /** Override the registry base URL (for the Batch 0 spike / tests). */
  registryBase?: string;
  logger?: SmitheryLogger;
}

interface CachedResponse<T> {
  data: T;
  cachedAt: number;
}

const SmitheryServerSchema = z
  .object({
    qualifiedName: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().optional(),
    iconUrl: z.string().nullish(),
    useCount: z.number().optional(),
    verified: z.boolean().optional(),
    isDeployed: z.boolean().optional(),
  })
  .passthrough();

const SmitheryConnectionSchema = z
  .object({
    type: z.string().optional(),
    deploymentUrl: z.string().optional(),
    configSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const SmitheryDetailSchema = z
  .object({
    qualifiedName: z.string().min(1),
    displayName: z.string().optional(),
    description: z.string().optional(),
    iconUrl: z.string().nullish(),
    verified: z.boolean().optional(),
    security: z
      .object({ scanPassed: z.boolean().optional() })
      .passthrough()
      .optional(),
    connections: z.array(SmitheryConnectionSchema).optional(),
  })
  .passthrough();

export class SmitheryRegistrySource implements IMcpRegistrySource {
  readonly id = 'smithery' as const;
  readonly requiresApiKey = true;

  private readonly getApiKey: () => Promise<string | null>;
  private readonly registryBase: string;
  private readonly logger?: SmitheryLogger;
  private popularCache: CachedResponse<McpRegistryEntry[]> | null = null;

  constructor(options: SmitheryRegistrySourceOptions) {
    this.getApiKey = options.getApiKey;
    this.registryBase = trimTrailingSlash(
      options.registryBase ?? SMITHERY_DEFAULT_REGISTRY_BASE,
    );
    this.logger = options.logger;
  }

  async listServers(options?: {
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<McpRegistryListResponse> {
    const apiKey = await this.requireApiKey();

    const page = decodePageCursor(options?.cursor);
    const pageSize = options?.limit ?? SMITHERY_DEFAULT_PAGE_SIZE;

    const params = new URLSearchParams();
    params.set('q', options?.query ?? '');
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));

    const url = `${this.registryBase}/servers?${params.toString()}`;
    const response = await this.fetch(url, apiKey);

    if (response.status === 429) {
      this.logger?.warn('Smithery registry rate-limited (429) on list', {
        page,
      });
      return { servers: [] };
    }

    const body = (await response.json()) as Record<string, unknown>;

    const servers: McpRegistryEntry[] = Array.isArray(body['servers'])
      ? (body['servers'] as unknown[])
          .map((item) => this.mapListEntry(item))
          .filter((entry): entry is McpRegistryEntry => entry !== null)
      : [];

    const nextCursor = this.computeNextCursor(body, page, servers.length);

    return { servers, next_cursor: nextCursor };
  }

  async getServerDetails(
    qualifiedName: string,
  ): Promise<McpRegistryEntry | null> {
    const apiKey = await this.requireApiKey();

    const encoded = qualifiedName
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('%2F');
    const url = `${this.registryBase}/servers/${encoded}`;

    try {
      const response = await this.fetch(url, apiKey);
      if (response.status === 404) return null;
      if (response.status === 429) {
        this.logger?.warn('Smithery registry rate-limited (429) on detail');
        return null;
      }

      const body = (await response.json()) as unknown;
      return this.mapDetailEntry(body);
    } catch (error: unknown) {
      this.logger?.warn('Smithery getServerDetails failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getPopular(): Promise<McpRegistryEntry[]> {
    if (
      this.popularCache &&
      Date.now() - this.popularCache.cachedAt < SMITHERY_CACHE_TTL_MS
    ) {
      return this.popularCache.data;
    }
    const result = await this.listServers({ limit: 50 });
    this.popularCache = { data: result.servers, cachedAt: Date.now() };
    return result.servers;
  }

  clearCache(): void {
    this.popularCache = null;
  }

  private async requireApiKey(): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new SmitheryKeyMissingError();
    return apiKey;
  }

  private mapListEntry(item: unknown): McpRegistryEntry | null {
    const parsed = SmitheryServerSchema.safeParse(item);
    if (!parsed.success) {
      this.logger?.warn('Smithery: dropping malformed list entry', {
        issues: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ),
      });
      return null;
    }
    const s = parsed.data;
    return {
      name: s.qualifiedName,
      description: s.displayName
        ? s.description
          ? `${s.displayName} — ${s.description}`
          : s.displayName
        : s.description,
      icons: s.iconUrl ? [{ src: s.iconUrl }] : undefined,
      source: 'smithery',
      verified: s.verified,
    };
  }

  private mapDetailEntry(item: unknown): McpRegistryEntry | null {
    const parsed = SmitheryDetailSchema.safeParse(item);
    if (!parsed.success) {
      this.logger?.warn('Smithery: dropping malformed detail entry', {
        issues: parsed.error.issues.map(
          (i) => `${i.path.join('.')}: ${i.message}`,
        ),
      });
      return null;
    }
    const d = parsed.data;
    const connections: McpRegistryConnection[] | undefined = d.connections?.map(
      (c) => ({ ...c }) as McpRegistryConnection,
    );
    return {
      name: d.qualifiedName,
      description: d.displayName
        ? d.description
          ? `${d.displayName} — ${d.description}`
          : d.displayName
        : d.description,
      icons: d.iconUrl ? [{ src: d.iconUrl }] : undefined,
      source: 'smithery',
      verified: d.verified,
      scanPassed: d.security?.scanPassed,
      connections,
    };
  }

  private computeNextCursor(
    body: Record<string, unknown>,
    page: number,
    pageItemCount: number,
  ): string | undefined {
    const pagination = body['pagination'] as
      | Record<string, unknown>
      | undefined;
    const totalPages =
      typeof pagination?.['totalPages'] === 'number'
        ? (pagination['totalPages'] as number)
        : undefined;

    if (totalPages !== undefined) {
      return page < totalPages ? encodePageCursor(page + 1) : undefined;
    }
    return pageItemCount > 0 ? encodePageCursor(page + 1) : undefined;
  }

  private async fetch(url: string, apiKey: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SMITHERY_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await globalThis.fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'ptah-extension/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 404 && response.status !== 429) {
        throw new Error(
          `Smithery registry request failed: ${response.status} ${response.statusText}`,
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** Smithery pages are 1-indexed; the shared cursor carries the next page. */
function encodePageCursor(page: number): string {
  return String(page);
}

function decodePageCursor(cursor: string | undefined): number {
  if (!cursor) return SMITHERY_FIRST_PAGE;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= SMITHERY_FIRST_PAGE
    ? parsed
    : SMITHERY_FIRST_PAGE;
}
