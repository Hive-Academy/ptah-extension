const TOKEN = /\b(ptw1\.[0-9A-HJKMNP-TV-Z]{12}\.)[A-Za-z0-9_-]+\b/g;
const PAIRING_CODE = /\b[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\b/gi;
// A 32-byte base64url key (the admin key) is 43 characters. Over-matching
// other 43-character runs only hides log detail; it never exposes a secret.
const BARE_KEY = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const SECRET_FIELD =
  /\b(admin|adminKey|admin\.key|pairingCode|pairing_code|token|secret)\b/i;

export function redactText(text: string): string {
  return text
    .replace(TOKEN, '$1***')
    .replace(PAIRING_CODE, '[REDACTED]')
    .replace(BARE_KEY, '[REDACTED]');
}

export function redactLogRecord(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactLogRecord);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_FIELD.test(key) ? '[REDACTED]' : redactLogRecord(entry),
      ]),
    );
  }
  return value;
}
