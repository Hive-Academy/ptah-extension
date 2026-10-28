/**
 * Bounded reader for the three Kimi Code CLI `config.toml` values Ptah needs.
 *
 * Not a TOML parser (no TOML library is a declared dependency; plan D8). It
 * reads table headers and `key = "string"` pairs line by line and resolves
 * them to dotted paths, so these spellings all work:
 *
 * ```toml
 * [providers."managed:kimi-code"]
 * base_url = "https://api.kimi.ai/coding/v1"
 * oauth.key = "oauth/kimi-code-env-0123456789abcdef"
 *
 * [providers."managed:kimi-code".oauth]
 * key = "oauth/kimi-code-env-0123456789abcdef"
 * ```
 *
 * Anything it does not understand (arrays, inline tables, multi-line strings,
 * numbers) is skipped. Every value is validated; an invalid value is dropped
 * and the caller's default or fallback applies.
 */
import { z } from 'zod';

/** Largest `config.toml` the reader accepts (256 KiB). */
export const KIMI_CODE_CONFIG_MAX_BYTES = 256 * 1024;

/** Default OAuth host of the Kimi Code CLI. */
export const KIMI_CODE_DEFAULT_OAUTH_HOST = 'https://auth.kimi.ai';

export interface KimiCodeOAuthConfig {
  /** `oauth/<name>`: names `credentials/<name>.json`. */
  readonly oauthKey?: string;
  /** `https:` origin of the OAuth token endpoint. */
  readonly oauthHost: string;
  /** Host name of the CLI's own inference `base_url` (diagnostics only). */
  readonly baseUrlHost?: string;
}

const PROVIDER_PATH = 'providers\u0000managed:kimi-code';

const oauthKeySchema = z.string().regex(/^oauth\/[A-Za-z0-9._-]{1,128}$/);

/** An absolute `https:` URL. `.url()` guarantees `new URL` cannot throw. */
const httpsUrlSchema = z
  .string()
  .max(2048)
  .url()
  .transform((value) => new URL(value))
  .refine((url) => url.protocol === 'https:');

/**
 * Read the OAuth key, OAuth host and base-URL host from `config.toml` text.
 * Oversized input yields the defaults only.
 */
export function readKimiCodeOAuthConfig(text: string): KimiCodeOAuthConfig {
  if (Buffer.byteLength(text, 'utf8') > KIMI_CODE_CONFIG_MAX_BYTES) {
    return { oauthHost: KIMI_CODE_DEFAULT_OAUTH_HOST };
  }
  const values = collectStringValues(text);
  const oauthKey = oauthKeySchema.safeParse(
    values.get(`${PROVIDER_PATH}\u0000oauth\u0000key`),
  );
  const hostCandidate =
    values.get(`${PROVIDER_PATH}\u0000oauth\u0000oauth_host`) ??
    values.get(`${PROVIDER_PATH}\u0000oauth\u0000host`) ??
    values.get(`${PROVIDER_PATH}\u0000oauth_host`);
  const oauthHost = httpsUrlSchema.safeParse(hostCandidate);
  const baseUrl = httpsUrlSchema.safeParse(
    values.get(`${PROVIDER_PATH}\u0000base_url`),
  );
  return {
    ...(oauthKey.success ? { oauthKey: oauthKey.data } : {}),
    oauthHost: oauthHost.success
      ? oauthHost.data.origin
      : KIMI_CODE_DEFAULT_OAUTH_HOST,
    ...(baseUrl.success ? { baseUrlHost: baseUrl.data.hostname } : {}),
  };
}

/** Dotted path (segments joined by NUL) -> string value. First wins. */
function collectStringValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let table: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (line.startsWith('[[')) {
      // Array-of-tables: never one of ours; ignore its keys.
      table = ['\u0000array'];
      continue;
    }
    if (line.startsWith('[')) {
      const header = parseTableHeader(line);
      table = header ?? ['\u0000invalid'];
      continue;
    }
    const pair = parseKeyValue(line);
    if (!pair) continue;
    const path = [...table, ...pair.key].join('\u0000');
    if (!values.has(path)) values.set(path, pair.value);
  }
  return values;
}

/** `[a."b.c".d]  # comment` -> `['a', 'b.c', 'd']`; null when malformed. */
function parseTableHeader(line: string): string[] | null {
  const parsed = parseKeySegments(line, 1);
  if (!parsed) return null;
  const rest = line.slice(parsed.end).trimStart();
  if (!rest.startsWith(']')) return null;
  const trailing = rest.slice(1).trim();
  if (trailing.length > 0 && !trailing.startsWith('#')) return null;
  return parsed.segments;
}

/** `a.b = "value" # comment` -> `{ key: ['a','b'], value }`; null otherwise. */
function parseKeyValue(
  line: string,
): { key: string[]; value: string } | null {
  const parsed = parseKeySegments(line, 0);
  if (!parsed) return null;
  let index = parsed.end;
  while (line[index] === ' ' || line[index] === '\t') index += 1;
  if (line[index] !== '=') return null;
  index += 1;
  while (line[index] === ' ' || line[index] === '\t') index += 1;
  const value = parseStringLiteral(line, index);
  if (!value) return null;
  const trailing = line.slice(value.end).trim();
  if (trailing.length > 0 && !trailing.startsWith('#')) return null;
  return { key: parsed.segments, value: value.value };
}

/** Dotted key starting at `start`: bare, "basic" or 'literal' segments. */
function parseKeySegments(
  line: string,
  start: number,
): { segments: string[]; end: number } | null {
  const segments: string[] = [];
  let index = start;
  for (;;) {
    while (line[index] === ' ' || line[index] === '\t') index += 1;
    const quote = line[index];
    if (quote === '"' || quote === "'") {
      const literal = parseStringLiteral(line, index);
      if (!literal) return null;
      segments.push(literal.value);
      index = literal.end;
    } else {
      const match = /^[A-Za-z0-9_-]+/.exec(line.slice(index));
      if (!match) return null;
      segments.push(match[0]);
      index += match[0].length;
    }
    while (line[index] === ' ' || line[index] === '\t') index += 1;
    if (line[index] !== '.') return { segments, end: index };
    index += 1;
  }
}

/** Single-line basic ("...") or literal ('...') string at `start`. */
function parseStringLiteral(
  line: string,
  start: number,
): { value: string; end: number } | null {
  const quote = line[start];
  if (quote === "'") {
    if (line.startsWith("'''", start)) return null;
    const close = line.indexOf("'", start + 1);
    if (close < 0) return null;
    return { value: line.slice(start + 1, close), end: close + 1 };
  }
  if (quote !== '"' || line.startsWith('"""', start)) return null;
  let value = '';
  let index = start + 1;
  while (index < line.length) {
    const char = line[index];
    if (char === '"') return { value, end: index + 1 };
    if (char !== '\\') {
      value += char;
      index += 1;
      continue;
    }
    const escape = line[index + 1];
    const simple: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      n: '\n',
      t: '\t',
      r: '\r',
      b: '\b',
      f: '\f',
    };
    if (escape !== undefined && escape in simple) {
      value += simple[escape];
      index += 2;
      continue;
    }
    if (escape === 'u' || escape === 'U') {
      const width = escape === 'u' ? 4 : 8;
      const hex = line.slice(index + 2, index + 2 + width);
      if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) return null;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff) return null;
      value += String.fromCodePoint(codePoint);
      index += 2 + width;
      continue;
    }
    return null;
  }
  return null;
}
