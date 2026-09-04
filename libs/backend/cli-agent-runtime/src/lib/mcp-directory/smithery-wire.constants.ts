export const SMITHERY_DEFAULT_REGISTRY_BASE = 'https://registry.smithery.ai';

/** Platform API root that serves `/namespaces` and `/connect/...`. */
export const SMITHERY_API_BASE = 'https://api.smithery.ai';

/**
 * Host of the one MCP endpoint per namespace. The session reaches every
 * connection in a namespace through `${host}/<namespace>` with an
 * `Authorization: Bearer <api key>` header; tools arrive prefixed
 * `<connectionId>.<tool>`.
 */
export const SMITHERY_NAMESPACE_MCP_HOST = 'https://mcp.smithery.run';

// The six constants below describe the legacy per-server format, kept for
// records without namespace/connectionId.
export const SMITHERY_DEFAULT_CONNECTION_HOST = 'https://server.smithery.ai';
export const SMITHERY_CONNECTION_PATH_SUFFIX = '/mcp';
export const SMITHERY_CONFIG_QUERY_PARAM = 'config';
export const SMITHERY_API_KEY_QUERY_PARAM = 'api_key';
export const SMITHERY_PROFILE_QUERY_PARAM = 'profile';
export const SMITHERY_PREFER_HEADER_KEY = false;

export const SMITHERY_REQUEST_TIMEOUT_MS = 15_000;
export const SMITHERY_CACHE_TTL_MS = 10 * 60 * 1000;
export const SMITHERY_FIRST_PAGE = 1;
export const SMITHERY_DEFAULT_PAGE_SIZE = 20;

export interface BuildSmitheryUrlInput {
  readonly connectionHost: string;
  readonly qualifiedName: string;
  readonly config: Record<string, unknown>;
  readonly apiKey: string;
  readonly profile?: string;
}

export interface BuiltSmitheryUrl {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/**
 * Local adapter encoding a Smithery hosted-connection URL per the legacy
 * per-server format. Hand-rolled (no `@smithery/sdk` import) so encoding is
 * testable without network. Callers MUST NOT log the returned `url`.
 *
 * Used only for manifest records without `namespace` + `connectionId`. A record
 * created through the Connections API reaches its server through the single
 * namespace endpoint instead (see {@link SMITHERY_NAMESPACE_MCP_HOST}).
 */
export function buildSmitheryUrl(
  input: BuildSmitheryUrlInput,
): BuiltSmitheryUrl {
  const { connectionHost, qualifiedName, config, apiKey, profile } = input;

  const base = connectionHost.endsWith('/')
    ? connectionHost.slice(0, -1)
    : connectionHost;
  const encodedPath = qualifiedName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const url = new URL(
    `${base}/${encodedPath}${SMITHERY_CONNECTION_PATH_SUFFIX}`,
  );

  const encodedConfig = Buffer.from(JSON.stringify(config), 'utf-8').toString(
    'base64',
  );
  url.searchParams.set(SMITHERY_CONFIG_QUERY_PARAM, encodedConfig);

  if (profile) {
    url.searchParams.set(SMITHERY_PROFILE_QUERY_PARAM, profile);
  }

  const headers: Record<string, string> = {};
  if (SMITHERY_PREFER_HEADER_KEY) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    url.searchParams.set(SMITHERY_API_KEY_QUERY_PARAM, apiKey);
  }

  return { url: url.toString(), headers };
}

/** URL of the one MCP endpoint that serves every connection in a namespace. */
export function buildSmitheryNamespaceUrl(
  namespace: string,
  host: string = SMITHERY_NAMESPACE_MCP_HOST,
): string {
  const base = host.endsWith('/') ? host.slice(0, -1) : host;
  return `${base}/${encodeURIComponent(namespace)}`;
}
