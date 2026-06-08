/**
 * Sensitive-key redactor for `config list` and any other surface that emits
 * arbitrary configuration payloads.
 *
 * Walks an arbitrary value (object/array/scalar) recursively. A STRING value
 * under an object key matching `/apikey|api_key|token|secret|password/i` is
 * replaced with the literal string `'<redacted>'`. Booleans, numbers, and
 * null are never redacted (they cannot carry a credential), and capability
 * predicate keys (`hasApiKey`, `isLocal`, ...) are skipped so their flag
 * values survive. The `reveal` option bypasses redaction and returns the
 * input shape untouched.
 *
 * Pure function — no IO, no DI, no side effects. Safe to import anywhere.
 */

/** Redaction options. */
export interface RedactOptions {
  /** When true, return the value unchanged (used by `--reveal`). */
  reveal?: boolean;
  /** Replacement token. Defaults to `'<redacted>'`. */
  replacement?: string;
}

/** Default replacement token. */
export const DEFAULT_REDACTION = '<redacted>';

/** Pattern matching sensitive object keys (case-insensitive). */
export const SENSITIVE_KEY_PATTERN = /apikey|api_key|token|secret|password/i;

/**
 * Boolean/capability predicate keys (`hasApiKey`, `isLocal`, `requiresAuth`,
 * `supportsTools`, ...) carry no credential material — their VALUE is a flag,
 * not a secret. They are skipped so a `hasApiKey: true` boolean survives
 * redaction even though it contains the `apikey` substring.
 */
export const PREDICATE_KEY_PATTERN = /^(has|is|requires|supports)[A-Z]/;

/**
 * Walk `value` recursively, returning a deep copy with sensitive object
 * properties masked. Cycles are not expected (we operate on JSON-shaped
 * payloads); a `Set` guards against accidental loops.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  if (options.reveal) {
    return value;
  }
  const replacement = options.replacement ?? DEFAULT_REDACTION;
  return walk(value, replacement, new WeakSet());
}

function walk(
  value: unknown,
  replacement: string,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, replacement, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === 'string' &&
      !PREDICATE_KEY_PATTERN.test(key) &&
      SENSITIVE_KEY_PATTERN.test(key)
    ) {
      out[key] = replacement;
      continue;
    }
    out[key] = walk(child, replacement, seen);
  }
  return out;
}
