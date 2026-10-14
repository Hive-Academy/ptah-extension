/**
 * The loggable kind of an error on a path that carries a prompt
 * (TASK_2026_655).
 *
 * An error's message, `name` and `code` are all set by whoever threw it, so any
 * of them may quote the request that failed. Only values from fixed
 * allowlists are returned: a built-in error name and a well-known Node/system
 * code. Any other name is `'unknown'`; any other code is dropped. A pattern
 * such as "E + upper-case letters" is not enough, because a short upper-case
 * prompt fragment (`ESECRET`) matches it.
 */

const KNOWN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'AbortError',
  'TimeoutError',
]);

/**
 * The codes a handoff can plausibly fail with: file-system access (descriptor
 * and workspace files), process and pipe I/O (child SDK and CLI streams),
 * network (provider calls), and Node's own abort / argument / stream codes.
 */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  // File system
  'ENOENT',
  'EACCES',
  'EPERM',
  'EEXIST',
  'EBUSY',
  'ENOTDIR',
  'EISDIR',
  'EMFILE',
  'ENOSPC',
  // Network
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EAI_AGAIN',
  // Process and stream I/O
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  // Node runtime
  'ABORT_ERR',
  'ERR_INVALID_ARG_TYPE',
]);

export function safeErrorKind(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const name = KNOWN_ERROR_NAMES.has(error.name) ? error.name : 'unknown';
  const code: unknown = 'code' in error ? error.code : undefined;
  return typeof code === 'string' && KNOWN_ERROR_CODES.has(code)
    ? `${name} (${code})`
    : name;
}
