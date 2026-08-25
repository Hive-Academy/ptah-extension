import { z } from 'zod';

/**
 * Validates an HTTP response body against a Zod schema at the API boundary.
 * On mismatch it throws a single, located error (`<path>: <message>`) that
 * propagates through the Observable error channel, so callers surface a clear
 * "malformed response" instead of dereferencing `undefined` later.
 *
 * Extracted verbatim from `admin-api.service.ts` (TASK_2026_169 / F1) so the
 * generic-model admin client and `admin-builders-api.service.ts` share one
 * boundary-validation helper rather than each carrying a copy.
 */
export function validate<S extends z.ZodType>(schema: S, endpoint: string) {
  return (raw: unknown): z.infer<S> => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`Malformed response from ${endpoint} — ${detail}`);
  };
}
