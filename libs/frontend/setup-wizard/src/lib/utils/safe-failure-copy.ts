/**
 * Safe, actionable copy for a failure a wizard surface shows (TASK_2026_701_9e4b
 * B5). The raw exception or backend text never reaches the view: it can carry
 * paths, URLs, tokens or markup, and escaping alone does not redact them.
 * Known failure kinds map to fixed copy; anything else gets the caller's
 * generic fallback. Raw detail belongs only in the diagnostic log.
 */
export type FailureKind =
  | 'timeout'
  | 'offline'
  | 'permission'
  | 'disk-full'
  | 'partial'
  | 'plan-expired'
  | 'not-found'
  | 'unknown';

/** Patterns checked in order; the first match names the kind. */
const KIND_PATTERNS: ReadonlyArray<
  readonly [Exclude<FailureKind, 'unknown'>, RegExp]
> = [
  ['timeout', /\btimed?[\s-]?out\b|\btimeout\b|\betimedout\b/],
  [
    'permission',
    /\beacces\b|\beperm\b|\berofs\b|permission denied|access is denied|read-only/,
  ],
  ['disk-full', /\benospc\b|no space left/],
  ['partial', /^\d+ file\(s\) failed to install$/],
  [
    'plan-expired',
    /\b(plan|preview) token\b|\bplan\b.*\b(expired|stale|missing|mismatch)/,
  ],
  [
    'offline',
    /\beconnrefused\b|\benotfound\b|\beconnreset\b|\bnetwork\b|fetch failed|\boffline\b/,
  ],
  ['not-found', /\benoent\b|\b404\b|not found/],
];

const KIND_COPY: Readonly<Record<Exclude<FailureKind, 'unknown'>, string>> = {
  timeout: 'The request timed out. Try again.',
  permission:
    'The folder did not allow the write (permission denied). Check the folder permissions and try again.',
  'disk-full': 'The disk is full. Free some space and try again.',
  partial: 'Some files could not be installed. Retry the failed files.',
  'plan-expired':
    'The comparison is out of date. Open the install again to compare the files.',
  offline:
    'The source could not be reached. Check your connection and try again.',
  'not-found': 'A file was not found at its source. Try again later.',
};

/** Classify a raw failure text without exposing it. */
export function failureKind(raw: string | null | undefined): FailureKind {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'unknown';
}

/**
 * Fixed copy for the failure's kind, or `fallback` for an unknown one. The
 * return value never contains any part of `raw`.
 */
export function safeFailureCopy(
  raw: string | null | undefined,
  fallback: string,
): string {
  const kind = failureKind(raw);
  return kind === 'unknown' ? fallback : KIND_COPY[kind];
}
