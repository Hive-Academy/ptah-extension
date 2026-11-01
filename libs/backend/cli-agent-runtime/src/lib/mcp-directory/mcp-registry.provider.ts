/**
 * Official MCP Registry API Client
 *
 * Fetches MCP server metadata from registry.modelcontextprotocol.io
 * No authentication required for read operations.
 */

import { z } from 'zod';
import { MCP_REGISTRY_ERROR_MESSAGES } from '@ptah-extension/shared';
import type {
  McpRegistryEntry,
  McpRegistryListResponse,
} from '@ptah-extension/shared';
import type { IMcpRegistrySource } from './mcp-registry-source.interface';

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1';
const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official';

/** Default page size for listing servers */
const DEFAULT_PAGE_SIZE = 20;

/** Cache TTL for popular servers (10 minutes) */
const POPULAR_CACHE_TTL_MS = 10 * 60 * 1000;

/** HTTP request timeout (30 seconds) — generous for slow links. */
const REQUEST_TIMEOUT_MS = 30_000;

interface CachedResponse<T> {
  data: T;
  cachedAt: number;
}

export class McpRegistryShapeError extends Error {
  readonly code = 'MCP_REGISTRY_SHAPE_UNKNOWN' as const;

  constructor() {
    super(MCP_REGISTRY_ERROR_MESSAGES.MCP_REGISTRY_SHAPE_UNKNOWN);
    this.name = 'McpRegistryShapeError';
  }
}

const McpRegistryInputSchema = z
  .object({
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    format: z.enum(['string', 'number', 'boolean', 'filepath']).optional(),
    value: z.string().optional(),
    isSecret: z.boolean().optional(),
    default: z.string().optional(),
    placeholder: z.string().optional(),
    choices: z.array(z.string()).optional(),
  })
  .passthrough();

const McpRegistryKeyValueInputSchema = McpRegistryInputSchema.extend({
  name: z.string().min(1),
  variables: z.record(z.string(), McpRegistryInputSchema).optional(),
}).passthrough();

const McpRegistryPackageArgumentBaseSchema = McpRegistryInputSchema.extend({
  variables: z.record(z.string(), McpRegistryInputSchema).optional(),
  isRepeated: z.boolean().optional(),
  valueHint: z.string().optional(),
});

const McpRegistryPackageArgumentSchema = z.discriminatedUnion('type', [
  McpRegistryPackageArgumentBaseSchema.extend({
    type: z.literal('positional'),
    name: z.string().optional(),
  }).passthrough(),
  McpRegistryPackageArgumentBaseSchema.extend({
    type: z.literal('named'),
    name: z.string().min(1),
  }).passthrough(),
]);

const McpRegistryPackageTransportSchema = z
  .object({
    type: z.string().min(1),
    url: z.string().optional(),
    headers: z.array(McpRegistryKeyValueInputSchema).optional(),
  })
  .passthrough();

const McpRegistryServerPackageSchema = z
  .object({
    registryType: z.string().min(1),
    identifier: z.string().min(1),
    // The shared mapper reads transport.type without a guard.
    transport: McpRegistryPackageTransportSchema,
    registryBaseUrl: z.string().optional(),
    version: z.string().optional(),
    fileSha256: z.string().optional(),
    runtimeHint: z.string().optional(),
    runtimeArguments: z.array(McpRegistryPackageArgumentSchema).optional(),
    packageArguments: z.array(McpRegistryPackageArgumentSchema).optional(),
    environmentVariables: z.array(McpRegistryKeyValueInputSchema).optional(),
  })
  .passthrough();

const McpRegistryRemoteSchema = z
  .object({
    type: z.string().min(1),
    url: z.string(),
    headers: z.array(McpRegistryKeyValueInputSchema).optional(),
    variables: z.record(z.string(), McpRegistryInputSchema).optional(),
  })
  .passthrough();

const McpRegistryEntrySchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    version: z.string().min(1),
    title: z.string().optional(),
    websiteUrl: z.string().optional(),
    repository: z
      .object({
        url: z.string(),
        source: z.string().optional(),
        id: z.string().optional(),
        subfolder: z.string().optional(),
      })
      .passthrough()
      .optional(),
    icons: z
      .array(
        z
          .object({
            src: z.string(),
            mimeType: z.string().optional(),
            sizes: z.array(z.string()).optional(),
            theme: z.enum(['light', 'dark']).optional(),
          })
          .passthrough(),
      )
      .optional(),
    packages: z.array(McpRegistryServerPackageSchema).optional(),
    remotes: z.array(McpRegistryRemoteSchema).optional(),
  })
  .passthrough();

const McpRegistryEnvelopeSchema = z
  .object({
    server: McpRegistryEntrySchema,
    _meta: z
      .object({
        [OFFICIAL_META_KEY]: z
          .object({
            publishedAt: z.string().optional(),
            updatedAt: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const McpRegistryListSchema = z
  .object({
    servers: z.array(z.unknown()),
    metadata: z
      .object({
        nextCursor: z.string().optional(),
        count: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** Optional logger surface — keeps this provider DI-free for legacy call sites. */
export interface RegistryLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Parse one current `{ server, _meta }` envelope without exposing wire values. */
function unwrapRegistryEntry(
  item: unknown,
  logger?: RegistryLogger,
): McpRegistryEntry | null {
  const parsed = McpRegistryEnvelopeSchema.safeParse(item);
  if (!parsed.success) {
    const server =
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)['server']
        : undefined;
    const maybeName =
      server && typeof server === 'object'
        ? (server as Record<string, unknown>)['name']
        : undefined;
    logger?.warn('MCP registry: dropping malformed entry', {
      name: typeof maybeName === 'string' ? maybeName : undefined,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    });
    return null;
  }

  const officialMeta = parsed.data._meta?.[OFFICIAL_META_KEY];
  return {
    ...parsed.data.server,
    created_at: officialMeta?.publishedAt,
    updated_at: officialMeta?.updatedAt,
    source: 'official',
  } as unknown as McpRegistryEntry;
}

/** Keep the first entry per server name. */
function dedupeByName(entries: McpRegistryEntry[]): McpRegistryEntry[] {
  const seen = new Set<string>();
  const unique: McpRegistryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    unique.push(entry);
  }
  return unique;
}

export class McpRegistryProvider implements IMcpRegistrySource {
  /** Source id for the registry-source registry. */
  readonly id = 'official' as const;

  /** The Official MCP Registry needs no authentication. */
  readonly requiresApiKey = false;

  private popularCache: CachedResponse<McpRegistryEntry[]> | null = null;

  constructor(private readonly logger?: RegistryLogger) {}

  /** Search or list the latest version of each server. */
  async listServers(options?: {
    query?: string;
    limit?: number;
    cursor?: string;
  }): Promise<McpRegistryListResponse> {
    const params = new URLSearchParams();
    params.set('limit', String(options?.limit ?? DEFAULT_PAGE_SIZE));
    params.set('version', 'latest');

    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }
    if (options?.query) {
      params.set('search', options.query);
    }

    const url = `${REGISTRY_BASE_URL}/servers?${params.toString()}`;
    const response = await this.fetch(url);
    const parsedBody = McpRegistryListSchema.safeParse(
      await this.readJson(response),
    );
    if (!parsedBody.success) {
      throw new McpRegistryShapeError();
    }

    const entries = parsedBody.data.servers
      .map((item) => unwrapRegistryEntry(item, this.logger))
      .filter((entry): entry is McpRegistryEntry => entry !== null);
    if (parsedBody.data.servers.length > 0 && entries.length === 0) {
      throw new McpRegistryShapeError();
    }

    return {
      servers: dedupeByName(entries),
      next_cursor: parsedBody.data.metadata.nextCursor,
    };
  }

  /** Get the latest server.json document by its fully qualified name. */
  async getServerDetails(name: string): Promise<McpRegistryEntry | null> {
    const url = `${REGISTRY_BASE_URL}/servers/${encodeURIComponent(name)}/versions/latest`;

    try {
      const response = await this.fetch(url);
      if (response.status === 404) return null;

      const entry = unwrapRegistryEntry(
        await this.readJson(response),
        this.logger,
      );
      if (!entry) {
        throw new McpRegistryShapeError();
      }
      return entry;
      // degradation-audit: optional-capability - null covers not found and
      // unreachable. Shape errors remain visible to the RPC boundary.
    } catch (error: unknown) {
      if (error instanceof McpRegistryShapeError) throw error;
      return null;
    }
  }

  /** Get popular/trending servers. Results are cached for 10 minutes. */
  async getPopular(): Promise<McpRegistryEntry[]> {
    if (
      this.popularCache &&
      Date.now() - this.popularCache.cachedAt < POPULAR_CACHE_TTL_MS
    ) {
      return this.popularCache.data;
    }
    const result = await this.listServers({ limit: 50 });

    this.popularCache = {
      data: result.servers,
      cachedAt: Date.now(),
    };

    return result.servers;
  }

  /** Clear the popular servers cache */
  clearCache(): void {
    this.popularCache = null;
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new McpRegistryShapeError();
    }
  }

  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ptah-extension/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(
          `MCP Registry request failed: ${response.status} ${response.statusText}`,
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
