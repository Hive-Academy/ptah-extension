const TOKEN = /\b(ptw1\.[0-9A-HJKMNP-TV-Z]{12}\.)[A-Za-z0-9_-]+\b/g;
const PAIRING_CODE = /\b[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\b/gi;
const SECRET_FIELD =
  /\b(adminKey|admin\.key|pairingCode|pairing_code|token|secret)\b/i;

export function redactText(text: string): string {
  return text.replace(TOKEN, '$1***').replace(PAIRING_CODE, '[REDACTED]');
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
