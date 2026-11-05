import { parseToolInputCached } from './tool-input-parse-cache';

/** Recover completed fields of a JSON object while its final token streams. */
export function parsePartialToolInput(
  raw: string,
): Record<string, unknown> | null {
  const parse = (value: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const complete = parse(raw);
  if (complete) return complete;
  if (!raw.trimStart().startsWith('{')) return null;
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  let stringStart = -1;
  let lastValueEnd = 0;
  const candidates: Array<{ end: number; suffix: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quoted) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quoted = false;
        lastValueEnd = i + 1;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      stringStart = i;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      if (stack.length === 1) candidates.push({ end: i + 1, suffix: '}' });
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return null;
      lastValueEnd = i + 1;
    } else if (char === ',')
      candidates.push({ end: i, suffix: stack.slice().reverse().join('') });
    else if (!/\s/.test(char)) lastValueEnd = i + 1;
  }
  if (stack.length === 0) return null;
  const suffix = stack.slice().reverse().join('');
  const additions: string[] = [];
  if (quoted) {
    let fragment = raw;
    if (escaped) fragment = fragment.slice(0, -1);
    fragment = fragment.replace(/\\u[0-9a-fA-F]{0,3}$/, '');
    additions.push(fragment + '"' + suffix);
    candidates.push({ end: stringStart, suffix });
  } else {
    additions.push(raw + suffix);
    candidates.push({ end: lastValueEnd, suffix });
  }
  for (const value of additions) {
    const parsed = parse(value);
    if (parsed) return parsed;
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const { end, suffix: closing } = candidates[i];
    const parsed = parse(raw.slice(0, end).replace(/[,\s:]+$/, '') + closing);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * A streaming input longer than this is partially parsed from its head only.
 * Each input delta then costs a bounded parse, and the head result is cached,
 * so a large Write or Edit input does not re-parse its whole text per delta.
 */
export const STREAMING_TOOL_INPUT_PARSE_CHARS = 16_384;

/** Entry cap of the streaming head cache. */
const STREAMING_CACHE_LIMIT = 64;

const streamingCache = new Map<
  string,
  { readonly head: string; readonly value: Record<string, unknown> | null }
>();

function endsWithBrace(raw: string): boolean {
  for (let i = raw.length - 1; i >= 0; i--) {
    const char = raw[i];
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
      continue;
    }
    return char === '}';
  }
  return false;
}

/** The text a streaming input renders from: its head, capped. */
export function streamingToolInputHead(raw: string): string {
  return raw.length > STREAMING_TOOL_INPUT_PARSE_CHARS
    ? raw.slice(0, STREAMING_TOOL_INPUT_PARSE_CHARS)
    : raw;
}

/**
 * The best object for a tool input that is still streaming. A raw string
 * within the cap that ends with `}` tries the shared full parse first. A
 * longer one never gets a full parse before its result arrives, because the
 * shared cache does not keep it. Otherwise the capped head is partially parsed, and the result is reused while the head is
 * unchanged. Returns `null` when no object can be recovered.
 */
export function parseStreamingToolInputCached(
  toolCallId: string,
  raw: string,
): Readonly<Record<string, unknown>> | null {
  if (raw.length <= STREAMING_TOOL_INPUT_PARSE_CHARS && endsWithBrace(raw)) {
    const full = parseToolInputCached(toolCallId, raw);
    if (full.success) return full.data;
  }
  const head = streamingToolInputHead(raw);
  const cached = streamingCache.get(toolCallId);
  if (cached && cached.head === head) return cached.value;
  const value = parsePartialToolInput(head);
  streamingCache.delete(toolCallId);
  streamingCache.set(toolCallId, { head, value });
  while (streamingCache.size > STREAMING_CACHE_LIMIT) {
    const oldest = streamingCache.keys().next();
    if (oldest.done) break;
    streamingCache.delete(oldest.value);
  }
  return value;
}
