/**
 * Responses upstream error classifier: turns an upstream HTTP failure or a
 * Responses terminal state into one Anthropic outcome.
 *
 * Pure and stateless: no I/O, no logging, never throws. Client-facing messages
 * are built only from fixed text, sanitized error codes and parsed integers;
 * upstream message text is scanned for patterns but never copied.
 *
 * The prompt-too-long shape is the contract the pinned Claude CLI matches to
 * run reactive compaction (see TASK_2026_408 implementation-plan.md).
 * Library-internal module.
 */

export interface AnthropicErrorMapping {
  readonly status: 400 | 429 | 502;
  readonly type: 'invalid_request_error' | 'rate_limit_error' | 'api_error';
  readonly message: string;
}

export type ResponsesStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';

/** Why a terminal became an error; lets callers keep their own error codes. */
export type ResponsesTerminalErrorCause = 'incomplete_tool_input' | 'incomplete' | 'failed';

export type ResponsesTerminalOutcome =
  | { readonly kind: 'stop'; readonly stopReason: ResponsesStopReason }
  | {
      readonly kind: 'error';
      readonly cause: ResponsesTerminalErrorCause;
      readonly mapping: AnthropicErrorMapping;
    };

export type ResponsesTerminalEventName =
  | 'response.completed'
  | 'response.incomplete'
  | 'response.failed';

/** Existing collector text for truncated tool input; kept byte-identical. */
export const INCOMPLETE_TOOL_INPUT_MESSAGE = 'Upstream response ended with incomplete tool input';

const INCOMPLETE_TOOL_INPUT_MAPPING: AnthropicErrorMapping = {
  status: 502,
  type: 'api_error',
  message: `upstream_incomplete: ${INCOMPLETE_TOOL_INPUT_MESSAGE}`,
};

const INCOMPLETE_OTHER_MAPPING: AnthropicErrorMapping = {
  status: 502,
  type: 'api_error',
  message: 'upstream_incomplete: Upstream Responses response incomplete',
};

const RATE_LIMIT_MAPPING: AnthropicErrorMapping = {
  status: 429,
  type: 'rate_limit_error',
  message: 'Upstream rate limit exceeded',
};

const OVERFLOW_CODE = 'context_length_exceeded';

/**
 * Conservative overflow phrasings (Assumption A1). Deliberately no generic
 * "too many tokens": tokens-per-minute throttles use that wording too.
 */
const OVERFLOW_PATTERNS: readonly RegExp[] = [
  /exceeds the context window/i,
  /maximum context length/i,
  /context[_ ]length[_ ]exceeded/i,
  /prompt is too long/i,
  /input is too long/i,
];

/** Anthropic-native: actual first, limit second. */
const ANTHROPIC_NUMBERS = /prompt is too long: (\d+) tokens > (\d+)/i;
/** Chat Completions phrasing: limit first, actual second. */
const CHAT_NUMBERS = /maximum context length is (\d+) tokens[\s\S]*?resulted in (\d+) tokens/i;

/** Error text is short; bound the regex work on hostile or huge bodies. */
const MAX_SCANNED_TEXT = 16 * 1024;

const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

/** `ResponseError.code` values that describe the request, not the upstream. */
const REQUEST_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid_prompt',
  'invalid_image',
  'invalid_image_format',
  'invalid_base64_image',
  'invalid_image_url',
  'invalid_image_mode',
  'image_too_large',
  'image_too_small',
  'image_parse_error',
  'image_content_policy_violation',
  'image_file_too_large',
  'unsupported_image_media_type',
  'empty_image_file',
  'failed_to_download_image',
  'image_file_not_found',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeCode(code: unknown): string | undefined {
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : undefined;
}

function scannable(texts: readonly unknown[]): string[] {
  return texts
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .map((text) => text.slice(0, MAX_SCANNED_TEXT));
}

function parseTokenCount(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function extractTokenCounts(texts: readonly string[]): { actual?: number; limit?: number } {
  for (const text of texts) {
    const anthropic = ANTHROPIC_NUMBERS.exec(text);
    if (anthropic) {
      return { actual: parseTokenCount(anthropic[1]), limit: parseTokenCount(anthropic[2]) };
    }
    const chat = CHAT_NUMBERS.exec(text);
    if (chat) return { actual: parseTokenCount(chat[2]), limit: parseTokenCount(chat[1]) };
  }
  return {};
}

function isOverflow(code: unknown, texts: readonly string[]): boolean {
  return code === OVERFLOW_CODE || texts.some((text) => OVERFLOW_PATTERNS.some((p) => p.test(text)));
}

function overflowMapping(texts: readonly string[]): AnthropicErrorMapping {
  const { actual, limit } = extractTokenCounts(texts);
  return { status: 400, type: 'invalid_request_error', message: promptTooLongMessage(actual, limit) };
}

/**
 * Exact client contract: satisfies the CLI's prompt-too-long predicate always,
 * and its token-gap regex when both counts are known.
 */
export function promptTooLongMessage(actual?: number, limit?: number): string {
  const known = (value: number | undefined): value is number =>
    value !== undefined && Number.isSafeInteger(value) && value > 0;
  if (known(actual) && known(limit)) return `prompt is too long: ${actual} tokens > ${limit} maximum`;
  return "prompt is too long: the request exceeds the model's context window";
}

/** True when `args` is a string that parses to a JSON object (not an array). */
export function isCompleteToolArguments(args: unknown): boolean {
  if (typeof args !== 'string') return false;
  try {
    return isRecord(JSON.parse(args));
  } catch {
    return false;
  }
}

/**
 * Classifies an upstream HTTP error body. Returns a mapping only for context
 * overflow on 400/413; `undefined` keeps the caller's existing error path.
 */
export function classifyUpstreamHttpError(
  status: number,
  rawBody: string,
): AnthropicErrorMapping | undefined {
  if (status !== 400 && status !== 413) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  const nested = isRecord(body['error']) ? body['error'] : undefined;
  const texts = scannable([
    nested?.['message'],
    typeof body['error'] === 'string' ? body['error'] : undefined,
    body['message'],
    body['detail'],
  ]);
  return isOverflow(nested?.['code'], texts) ? overflowMapping(texts) : undefined;
}

/**
 * Classifies a `response.failed` error or a standalone `error` event. Callers
 * read top-level `code`/`message` first, then nested `error.{code,message}`.
 */
export function classifyResponsesError(code: unknown, message: unknown): AnthropicErrorMapping {
  const texts = scannable([message]);
  if (isOverflow(code, texts)) return overflowMapping(texts);
  const safeCode = sanitizeCode(code);
  if (safeCode === 'rate_limit_exceeded') return RATE_LIMIT_MAPPING;
  if (safeCode !== undefined && REQUEST_ERROR_CODES.has(safeCode)) {
    return {
      status: 400,
      type: 'invalid_request_error',
      message: `Upstream rejected the request (${safeCode})`,
    };
  }
  return {
    status: 502,
    type: 'api_error',
    message: `Upstream Responses request failed (${safeCode ?? 'unknown'})`,
  };
}

/**
 * The single terminal table shared by the stream, forced-SSE collector and
 * JSON paths. For `response.incomplete`, tool input is checked first: any
 * function-call arguments that are not a complete JSON object give the
 * `upstream_incomplete` error whatever the incomplete reason.
 *
 * `toolArgs` holds the final argument value of every function call.
 */
export function classifyResponsesTerminal(
  eventName: ResponsesTerminalEventName,
  response: unknown,
  tools: { readonly hadToolUse: boolean; readonly toolArgs?: readonly unknown[] },
): ResponsesTerminalOutcome {
  const snapshot = isRecord(response) ? response : undefined;
  if (eventName === 'response.failed') {
    const error = isRecord(snapshot?.['error']) ? snapshot['error'] : undefined;
    return {
      kind: 'error',
      cause: 'failed',
      mapping: classifyResponsesError(error?.['code'], error?.['message']),
    };
  }
  if (eventName === 'response.completed') {
    return { kind: 'stop', stopReason: tools.hadToolUse ? 'tool_use' : 'end_turn' };
  }
  if (tools.toolArgs?.some((args) => !isCompleteToolArguments(args))) {
    return { kind: 'error', cause: 'incomplete_tool_input', mapping: INCOMPLETE_TOOL_INPUT_MAPPING };
  }
  const details = isRecord(snapshot?.['incomplete_details']) ? snapshot['incomplete_details'] : undefined;
  const reason = details?.['reason'];
  if (reason === 'max_output_tokens') return { kind: 'stop', stopReason: 'max_tokens' };
  if (reason === 'content_filter') return { kind: 'stop', stopReason: 'refusal' };
  return { kind: 'error', cause: 'incomplete', mapping: INCOMPLETE_OTHER_MAPPING };
}
