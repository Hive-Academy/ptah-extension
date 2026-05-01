/**
 * `proxy-auth` — bearer-token mint + verify for the Anthropic-compatible HTTP
 * proxy (TASK_2026_104 P2).
 *
 * Three responsibilities:
 *   1. Mint a fresh 32-byte (256-bit) random token via `crypto.randomBytes`
 *      and hex-encode it (64 chars). Tokens are NEVER reused across proxy
 *      instances — each `ptah proxy start` mints a new one and discards it
 *      on shutdown.
 *   2. Persist the token to `~/.ptah/proxy/<port>.token` with mode `0o600`
 *      (owner read/write only). Parent directory is created with `0o700`.
 *      Idempotent — overwrites any stale file on bind.
 *   3. Verify inbound bearer tokens via `crypto.timingSafeEqual` so the proxy
 *      doesn't leak token length / prefix through response timing. Returns
 *      `false` on length mismatch to short-circuit before the constant-time
 *      compare (length itself is non-secret).
 *
 * Headers accepted:
 *   - `x-api-key: <token>`           — Anthropic-style (preferred)
 *   - `authorization: Bearer <token>` — RFC 6750 fallback
 *
 * No new npm deps — only `node:crypto`, `node:fs/promises`, `node:os`,
 * `node:path`. Pure helpers — no DI, no logger, fully unit-testable.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

/** Length of the minted token in bytes (256 bits → 64 hex chars). */
const TOKEN_BYTES = 32;

/**
 * Mint a fresh 256-bit hex-encoded bearer token. Cryptographically random —
 * suitable for direct use as a bearer credential without further hashing.
 */
export function mintProxyToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Resolve the absolute on-disk path for a proxy token file.
 *
 * Layout: `<userDataPath>/proxy/<port>.token`
 *
 * `userDataPath` defaults to `~/.ptah` when omitted — matching the default
 * computed by `registerPlatformCliServices` in platform-cli.
 */
export function resolveProxyTokenPath(
  port: number,
  userDataPath: string = path.join(homedir(), '.ptah'),
): string {
  return path.join(userDataPath, 'proxy', `${port}.token`);
}

/**
 * Write the token to disk with mode `0o600`, creating the parent directory
 * with mode `0o700` if missing. Overwrites any stale file at the path.
 *
 * Returns the resolved file path so callers can include it in the
 * `proxy.started` notification.
 */
export async function writeProxyTokenFile(
  token: string,
  port: number,
  userDataPath?: string,
): Promise<string> {
  const tokenPath = resolveProxyTokenPath(port, userDataPath);
  const tokenDir = path.dirname(tokenPath);
  // `recursive: true` is idempotent if the directory already exists. Mode
  // is best-effort on Windows (NTFS ACLs override POSIX mode); the call still
  // succeeds and the test suite asserts mode only on POSIX.
  await mkdir(tokenDir, { recursive: true, mode: 0o700 });
  await writeFile(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return tokenPath;
}

/**
 * Best-effort token-file delete. Used on `proxy.stopped` to avoid leaking a
 * dead token onto disk. Swallows ENOENT (already gone) and any other error
 * — the caller is shutting down and has nothing useful to do with a failure.
 */
export async function deleteProxyTokenFile(
  port: number,
  userDataPath?: string,
): Promise<void> {
  const tokenPath = resolveProxyTokenPath(port, userDataPath);
  try {
    await unlink(tokenPath);
  } catch {
    /* swallow — file may already be gone or unwritable */
  }
}

/**
 * Constant-time equality compare for two bearer tokens.
 *
 * Returns `false` immediately when lengths differ — `crypto.timingSafeEqual`
 * throws on mismatched buffer lengths and the length itself is non-secret,
 * so short-circuiting here is safe and avoids the throw.
 */
export function verifyProxyToken(presented: string, expected: string): boolean {
  if (
    typeof presented !== 'string' ||
    typeof expected !== 'string' ||
    presented.length !== expected.length ||
    presented.length === 0
  ) {
    return false;
  }
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Sanity — Buffer length must match (UTF-8 string of same char length CAN
  // differ if multibyte, but tokens are hex so this is always true).
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Extract a bearer token from an `IncomingMessage`-like header bag.
 *
 * Returns `null` when neither header is present. Trims whitespace and strips
 * the `Bearer ` prefix (case-insensitive) from `authorization`.
 *
 * Header bag is `Record<string, string | string[] | undefined>` to accept
 * `node:http.IncomingHttpHeaders` directly without an import.
 */
export function extractProxyToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const apiKey = headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) {
    return apiKey.trim();
  }
  if (
    Array.isArray(apiKey) &&
    apiKey.length > 0 &&
    typeof apiKey[0] === 'string'
  ) {
    return apiKey[0].trim();
  }
  const authHeader = headers['authorization'];
  const auth =
    typeof authHeader === 'string'
      ? authHeader
      : Array.isArray(authHeader) && typeof authHeader[0] === 'string'
        ? authHeader[0]
        : null;
  if (auth === null) return null;
  const trimmed = auth.trim();
  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^bearer\s+/i, '').trim();
  }
  return trimmed.length > 0 ? trimmed : null;
}
