/**
 * Credential redaction for text and structured fields written to the
 * persistent Electron log. Log input (renderer console text, caller context)
 * is untrusted: it can carry OAuth callback URLs, headers, or keys.
 */

export const REDACTED = '[REDACTED]';

/**
 * Credential shapes stripped from log text: OAuth/API-key query parameters
 * (callback URLs), `name=value` credential assignments, bearer headers, JSON
 * credential fields, and `sk-`-style API keys.
 */
const SECRET_TEXT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /([?&#](?:code|state|key|[a-z_]*token|[a-z_]*secret|password|passwd|api_?key)=)[^&#\s"'<>]+/gi,
    `$1${REDACTED}`,
  ],
  [
    /\b((?:[a-z_]*token|[a-z_]*secret|password|passwd|pwd|api[_-]?key)\s*[=:]\s*)(?!\[REDACTED\])[^\s&#"',;]+/gi,
    `$1${REDACTED}`,
  ],
  [/\b((?:Bearer|Basic)\s+)[\w.~+/=-]+/gi, `$1${REDACTED}`],
  [
    /\b((?:x-api-key|api-key|authorization|cookie)\s*[:=]\s*)[^\r\n;"']+/gi,
    `$1${REDACTED}`,
  ],
  [
    /("[a-z_]*(?:token|secret|password|apiKey|api_key)"\s*:\s*")[^"]*/gi,
    `$1${REDACTED}`,
  ],
  [/\b(?:sk|pk|rk)-[\w-]{16,}/g, REDACTED],
];

/**
 * Field names whose value is a credential. Matches `token`, `accessToken`,
 * `client_secret`, `apiKey`, `password`, … but not counters such as
 * `inputTokens` or `tokenCount`.
 */
const SECRET_FIELD_NAME =
  /(?:token|secret|password|passwd|api[_-]?key|authorization|cookie|credentials?|private[_-]?key)$/i;

/** Strip credential-shaped substrings from log text. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/** True when a structured field of this name holds a credential. */
export function isSecretFieldName(name: string): boolean {
  return SECRET_FIELD_NAME.test(name);
}
