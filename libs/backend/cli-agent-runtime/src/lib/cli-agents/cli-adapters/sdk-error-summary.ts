/**
 * Bounded, user-facing summaries for in-process vendor SDK failures.
 *
 * The Codex SDK rejects with an `Error` whose `.message` embeds the last ~500
 * lines of the child process's own output ("… Total output lines: 500 Output:
 * <hundreds of lines of grep results>"). Forwarding that verbatim put the whole
 * dump in the chat bubble. The full text still belongs in the log; only this
 * summary reaches the stream.
 */
import {
  RETRY_AT_REGEX,
  USAGE_LIMIT_REGEX,
} from '../limits/lane-limit-classifier';

/** Hard cap on the summary's headline, in characters. */
const MAX_SUMMARY_LENGTH = 500;

/** Longest "try again at <when>" fragment we are willing to quote back. */
const MAX_RETRY_HINT_LENGTH = 40;

/** Marker the vendor SDKs use before pasting the child's captured output. */
const OUTPUT_MARKER_REGEX = /\boutput:/i;

/** Fixed marker that replaces every literal secret occurrence. */
const REDACTED_MARKER = '[REDACTED]';

/**
 * Replace every literal occurrence of each secret with a fixed marker.
 *
 * Literal-value replacement, not a regex: a key such as `key_…` may not match
 * a shape-based sanitizer, and splitting on the exact value cannot be evaded
 * by punctuation inside the key.
 */
export function redactSecrets(
  text: string,
  secrets: readonly string[],
): string {
  let redacted = text;
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length === 0) {
      continue;
    }
    redacted = redacted.split(value).join(REDACTED_MARKER);
  }
  return redacted;
}

/**
 * Turn a rejected vendor SDK error into one bounded line fit for the stream.
 *
 * @param error - The rejection value, narrowed here rather than by the caller.
 * @param vendor - Display name of the SDK, e.g. `Codex` or `Cursor`.
 * @param secrets - Literal values that must never reach the stream. Redaction
 *   runs before the headline is cut, so an occurrence inside the kept headline
 *   is always replaced. Defaults to no secrets (Codex stays untouched).
 */
export function summarizeCliSdkError(
  error: unknown,
  vendor: string,
  secrets: readonly string[] = [],
): string {
  const raw = redactSecrets(
    (error instanceof Error ? error.message : String(error)).trim(),
    secrets,
  );

  const usageLimit = summarizeUsageLimit(raw, vendor);
  if (usageLimit) {
    return usageLimit;
  }

  return `${vendor} SDK Error: ${boundedHeadline(raw)}`;
}

/**
 * Recognise a quota/usage-limit rejection and answer with something the user
 * can act on, keeping the retry time when the vendor supplied one.
 */
function summarizeUsageLimit(raw: string, vendor: string): string | undefined {
  if (!USAGE_LIMIT_REGEX.test(raw)) {
    return undefined;
  }

  const when = RETRY_AT_REGEX.exec(raw)?.[1]?.trim();
  if (when && when.length > 0 && when.length <= MAX_RETRY_HINT_LENGTH) {
    return `${vendor} usage limit reached. Try again at ${when}.`;
  }
  return `${vendor} usage limit reached.`;
}

/**
 * The SDK's own headline: the first non-empty line, cut at the point where the
 * embedded subprocess dump starts, then capped.
 */
function boundedHeadline(raw: string): string {
  if (raw.length === 0) {
    return 'Unknown error';
  }

  const firstLine =
    raw.split(/\r?\n/).find((line) => line.trim().length > 0) ?? '';
  const markerIndex = firstLine.search(OUTPUT_MARKER_REGEX);
  const headline = (
    markerIndex >= 0 ? firstLine.slice(0, markerIndex) : firstLine
  ).trim();

  if (headline.length === 0) {
    return 'Unknown error';
  }

  const capped =
    headline.length > MAX_SUMMARY_LENGTH
      ? `${headline.slice(0, MAX_SUMMARY_LENGTH - 3)}...`
      : headline;

  return capped.length < raw.length ? `${capped} [output truncated]` : capped;
}
