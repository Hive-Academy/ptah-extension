import {
  classifyResponsesError,
  classifyResponsesTerminal,
  classifyUpstreamHttpError,
  isCompleteToolArguments,
  promptTooLongMessage,
} from './responses-error-mapping';

/** The pinned CLI's prompt-too-long predicate (`QQ`), reproduced literally. */
const cliPredicate = (message: string) => {
  const lower = message.toLowerCase();
  return lower.includes('prompt is too long') || lower.includes('input is too long for requested model');
};
/** The pinned CLI's token-gap regex (`F6e`). */
const TOKEN_GAP = /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i;
const SENTINEL = 'private-upstream-value';
const NO_NUMBERS = "prompt is too long: the request exceeds the model's context window";

describe('promptTooLongMessage', () => {
  it('builds the Anthropic-native contract string with both counts', () => {
    const message = promptTooLongMessage(130532, 128000);
    expect(message).toBe('prompt is too long: 130532 tokens > 128000 maximum');
    expect(cliPredicate(message)).toBe(true);
    expect(TOKEN_GAP.exec(message)?.slice(1)).toEqual(['130532', '128000']);
  });

  it.each([
    [undefined, undefined],
    [130532, undefined],
    [undefined, 128000],
    [0, 128000],
    [1.5, 128000],
    [Number.NaN, 128000],
  ])('falls back to the number-free contract for (%p, %p)', (actual, limit) => {
    const message = promptTooLongMessage(actual, limit);
    expect(message).toBe(NO_NUMBERS);
    expect(cliPredicate(message)).toBe(true);
    expect(TOKEN_GAP.test(message)).toBe(false);
  });
});

describe('isCompleteToolArguments', () => {
  it.each([
    ['{}', true],
    ['{"q":"ok"}', true],
    ['{"x":', false],
    ['[]', false],
    ['null', false],
    ['"text"', false],
    ['42', false],
    ['', false],
    [undefined, false],
    [{}, false],
  ])('%p -> %p', (args, expected) => {
    expect(isCompleteToolArguments(args)).toBe(expected);
  });
});

describe('classifyUpstreamHttpError', () => {
  const overflow = { status: 400, type: 'invalid_request_error' };

  it.each([400, 413])('maps status %d with code context_length_exceeded', (status) => {
    const body = JSON.stringify({ error: { code: 'context_length_exceeded', message: SENTINEL } });
    expect(classifyUpstreamHttpError(status, body)).toEqual({ ...overflow, message: NO_NUMBERS });
  });

  it.each([
    'Your input exceeds the context window of this model.',
    'This exceeds the maximum context length for the model.',
    'context_length_exceeded',
    'context length exceeded',
    'Prompt is too long',
    'Input is too long for requested model.',
  ])('maps overflow message pattern %p', (message) => {
    const result = classifyUpstreamHttpError(400, JSON.stringify({ error: { message: `${message} ${SENTINEL}` } }));
    expect(result).toEqual({ ...overflow, message: NO_NUMBERS });
  });

  it.each([
    ['top-level message', { message: 'maximum context length reached' }],
    ['detail (ChatGPT backend)', { detail: 'Input is too long for requested model.' }],
    ['string error', { error: 'prompt is too long' }],
  ])('scans the %s field', (_name, body) => {
    expect(classifyUpstreamHttpError(400, JSON.stringify(body))).toEqual({ ...overflow, message: NO_NUMBERS });
  });

  it('extracts Chat Completions numbers as actual > limit', () => {
    const body = JSON.stringify({ error: { code: 'context_length_exceeded', message:
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 130532 tokens. " +
      `Please reduce the length of the messages. ${SENTINEL}` } });
    const result = classifyUpstreamHttpError(400, body);
    expect(result).toEqual({ ...overflow, message: 'prompt is too long: 130532 tokens > 128000 maximum' });
    expect(TOKEN_GAP.exec(result?.message ?? '')?.slice(1)).toEqual(['130532', '128000']);
  });

  it('passes Anthropic-native numbers through without copying other text', () => {
    const body = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error',
      message: `prompt is too long: 210000 tokens > 200000 maximum ${SENTINEL}` } });
    expect(classifyUpstreamHttpError(400, body)).toEqual({ ...overflow,
      message: 'prompt is too long: 210000 tokens > 200000 maximum' });
  });

  it.each([
    ['non-overflow 400', 400, JSON.stringify({ error: { code: 'invalid_request', message: 'bad field' } })],
    ['TPM throttle wording on 400', 400, JSON.stringify({ error: { message: 'Request too large: too many tokens per min' } })],
    ['401 overflow wording', 401, JSON.stringify({ error: { code: 'context_length_exceeded' } })],
    ['403 overflow wording', 403, JSON.stringify({ error: { message: 'prompt is too long' } })],
    ['500 overflow wording', 500, JSON.stringify({ error: { message: 'maximum context length' } })],
    ['429 overflow wording', 429, JSON.stringify({ error: { message: 'prompt is too long' } })],
    ['non-JSON body', 400, 'prompt is too long'],
    ['empty body', 400, ''],
    ['JSON array', 400, '["prompt is too long"]'],
    ['JSON string', 400, '"prompt is too long"'],
    ['JSON null', 400, 'null'],
    ['non-string code and message', 400, JSON.stringify({ error: { code: 42, message: { x: 1 } } })],
  ])('returns undefined for %s', (_name, status, body) => {
    expect(classifyUpstreamHttpError(status, body)).toBeUndefined();
  });

  it('never copies upstream text into the output', () => {
    const bodies = [
      JSON.stringify({ error: { code: 'context_length_exceeded', message: SENTINEL } }),
      JSON.stringify({ error: { message: `prompt is too long ${SENTINEL} 5 tokens > 4` } }),
      JSON.stringify({ detail: `${SENTINEL} exceeds the context window` }),
    ];
    for (const body of bodies) {
      const result = classifyUpstreamHttpError(400, body);
      expect(result).toBeDefined();
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(cliPredicate(result?.message ?? '')).toBe(true);
    }
  });
});

describe('classifyResponsesError', () => {
  it('maps context_length_exceeded to prompt-too-long', () => {
    expect(classifyResponsesError('context_length_exceeded', SENTINEL)).toEqual({
      status: 400, type: 'invalid_request_error', message: NO_NUMBERS });
  });

  it('maps an overflow message with numbers regardless of code', () => {
    expect(classifyResponsesError(null,
      "maximum context length is 1000 tokens, however you resulted in 1200 tokens")).toEqual({
      status: 400, type: 'invalid_request_error', message: 'prompt is too long: 1200 tokens > 1000 maximum' });
  });

  it('maps rate_limit_exceeded to 429 without the TPM wording being overflow', () => {
    expect(classifyResponsesError('rate_limit_exceeded', 'too many tokens per min')).toEqual({
      status: 429, type: 'rate_limit_error', message: 'Upstream rate limit exceeded' });
  });

  it.each(['invalid_prompt', 'invalid_image', 'invalid_image_url', 'image_too_large',
    'image_content_policy_violation', 'unsupported_image_media_type', 'empty_image_file',
    'failed_to_download_image', 'image_file_not_found'])('maps request-describing code %s to 400', (code) => {
    expect(classifyResponsesError(code, SENTINEL)).toEqual({
      status: 400, type: 'invalid_request_error', message: `Upstream rejected the request (${code})` });
  });

  it.each([
    ['server_error', 'Upstream Responses request failed (server_error)'],
    ['vector_store_timeout', 'Upstream Responses request failed (vector_store_timeout)'],
    [undefined, 'Upstream Responses request failed (unknown)'],
    [null, 'Upstream Responses request failed (unknown)'],
    [42, 'Upstream Responses request failed (unknown)'],
    ['Private-Upstream-Value', 'Upstream Responses request failed (unknown)'],
    ['has spaces', 'Upstream Responses request failed (unknown)'],
    ['x'.repeat(65), 'Upstream Responses request failed (unknown)'],
  ])('maps code %p to a sanitized 502', (code, message) => {
    const result = classifyResponsesError(code, SENTINEL);
    expect(result).toEqual({ status: 502, type: 'api_error', message });
    expect(result.message).not.toContain(SENTINEL);
  });

  it('never throws on hostile input', () => {
    for (const value of [undefined, null, {}, [], 1, Symbol('x'), 'x'.repeat(100_000)]) {
      expect(() => classifyResponsesError(value, value)).not.toThrow();
    }
  });
});

describe('classifyResponsesTerminal', () => {
  const incomplete = (reason?: string | null) => ({ status: 'incomplete',
    ...(reason !== undefined ? { incomplete_details: reason === null ? null : { reason } } : {}) });
  const incompleteToolInput = { kind: 'error', cause: 'incomplete_tool_input', mapping: {
    status: 502, type: 'api_error',
    message: 'upstream_incomplete: Upstream response ended with incomplete tool input' } };
  const incompleteOther = { kind: 'error', cause: 'incomplete', mapping: {
    status: 502, type: 'api_error', message: 'upstream_incomplete: Upstream Responses response incomplete' } };

  it.each([
    [false, 'end_turn'],
    [true, 'tool_use'],
  ])('completed with hadToolUse=%p stops with %s', (hadToolUse, stopReason) => {
    expect(classifyResponsesTerminal('response.completed', { status: 'completed' }, { hadToolUse }))
      .toEqual({ kind: 'stop', stopReason });
  });

  it('does not apply the incomplete precedence rule to completed responses', () => {
    expect(classifyResponsesTerminal('response.completed', {}, { hadToolUse: true, toolArgs: ['{"x":'] }))
      .toEqual({ kind: 'stop', stopReason: 'tool_use' });
  });

  it.each([
    ['max_output_tokens', undefined, { kind: 'stop', stopReason: 'max_tokens' }],
    ['max_output_tokens', ['{"q":"ok"}', '{}'], { kind: 'stop', stopReason: 'max_tokens' }],
    ['max_output_tokens', ['{"x":'], incompleteToolInput],
    ['content_filter', undefined, { kind: 'stop', stopReason: 'refusal' }],
    ['content_filter', ['{"q":"ok"}'], { kind: 'stop', stopReason: 'refusal' }],
    ['content_filter', ['{"x":'], incompleteToolInput],
    ['something_else', undefined, incompleteOther],
    ['something_else', ['{"x":'], incompleteToolInput],
    [undefined, undefined, incompleteOther],
    [null, [undefined], incompleteToolInput],
    [null, [], incompleteOther],
  ])('incomplete reason %p with tool args %j', (reason, toolArgs, expected) => {
    expect(classifyResponsesTerminal('response.incomplete', incomplete(reason),
      { hadToolUse: (toolArgs?.length ?? 0) > 0, toolArgs })).toEqual(expected);
  });

  it.each([
    [{ error: { code: 'context_length_exceeded', message: SENTINEL } },
      { status: 400, type: 'invalid_request_error', message: NO_NUMBERS }],
    [{ error: { code: 'rate_limit_exceeded' } },
      { status: 429, type: 'rate_limit_error', message: 'Upstream rate limit exceeded' }],
    [{ error: { code: 'server_error', message: SENTINEL } },
      { status: 502, type: 'api_error', message: 'Upstream Responses request failed (server_error)' }],
    [{ error: { code: 'invalid_prompt' } },
      { status: 400, type: 'invalid_request_error', message: 'Upstream rejected the request (invalid_prompt)' }],
    [{ error: null }, { status: 502, type: 'api_error', message: 'Upstream Responses request failed (unknown)' }],
    [undefined, { status: 502, type: 'api_error', message: 'Upstream Responses request failed (unknown)' }],
    ['not-an-object', { status: 502, type: 'api_error', message: 'Upstream Responses request failed (unknown)' }],
  ])('failed snapshot %j classifies through response.error', (response, mapping) => {
    expect(classifyResponsesTerminal('response.failed', response, { hadToolUse: false }))
      .toEqual({ kind: 'error', cause: 'failed', mapping });
  });
});
