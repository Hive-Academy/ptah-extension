/**
 * Base URL policy of a decision endpoint (criteria 2.2, 2.3; D4; DC3, DC11).
 *
 * Pure functions, no I/O. A stored base URL is an absolute `http:`/`https:`
 * URL of at most 2048 characters with no userinfo, query or fragment, so no
 * secret can ride inside it. A key may travel only over `https:` or to a
 * loopback host (D4). Joins keep the base path (`https://host/gw` +
 * `/v1/systemone` -> `https://host/gw/v1/systemone`).
 *
 * This module imports nothing from its siblings, so `decision-model.types.ts`
 * can build its schemas on `EndpointBaseUrlSchema` without an import cycle.
 */
import { z } from 'zod';

export const ENDPOINT_BASE_URL_MAX_LENGTH = 2048;

/**
 * Loopback names (D4): `localhost`, its fully qualified `localhost.`, and the
 * IPv6 loopback, which `URL` reports with brackets (`[::1]`). Other
 * `*.localhost` names are not listed. The webview hint in
 * `decision-model-row.view.ts` keeps the same rule.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.',
  '[::1]',
]);

/**
 * IPv4 127.0.0.0/8. `URL` already serialises every IPv4 spelling (`127.1`,
 * `0x7f.1`, a trailing dot) as a dotted quad of octets 0-255, so only the
 * first octet needs a check; a name such as `127.0.0.1.evil.com` stays a
 * domain and fails the anchors.
 */
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const HTTP_SCHEME = /^https?:\/\//i;

/** Why a raw base URL was refused. Codes only: never the URL itself. */
export type EndpointBaseUrlError =
  | 'empty'
  | 'too-long'
  | 'not-http'
  | 'malformed'
  | 'has-credentials'
  | 'has-query'
  | 'has-fragment';

export type EndpointBaseUrlParseResult =
  | { readonly ok: true; readonly baseUrl: string }
  | { readonly ok: false; readonly error: EndpointBaseUrlError };

/**
 * Fixed issue texts for the schema. None of them repeats the input, which may
 * hold a credential the user pasted by mistake.
 */
const ENDPOINT_BASE_URL_ISSUE: Readonly<Record<EndpointBaseUrlError, string>> =
  {
    empty: 'base URL is empty',
    'too-long': `base URL is longer than ${ENDPOINT_BASE_URL_MAX_LENGTH} characters`,
    'not-http': 'base URL must start with http:// or https://',
    malformed: 'base URL is not a valid URL',
    'has-credentials': 'base URL must not contain a user name or password',
    'has-query': 'base URL must not contain a query',
    'has-fragment': 'base URL must not contain a fragment',
  };

/**
 * Validates a raw base URL and returns its normalised form: the WHATWG
 * serialisation (lower-case scheme and host, default port dropped) without
 * trailing slashes.
 */
export function parseEndpointBaseUrl(raw: string): EndpointBaseUrlParseResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (trimmed.length > ENDPOINT_BASE_URL_MAX_LENGTH) {
    return { ok: false, error: 'too-long' };
  }
  if (!HTTP_SCHEME.test(trimmed)) {
    return { ok: false, error: 'not-http' };
  }
  const authority = authorityOf(trimmed);
  // `@` anywhere in the authority is userinfo, even an empty `http://:@host`.
  if (authority.includes('@')) {
    return { ok: false, error: 'has-credentials' };
  }
  if (authority.length === 0 || !URL.canParse(trimmed)) {
    return { ok: false, error: 'malformed' };
  }
  const url = new URL(trimmed);
  if (url.username !== '' || url.password !== '') {
    return { ok: false, error: 'has-credentials' };
  }
  // A bare `?` or `#` serialises to an empty `search`/`hash`; test the text.
  if (trimmed.includes('?')) {
    return { ok: false, error: 'has-query' };
  }
  if (trimmed.includes('#')) {
    return { ok: false, error: 'has-fragment' };
  }
  return { ok: true, baseUrl: stripTrailingSlashes(url.href) };
}

/**
 * Zod field schema for a custom endpoint base URL. Outputs the normalised
 * base; a refusal is one custom issue with a fixed text (no input echo).
 */
export const EndpointBaseUrlSchema = z.string().transform((raw, ctx) => {
  const parsed = parseEndpointBaseUrl(raw);
  if (!parsed.ok) {
    ctx.addIssue({
      code: 'custom',
      message: ENDPOINT_BASE_URL_ISSUE[parsed.error],
    });
    return z.NEVER;
  }
  return parsed.baseUrl;
});

/** `true` when the URL parses and its host is a loopback host. */
export function isLoopbackBase(url: string): boolean {
  return URL.canParse(url) && isLoopbackHostname(new URL(url).hostname);
}

/** `true` for a `URL.hostname` in 127.0.0.0/8 or in `LOOPBACK_HOSTNAMES`. */
function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname) || LOOPBACK_IPV4.test(hostname);
}

/** D4: a key may be sent only over `https:` or to a loopback host. */
export function keyTransportAllowed(url: string): boolean {
  if (!URL.canParse(url)) {
    return false;
  }
  return new URL(url).protocol === 'https:' || isLoopbackBase(url);
}

/** Path-preserving join (DC11): normalised base followed by `path`. */
export function systemOneUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${stripTrailingSlashes(baseUrl.trim())}${suffix}`;
}

/** `scheme://host[:port]` of the URL, or `null` when it has no such origin. */
export function originOf(url: string): string | null {
  if (!URL.canParse(url)) {
    return null;
  }
  const origin = new URL(url).origin;
  return origin === 'null' ? null : origin;
}

/** Text between `://` and the first `/`, `\`, `?` or `#`. */
function authorityOf(absolute: string): string {
  const rest = absolute.slice(absolute.indexOf('://') + 3);
  const end = rest.search(/[/\\?#]/);
  return end === -1 ? rest : rest.slice(0, end);
}

function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return value.slice(0, end);
}
