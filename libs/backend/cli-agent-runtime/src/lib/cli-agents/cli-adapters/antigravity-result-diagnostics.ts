/** Bounded diagnostics for a failed Antigravity headless turn. */
const MAX_DIAGNOSTIC_CHARS = 8 * 1024;
const SENSITIVE_KEY = /token|key|secret|authorization|password|credential|cookie|session/i;
const INLINE_SECRET = /\b(bearer\s+)[^\s,;"']+|\b((?:api[_-]?key|token|secret|authorization|password|credential|set-cookie|cookie|session)\s*[:=]\s*)[^\r\n,"']+/gi;

export function redactAgyText(value: string): string {
  return value
    .replace(/(["'](?:[^"']*(?:token|key|secret|authorization|password|credential|cookie|session)[^"']*)["']\s*:\s*["'])[^"']+/gi, '$1[REDACTED]')
    .replace(INLINE_SECRET, (_match, bearer: string | undefined, field: string | undefined) =>
      `${bearer ?? field ?? ''}[REDACTED]`,
    );
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') return redactAgyText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item, depth + 1),
      ]),
    );
  }
  return value;
}

export function safeAgyText(value: string, maxChars = 1024): string {
  return redactAgyText(value).slice(0, maxChars);
}

export function formatAgyFailure(
  result: { status: string; response?: string; error?: unknown },
): string {
  const parts = [result.status];
  if (typeof result.error === 'string') {
    parts.push(safeAgyText(result.error));
  } else if (result.error && typeof result.error === 'object' && !Array.isArray(result.error)) {
    const error = result.error as Record<string, unknown>;
    const code = error['code'];
    const message = error['message'];
    if (typeof code === 'string') parts.push(safeAgyText(code, 160));
    if (typeof message === 'string') parts.push(safeAgyText(message));
  }
  if (result.response?.trim()) parts.push(safeAgyText(result.response.trim()));
  return parts.length > 1 ? parts.join(': ') : `Antigravity CLI finished with status ${result.status}`;
}

export function formatAgyDiagnostics(
  event: unknown,
  errorSteps: readonly unknown[],
  agyErrors: readonly string[],
): string {
  return JSON.stringify(redactValue({ event, errorSteps, agyErrors })).slice(0, MAX_DIAGNOSTIC_CHARS);
}
