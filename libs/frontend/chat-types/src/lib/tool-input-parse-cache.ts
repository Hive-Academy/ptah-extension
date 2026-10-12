/**
 * Shared, bounded cache for parsing a tool call's accumulated JSON input.
 *
 * Every rebuild of a streaming tree (and of the agent monitor and the compact
 * summary) re-parses the same completed tool input. The raw string of a
 * finished tool no longer changes, so the parse result is cached per tool call
 * id and reused while the raw string is identical. A different raw string for
 * the same id parses again and replaces the entry.
 *
 * The returned `data` object is SHARED by every caller: treat it as read-only,
 * and copy it before changing it.
 *
 * Retention is bounded three ways, so large Write/Edit inputs cannot pile up:
 * an input longer than `TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS` is never
 * cached (each call parses it fresh), and the least recently used entries are
 * dropped while the cache holds more than `TOOL_INPUT_PARSE_CACHE_LIMIT`
 * entries or more than `TOOL_INPUT_PARSE_CACHE_MAX_RETAINED_CHARS` characters.
 * An entry's size is its raw length plus an estimate of twice that for the
 * parsed object. There are no timers.
 */

export type ToolInputParseResult =
  | { readonly success: true; readonly data: Readonly<Record<string, unknown>> }
  | { readonly success: false; readonly error: string; readonly raw: string };

interface ToolInputCacheEntry {
  readonly raw: string;
  readonly result: ToolInputParseResult;
  /** Characters this entry keeps alive: raw plus the parsed-object estimate. */
  readonly size: number;
}

/** Entry cap. */
export const TOOL_INPUT_PARSE_CACHE_LIMIT = 256;
/** An input longer than this is parsed but never cached. */
export const TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS = 32_768;
/** Total retained-size budget across all entries. */
export const TOOL_INPUT_PARSE_CACHE_MAX_RETAINED_CHARS = 1_048_576;

/** Parsed object estimated at twice its raw text. */
const PARSED_SIZE_FACTOR = 2;

const cache = new Map<string, ToolInputCacheEntry>();
let retained = 0;

/**
 * Parse `raw` as a JSON object for `toolCallId`, reusing the previous result
 * when `raw` is identical to the cached raw string. A value that is not a JSON
 * object yields `{ success: false, error: 'Not an object' }`.
 */
export function parseToolInputCached(
  toolCallId: string,
  raw: string,
): ToolInputParseResult {
  const cached = cache.get(toolCallId);
  if (cached && cached.raw === raw) {
    // Re-insert so Map order tracks recency.
    cache.delete(toolCallId);
    cache.set(toolCallId, cached);
    return cached.result;
  }
  const result = parseToolInput(raw);
  forget(toolCallId);
  if (raw.length > TOOL_INPUT_PARSE_CACHE_MAX_ENTRY_CHARS) return result;
  const size = raw.length * (1 + PARSED_SIZE_FACTOR);
  cache.set(toolCallId, { raw, result, size });
  retained += size;
  while (
    cache.size > TOOL_INPUT_PARSE_CACHE_LIMIT ||
    retained > TOOL_INPUT_PARSE_CACHE_MAX_RETAINED_CHARS
  ) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    forget(oldest.value);
  }
  return result;
}

/** Drop every cached entry. For tests. */
export function clearToolInputParseCache(): void {
  cache.clear();
  retained = 0;
}

function forget(toolCallId: string): void {
  const entry = cache.get(toolCallId);
  if (entry === undefined) return;
  cache.delete(toolCallId);
  retained -= entry.size;
}

function parseToolInput(raw: string): ToolInputParseResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'Not an object', raw };
    }
    return { success: true, data: parsed as Record<string, unknown> };
  } catch (e) {
    return { success: false, error: String(e), raw };
  }
}
