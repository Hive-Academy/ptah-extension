/**
 * Pure HTTP checks for the MCP server: Host, Origin, Content-Type, and the
 * credential prefix. The request handler calls these before it reads a body.
 */

import { MCP_LEGACY_UNTOKENED_READ_ONLY } from '../mcp-core/mcp-caller-policy';
import {
  authRequiredFailure,
  legacyReadOnlyBinding,
  type McpHttpAuthInput,
  type McpRequestAuth,
} from '../mcp-core/mcp-caller-auth.types';

const TOKEN_LENGTH = 43;
const TOKEN_BODY = `[A-Za-z0-9_-]{${TOKEN_LENGTH}}`;
const AUTH_PREFIX = new RegExp(`^/auth/(${TOKEN_BODY})(?=/|$)`);
const AUTH_TOKEN_GLOBAL = new RegExp(`/auth/(${TOKEN_BODY})(?![A-Za-z0-9_-])`, 'g');
const BEARER = new RegExp(`^Bearer\\s+(${TOKEN_BODY})$`, 'i');

export type HeaderValue = string | string[] | undefined;

export type SplitCredential =
  | { readonly ok: false }
  | {
      readonly ok: true;
      readonly token?: string;
      readonly identityUrl: string;
    };

/** Host must be this process's bound port on a loopback name. */
export function isAllowedHost(hostHeader: HeaderValue, port: number): boolean {
  if (!Number.isInteger(port) || port < 1) return false;
  if (typeof hostHeader !== 'string') return false;
  const host = hostHeader.trim();
  return (
    host === `localhost:${port}` ||
    host === `127.0.0.1:${port}` ||
    host === `[::1]:${port}`
  );
}

/**
 * Any present Origin is rejected. The allowlist is empty, and the header is
 * never reflected. A missing header continues.
 */
export function isRejectedOrigin(origin: HeaderValue): boolean {
  if (origin === undefined) return false;
  if (Array.isArray(origin)) return origin.length > 0;
  return origin.trim() !== '';
}

/** `application/json` with an optional parameter such as `; charset=utf-8`. */
export function isJsonContentType(header: HeaderValue): boolean {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return false;
  const media = raw.split(';')[0]?.trim().toLowerCase();
  return media === 'application/json';
}

/**
 * Bearer header wins when it is the only credential. A leading `/auth/{token}`
 * is used otherwise, then stripped so the existing URL extractors see today's
 * grammar. Both present and different is a failure. A query-string token is
 * ignored. A non-empty Authorization that is not a 43-character bearer fails
 * closed instead of falling through to the legacy path.
 */
export function splitCredential(
  authorization: HeaderValue,
  rawUrl: string | undefined,
): SplitCredential {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  const bearer = readBearer(header);
  if (bearer === 'malformed') return { ok: false };

  const path = rawUrl ?? '/';
  const queryAt = path.indexOf('?');
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const query = queryAt === -1 ? '' : path.slice(queryAt);
  const stripped = stripAuthPrefix(pathname);
  if (
    bearer !== undefined &&
    stripped.token !== undefined &&
    bearer !== stripped.token
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    ...(bearer !== undefined || stripped.token !== undefined
      ? { token: bearer ?? stripped.token }
      : {}),
    identityUrl: `${stripped.pathname}${query}`,
  };
}

/**
 * The single `/auth/{43}` token in a config file, if there is exactly one.
 * Zero or several distinct tokens return undefined so a foreign secret is
 * not treated as ours.
 */
export function extractAuthToken(text: string): string | undefined {
  const found = new Set<string>();
  for (const match of text.matchAll(AUTH_TOKEN_GLOBAL)) {
    const token = match[1];
    if (token !== undefined) found.add(token);
  }
  if (found.size !== 1) return undefined;
  const [only] = found;
  return only;
}

/**
 * Used when the server was started without a registry. A presented token
 * fails closed. A missing token follows the grace switch.
 */
export function authenticateWithoutRegistry(
  input: McpHttpAuthInput,
): McpRequestAuth {
  if (input.token !== undefined || !MCP_LEGACY_UNTOKENED_READ_ONLY) {
    return { ok: false, failure: authRequiredFailure() };
  }
  return { ok: true, legacy: true, binding: legacyReadOnlyBinding(input) };
}

function readBearer(header: string | undefined): string | undefined | 'malformed' {
  if (header === undefined) return undefined;
  const trimmed = header.trim();
  if (trimmed === '') return undefined;
  const match = BEARER.exec(trimmed);
  if (match?.[1] === undefined) return 'malformed';
  return match[1];
}

function stripAuthPrefix(pathname: string): {
  token?: string;
  pathname: string;
} {
  const match = AUTH_PREFIX.exec(pathname);
  if (match?.[1] === undefined) return { pathname };
  const rest = pathname.slice(match[0].length);
  return {
    token: match[1],
    pathname: rest.length === 0 ? '/' : rest,
  };
}
