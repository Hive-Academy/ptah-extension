/**
 * redactSecrets — removes credential-shaped substrings from free text before
 * it leaves the backend in a UI event (the `tool-failure` snippet).
 *
 * Pure and best-effort: it over-redacts rather than under-redacts, and the
 * unredacted text stays in the backend log only.
 */

export const REDACTED = '[REDACTED]';

const KEY_NAMES = [
  'api[_-]?key',
  'x-api-key',
  'access[_-]?token',
  'refresh[_-]?token',
  'auth[_-]?token',
  'session[_-]?token',
  'id[_-]?token',
  'token',
  'client[_-]?secret',
  'secret',
  'password',
  'passwd',
  'pwd',
  'private[_-]?key',
].join('|');

/** Ordered: the structural rules run before the token-shape rules. */
const RULES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replace: string;
}> = [
  // Credentials in a URL authority: `https://user:pass@host`, `https://token@host`.
  // The scheme length is bounded so a long word cannot backtrack quadratically.
  {
    pattern: /\b([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/?#@]+@/gi,
    replace: `$1${REDACTED}@`,
  },
  // `Authorization: Bearer abc`, `proxy-authorization=Basic abc`.
  {
    pattern:
      /(\b(?:proxy-)?authorization\b["']?\s*[:=]\s*["']?)(?:(?:bearer|basic|token|digest)\s+)?[^\s,;'"]+/gi,
    replace: `$1${REDACTED}`,
  },
  // A bare `Bearer abc` scheme outside a header.
  {
    pattern: /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: `$1${REDACTED}`,
  },
  // A quoted value, through its closing quote (it may hold spaces or escaped
  // quotes): `"password": "alpha beta"`, `token='a b'`. An unterminated
  // quote redacts to the end of the text. The two branches are disjoint, so
  // the repetition is linear.
  {
    pattern: new RegExp(
      `(\\b(?:${KEY_NAMES})\\b["']?\\s*[:=]\\s*)(["'])(?:(?!\\2)[^\\\\]|\\\\[\\s\\S])*\\2?`,
      'gi',
    ),
    replace: `$1$2${REDACTED}$2`,
  },
  // An unquoted value: `api_key=abc`, `token: abc`.
  {
    pattern: new RegExp(
      `(\\b(?:${KEY_NAMES})\\b["']?\\s*[:=]\\s*)(?!["'])[^\\s&,;'"]+`,
      'gi',
    ),
    replace: `$1${REDACTED}`,
  },
  // Provider token prefixes (OpenAI/Anthropic, GitHub, Slack, AWS, Google, GitLab).
  {
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|glpat-[A-Za-z0-9_-]{20,})/g,
    replace: REDACTED,
  },
  // JSON Web Tokens.
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replace: REDACTED,
  },
  // Long hex runs (keys, digests).
  { pattern: /\b[0-9a-f]{32,}\b/gi, replace: REDACTED },
  // Long base64 / base64url runs that mix digits, upper and lower case.
  {
    pattern:
      /(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])[A-Za-z0-9+/_-]{32,}={0,2}/g,
    replace: REDACTED,
  },
];

/** Returns `text` with credential-shaped substrings replaced by `[REDACTED]`. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, rule.replace);
  }
  return result;
}
