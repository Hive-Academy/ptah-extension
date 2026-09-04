/**
 * Smithery Connections API client.
 *
 * Smithery's current model is a NAMESPACE that holds named CONNECTIONS. Ptah
 * creates one connection per installed server, and the session reaches every
 * connection in the namespace through the single endpoint
 * `https://mcp.smithery.run/<namespace>`. This replaces the legacy per-server
 * URL, which had no authorization step at all — an install that needed the
 * upstream provider's OAuth simply reported `needs-auth` and stopped.
 *
 * Wire shapes are taken from the published API reference (read 2026-09-03):
 * - `GET  /namespaces`                       → `{ namespaces: [{ name }], pagination }`
 * - `GET  /connect/{ns}`                     → `{ connections: Connection[], nextCursor }`
 * - `GET  /connect/{ns}/{id}`                → `Connection`
 * - `PUT  /connect/{ns}/{id}`                → `Connection` (200 update / 201 create)
 * - `DELETE /connect/{ns}/{id}`              → `{ success: true }`
 *
 * A `Connection.status` is an OBJECT (`{ state, setupUrl?, message?, ... }`),
 * not a bare string. This client flattens it to `status` + `setupUrl` +
 * `statusMessage` so callers never depend on that nesting.
 *
 * SECURITY:
 * - The API key is read through `getApiKey` per call and sent as a bearer
 *   header. It is NEVER logged, and never placed in a URL.
 * - `setupUrl` is a one-time credential. It is returned to the caller but never
 *   logged here.
 */

import { z } from 'zod';
import type { SmitheryConnectionStatus } from '@ptah-extension/shared';
import { SmitheryApiError, SmitheryKeyMissingError } from './smithery-errors';
import {
  SMITHERY_API_BASE,
  SMITHERY_REQUEST_TIMEOUT_MS,
} from './smithery-wire.constants';

/** The `fetch` surface this client needs. Injected so specs stay offline. */
export type SmitheryFetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}>;

/** Optional logger surface — keeps this client DI-light, like its siblings. */
export interface SmitheryConnectionsLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface SmitheryConnectionsClientOptions {
  /** Reads the configured key. Resolves `null` when no key is set. */
  getApiKey: () => Promise<string | null>;
  /** Override the transport (tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: SmitheryFetchLike;
  /** Override the API base (tests). Defaults to {@link SMITHERY_API_BASE}. */
  apiBase?: string;
  logger?: SmitheryConnectionsLogger;
}

/** Body accepted by {@link SmitheryConnectionsClient.upsertConnection}. */
export interface SmitheryUpsertConnectionInput {
  /** Smithery registry qualified name, e.g. `hubspot` or `@owner/server`. */
  server: string;
  /** Human-readable name (1-255 chars). */
  name?: string;
  /** Custom filtering metadata. Ptah always sends `managedBy: 'ptah'`. */
  metadata?: Record<string, unknown>;
}

/**
 * A connection, flattened for Ptah's use. `status` is always one of the six
 * values in `SmitheryConnectionStatus` — an unrecognized `state` becomes
 * `'unknown'` rather than being passed through.
 */
export interface SmitheryConnection {
  connectionId: string;
  name: string;
  status: SmitheryConnectionStatus;
  /** Browser URL that finishes the upstream authorization, when one is needed. */
  setupUrl?: string;
  /** Human-readable detail carried by an `error` state. */
  statusMessage?: string;
  /** Registry qualified name, from Ptah metadata or `serverInfo.name`. */
  server?: string;
  mcpUrl?: string;
  metadata?: Record<string, unknown>;
  iconUrl?: string;
  createdAt?: string;
}

/**
 * Metadata Ptah stamps on every connection it creates, so `listConnections`
 * can tell Ptah's connections from ones the user made elsewhere.
 */
export const SMITHERY_PTAH_METADATA_MARKER = 'ptah';

/** Metadata key holding the registry qualified name Ptah installed. */
const METADATA_SERVER_KEY = 'server';
/** Metadata key holding the owner marker. */
const METADATA_MANAGED_BY_KEY = 'managedBy';

const ConnectionStatusSchema = z
  .object({
    state: z.string().optional(),
    setupUrl: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const ServerInfoSchema = z
  .object({
    name: z.string().optional(),
    title: z.string().optional(),
    version: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const ConnectionSchema = z
  .object({
    connectionId: z.string().min(1),
    name: z.string().optional(),
    transport: z.string().optional(),
    mcpUrl: z.string().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
    iconUrl: z.string().nullish(),
    createdAt: z.string().optional(),
    status: ConnectionStatusSchema.optional(),
    serverInfo: ServerInfoSchema.optional(),
  })
  .passthrough();

const ListConnectionsSchema = z
  .object({
    connections: z.array(ConnectionSchema),
    nextCursor: z.string().nullish(),
  })
  .passthrough();

const NamespacesSchema = z
  .object({
    namespaces: z.array(z.object({ name: z.string() }).passthrough()),
  })
  .passthrough();

/** Every state the API documents, plus Ptah's own `'unknown'` fallback. */
const KNOWN_STATES: readonly SmitheryConnectionStatus[] = [
  'connected',
  'disconnected',
  'auth_required',
  'input_required',
  'error',
];

/**
 * Narrow a wire `status.state` to the shared enum. An absent state, or one
 * Smithery adds after this build, becomes `'unknown'` — callers then show
 * "unknown" instead of an unhandled badge.
 */
export function toSmitheryConnectionStatus(
  state: string | undefined,
): SmitheryConnectionStatus {
  return KNOWN_STATES.find((known) => known === state) ?? 'unknown';
}

/** True when the connection carries Ptah's owner marker. */
export function isPtahManagedConnection(
  connection: Pick<SmitheryConnection, 'metadata'>,
): boolean {
  return (
    connection.metadata?.[METADATA_MANAGED_BY_KEY] ===
    SMITHERY_PTAH_METADATA_MARKER
  );
}

/** Build the metadata Ptah stamps on a connection it owns. */
export function buildPtahConnectionMetadata(
  qualifiedName: string,
): Record<string, unknown> {
  return {
    [METADATA_MANAGED_BY_KEY]: SMITHERY_PTAH_METADATA_MARKER,
    [METADATA_SERVER_KEY]: qualifiedName,
  };
}

export class SmitheryConnectionsClient {
  private readonly getApiKey: () => Promise<string | null>;
  private readonly fetchImpl?: SmitheryFetchLike;
  private readonly apiBase: string;
  private readonly logger?: SmitheryConnectionsLogger;

  constructor(options: SmitheryConnectionsClientOptions) {
    this.getApiKey = options.getApiKey;
    this.fetchImpl = options.fetchImpl;
    this.apiBase = trimTrailingSlash(options.apiBase ?? SMITHERY_API_BASE);
    this.logger = options.logger;
  }

  /**
   * The transport for one call. `globalThis.fetch` is read PER CALL, not
   * captured in the constructor: this client is built once at handler
   * construction and would otherwise hold whatever `fetch` existed then.
   */
  private get fetch(): SmitheryFetchLike {
    const impl =
      this.fetchImpl ??
      (globalThis.fetch as unknown as SmitheryFetchLike | undefined);
    if (!impl) throw new Error('No fetch implementation available');
    return impl;
  }

  /**
   * Namespace names the configured key can reach, in the order the API
   * returned them. The first entry is the account's active namespace.
   */
  async listNamespaces(): Promise<string[]> {
    const body = await this.request('GET', '/namespaces');
    const parsed = NamespacesSchema.safeParse(body);
    if (!parsed.success) {
      this.logger?.warn('Smithery: malformed /namespaces response');
      return [];
    }
    return parsed.data.namespaces.map((entry) => entry.name);
  }

  /** Every connection in a namespace. */
  async listConnections(namespace: string): Promise<SmitheryConnection[]> {
    const body = await this.request(
      'GET',
      `/connect/${encodeURIComponent(namespace)}`,
    );
    const parsed = ListConnectionsSchema.safeParse(body);
    if (!parsed.success) {
      this.logger?.warn('Smithery: malformed connections list response');
      return [];
    }
    return parsed.data.connections.map(mapConnection);
  }

  /** One connection, or null when the namespace or the id does not exist. */
  async getConnection(
    namespace: string,
    connectionId: string,
  ): Promise<SmitheryConnection | null> {
    const body = await this.request(
      'GET',
      connectionPath(namespace, connectionId),
      undefined,
      { treat404AsNull: true },
    );
    if (body === null) return null;
    const parsed = ConnectionSchema.safeParse(body);
    if (!parsed.success) {
      this.logger?.warn('Smithery: malformed connection response');
      return null;
    }
    return mapConnection(parsed.data);
  }

  /**
   * Create or replace a connection. A `PUT` on an existing id also refreshes
   * its `setupUrl`, which is how `openSmitherySetup` obtains a fresh one.
   */
  async upsertConnection(
    namespace: string,
    connectionId: string,
    input: SmitheryUpsertConnectionInput,
  ): Promise<SmitheryConnection> {
    const body = await this.request(
      'PUT',
      connectionPath(namespace, connectionId),
      {
        server: input.server,
        ...(input.name ? { name: input.name } : {}),
        metadata: input.metadata ?? buildPtahConnectionMetadata(input.server),
      },
    );
    const parsed = ConnectionSchema.safeParse(body);
    if (!parsed.success) {
      throw new SmitheryApiError(
        200,
        'Smithery returned a connection body this build cannot read',
      );
    }
    return mapConnection(parsed.data);
  }

  /** Remove a connection. A missing connection is not an error. */
  async deleteConnection(
    namespace: string,
    connectionId: string,
  ): Promise<void> {
    await this.request(
      'DELETE',
      connectionPath(namespace, connectionId),
      undefined,
      { treat404AsNull: true },
    );
  }

  /**
   * One authenticated call. Returns the parsed JSON body, or `null` when the
   * caller asked for a 404 to mean "absent". Throws {@link SmitheryApiError}
   * on any other non-2xx, and {@link SmitheryKeyMissingError} with no key.
   */
  private async request(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    options?: { treat404AsNull?: boolean },
  ): Promise<unknown> {
    const apiKey = await this.getApiKey();
    if (!apiKey) throw new SmitheryKeyMissingError();

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      SMITHERY_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await this.fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': 'ptah-extension/1.0',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      if (response.status === 404 && options?.treat404AsNull) {
        return null;
      }

      if (!response.ok) {
        throw new SmitheryApiError(
          response.status,
          await describeFailure(response, method, path),
        );
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function connectionPath(namespace: string, connectionId: string): string {
  return `/connect/${encodeURIComponent(namespace)}/${encodeURIComponent(
    connectionId,
  )}`;
}

/**
 * A readable failure line. The API answers `{ error, message }` on 4xx; the
 * body is best-effort because a gateway can answer with HTML instead.
 */
async function describeFailure(
  response: { status: number; statusText?: string; json(): Promise<unknown> },
  method: string,
  path: string,
): Promise<string> {
  let detail = '';
  try {
    const body = await response.json();
    if (isPlainObject(body)) {
      const message = body['message'] ?? body['error'];
      if (typeof message === 'string') detail = ` — ${message}`;
    }
  } catch {
    // A non-JSON error body carries nothing worth reporting.
  }
  return `Smithery ${method} ${path} failed: ${response.status} ${
    response.statusText ?? ''
  }`
    .trimEnd()
    .concat(detail);
}

function mapConnection(
  raw: z.infer<typeof ConnectionSchema>,
): SmitheryConnection {
  const metadata = raw.metadata ?? undefined;
  const metadataServer = metadata?.[METADATA_SERVER_KEY];

  return {
    connectionId: raw.connectionId,
    name: raw.name ?? raw.connectionId,
    status: toSmitheryConnectionStatus(raw.status?.state),
    setupUrl: raw.status?.setupUrl,
    statusMessage: raw.status?.message,
    server:
      typeof metadataServer === 'string'
        ? metadataServer
        : raw.serverInfo?.name,
    mcpUrl: raw.mcpUrl ?? undefined,
    metadata,
    iconUrl: raw.iconUrl ?? undefined,
    createdAt: raw.createdAt,
  };
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
