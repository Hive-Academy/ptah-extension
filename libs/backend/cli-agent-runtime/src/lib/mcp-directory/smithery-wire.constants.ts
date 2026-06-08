export const SMITHERY_DEFAULT_REGISTRY_BASE = 'https://registry.smithery.ai'; // [VERIFY: research-report-smithery §9]
export const SMITHERY_DEFAULT_CONNECTION_HOST = 'https://server.smithery.ai'; // [VERIFY: research-report-smithery §9]
export const SMITHERY_CONNECTION_PATH_SUFFIX = '/mcp'; // [VERIFY: research-report-smithery §9]
export const SMITHERY_CONFIG_QUERY_PARAM = 'config'; // [VERIFY: research-report-smithery §9]
export const SMITHERY_API_KEY_QUERY_PARAM = 'api_key'; // [VERIFY: research-report-smithery §9] api_key vs apiKey
export const SMITHERY_PROFILE_QUERY_PARAM = 'profile'; // [VERIFY: research-report-smithery §9]
export const SMITHERY_PREFER_HEADER_KEY = false; // [VERIFY: research-report-smithery §9] header acceptance

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
 * Local adapter encoding a Smithery hosted-connection URL per the documented
 * per-server format. Hand-rolled (no `@smithery/sdk` import) so encoding is
 * testable without network; swap this body to `createSmitheryUrl` once Batch 0
 * confirms the SDK signature. Callers MUST NOT log the returned `url`.
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
