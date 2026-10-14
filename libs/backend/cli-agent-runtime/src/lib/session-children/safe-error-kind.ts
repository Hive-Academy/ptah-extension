/**
 * The loggable kind of an error on a path that carries a prompt
 * (TASK_2026_655).
 *
 * An error's message, `name` and `code` are all set by whoever threw it, so any
 * of them may quote the request that failed. Only values from a fixed
 * allowlist are returned: a built-in error name and a Node/system-style code
 * (`ENOENT`, `ERR_STREAM_DESTROYED`). Anything else is `'unknown'`.
 */

const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'AbortError',
  'TimeoutError',
]);

/** `E` + upper-case letters, digits and underscores, as Node codes are. */
const SYSTEM_ERROR_CODE = /^E[A-Z0-9_]{1,30}$/;

export function safeErrorKind(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const name = KNOWN_ERROR_NAMES.has(error.name) ? error.name : 'unknown';
  const code: unknown = 'code' in error ? error.code : undefined;
  return typeof code === 'string' && SYSTEM_ERROR_CODE.test(code)
    ? `${name} (${code})`
    : name;
}
