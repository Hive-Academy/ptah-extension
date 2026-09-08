/**
 * Bounded, user-facing summaries for in-process vendor SDK failures.
 *
 * The Codex SDK rejects with an `Error` whose `.message` embeds the last ~500
 * lines of the child process's own output ("… Total output lines: 500 Output:
 * <hundreds of lines of grep results>"). Forwarding that verbatim put the whole
 * dump in the chat bubble. The full text still belongs in the log; only this
 * summary reaches the stream.
 */

/** Hard cap on the summary's headline, in characters. */
const MAX_SUMMARY_LENGTH = 500;

/** Longest "try again at <when>" fragment we are willing to quote back. */
const MAX_RETRY_HINT_LENGTH = 40;

/** Marker the vendor SDKs use before pasting the child's captured output. */
const OUTPUT_MARKER_REGEX = /\boutput:/i;

const USAGE_LIMIT_REGEX = /usage limit/i;

const RETRY_AT_REGEX = /try again at\s+([^\n.)]+)/i;

/**
 * Turn a rejected vendor SDK error into one bounded line fit for the stream.
 *
 * @param error - The rejection value, narrowed here rather than by the caller.
 * @param vendor - Display name of the SDK, e.g. `Codex` or `Cursor`.
 */
export function summarizeCliSdkError(error: unknown, vendor: string): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();

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
