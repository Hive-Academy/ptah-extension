/**
 * Log-safe category of an untrusted rejection.
 *
 * A rejection from `fetch`, a body reader, a secret store or a storage
 * adapter is untrusted: both its message and its `name` are set by the
 * dependency that threw, so either can hold a key, a header or a URL. Only a
 * fixed built-in name is passed through; the message and any error code are
 * never read.
 */

/** The error categories a log line or a row detail may carry. */
export type LoggableErrorName =
  | 'AbortError'
  | 'TimeoutError'
  | 'TypeError'
  | 'SyntaxError'
  | 'RangeError'
  | 'Error'
  | 'other';

const LOGGABLE_ERROR_NAMES: ReadonlySet<string> = new Set<LoggableErrorName>([
  'AbortError',
  'TimeoutError',
  'TypeError',
  'SyntaxError',
  'RangeError',
  'Error',
]);

/**
 * Loggable category of `error`. Any name outside the fixed set, a
 * non-`Error` rejection and a `name` getter that throws all read `'other'`.
 */
export function loggableErrorName(error: unknown): LoggableErrorName {
  if (!(error instanceof Error)) {
    return 'other';
  }
  const name = readName(error);
  return isLoggableErrorName(name) ? name : 'other';
}

function isLoggableErrorName(name: unknown): name is LoggableErrorName {
  return typeof name === 'string' && LOGGABLE_ERROR_NAMES.has(name);
}

function readName(error: Error): unknown {
  let name: unknown;
  try {
    name = error.name;
  } catch {
    // A throwing `name` getter is hostile input, not a failure to report:
    // `loggableErrorName` maps the missing value to the fixed category 'other'.
    name = undefined;
  }
  return name;
}
