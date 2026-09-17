import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { MAX_BODY_SIZE, translateResponsesUsage } from './translation-proxy-helpers';

export class ResponsesStreamError extends Error {
  constructor(public readonly code: 'payload_too_large' | 'upstream_incomplete' | 'invalid_response') {
    super(code === 'payload_too_large'
      ? 'Upstream Responses payload exceeds the proxy body limit'
      : code === 'upstream_incomplete'
        ? 'Upstream response ended with incomplete tool input'
        : 'Invalid Responses event stream');
    this.name = 'ResponsesStreamError';
  }
}

const outputItem = z.object({
  type: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() })).optional(),
  call_id: z.string().optional(),
  name: z.string().optional(),
  arguments: z.string().optional(),
});
const responseSchema = z.object({
  status: z.string(),
  output: z.array(outputItem),
  incomplete_details: z.object({ reason: z.string() }).nullish(),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
    input_tokens_details: z.object({ cached_tokens: z.number().nonnegative().optional() }).nullish(),
  }).nullish(),
});
const eventSchema = z.object({
  type: z.string().optional(),
  response: z.unknown().optional(),
});

function collectMessageContent(item: z.infer<typeof outputItem>): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  for (const part of item.content ?? []) {
    if (part.type === 'output_text' && part.text !== undefined) {
      content.push({ type: 'text', text: part.text });
    } else if (part.type === 'refusal') {
      if (!part.refusal) throw new Error('Invalid refusal content');
      content.push({ type: 'text', text: part.refusal });
    }
  }
  return content;
}

function collectFunctionCall(item: z.infer<typeof outputItem>, status: string): Record<string, unknown> {
  if (!item.call_id || !item.name) throw new Error('Invalid function call');
  let input: Record<string, unknown>;
  try {
    if (typeof item.arguments !== 'string') throw new Error('Missing function arguments');
    input = z.record(z.string(), z.unknown()).parse(JSON.parse(item.arguments));
  } catch (error: unknown) {
    // Anthropic JSON tool_use requires an object; fabricating {} or
    // dropping the truncated call could execute the wrong operation.
    if (status === 'incomplete') throw new ResponsesStreamError('upstream_incomplete');
    throw error;
  }
  return { type: 'tool_use', id: item.call_id, name: item.name, input };
}

function collectOutputContent(response: z.infer<typeof responseSchema>): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];
  for (const item of response.output) {
    if (item.type === 'message') {
      for (const part of collectMessageContent(item)) content.push(part);
    } else if (item.type === 'function_call') {
      content.push(collectFunctionCall(item, response.status));
    }
  }
  return content;
}

function responseStopReason(response: z.infer<typeof responseSchema>, content: Array<Record<string, unknown>>): string {
  if (response.status === 'incomplete') return 'max_tokens';
  return content.some((item) => item['type'] === 'tool_use') ? 'tool_use' : 'end_turn';
}

/**
 * Non-streaming callers of a stream-only Responses endpoint still need one
 * Anthropic JSON message. The terminal response snapshot is authoritative:
 * adding deltas to it would duplicate text and function arguments. A clean EOF
 * AND a valid terminal snapshot are required; [DONE] alone is not completion.
 */
export function collectResponsesStream(
  upstream: IncomingMessage,
  downstream: ServerResponse,
  model: string,
  requestId: string,
  onUsage: (usage: ReturnType<typeof translateResponsesUsage>) => void = () => undefined,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let eventType = '';
    let data: string[] = [];
    let response: z.infer<typeof responseSchema> | undefined;
    let settled = false;
    let receivedBytes = 0;

    const cleanup = () => {
      upstream.off('data', onData);
      upstream.off('end', onEnd);
      upstream.off('error', onError);
      upstream.off('aborted', onAborted);
      upstream.off('close', onClose);
      downstream.off('close', onCancel);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      // An aborted IncomingMessage can emit error before its final close.
      // Drain that teardown error only; the original failure is already retained.
      if (!upstream.closed) {
        const drainError = () => undefined;
        upstream.on('error', drainError);
        upstream.once('close', () => upstream.off('error', drainError));
      }
      upstream.destroy();
      reject(error);
    };
    const dispatch = () => {
      if (!data.length) { eventType = ''; return; }
      const payload = data.join('\n');
      data = [];
      const type = eventType;
      eventType = '';
      if (payload === '[DONE]') return;
      const event = eventSchema.parse(JSON.parse(payload));
      const name = event.type ?? type;
      if (name === 'error' || name === 'response.failed') {
        throw new Error('Upstream Responses stream failed');
      }
      if (name === 'response.completed' || name === 'response.incomplete') {
        if (response) throw new Error('Duplicate terminal Responses event');
        response = responseSchema.parse(event.response);
        if (name === 'response.completed' && response.status !== 'completed') {
          throw new Error('Invalid completed response status');
        }
        if (name === 'response.incomplete' &&
          (response.status !== 'incomplete' || response.incomplete_details?.reason !== 'max_output_tokens')) {
          throw new Error('Unsuccessful incomplete response');
        }
      }
    };
    const line = (value: string) => {
      if (!value) { dispatch(); return; }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      const raw = colon < 0 ? '' : value.slice(colon + 1);
      const text = raw.startsWith(' ') ? raw.slice(1) : raw;
      if (field === 'event') eventType = text;
      if (field === 'data') data.push(text);
    };
    const onData = (chunk: string) => {
      try {
        // Reuse the proxy's existing 50 MiB body budget for the ENTIRE stream,
        // bounding pending lines, multiline events and terminal output together.
        receivedBytes += Buffer.byteLength(chunk, 'utf8');
        if (receivedBytes > MAX_BODY_SIZE) throw new ResponsesStreamError('payload_too_large');
        buffer += chunk;
        let match: RegExpExecArray | null;
        while ((match = /\r\n|\r|\n/.exec(buffer))) {
          // Hold a trailing CR so split CRLF is one delimiter, not two.
          if (match[0] === '\r' && match.index === buffer.length - 1) break;
          line(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
      } catch (error: unknown) {
        fail(error instanceof ResponsesStreamError ? error : new ResponsesStreamError('invalid_response'));
      }
    };
    const onEnd = () => {
      let content: Array<Record<string, unknown>>;
      let usage: ReturnType<typeof translateResponsesUsage>;
      try {
        // At EOF a held CR is a complete delimiter, not the start of CRLF.
        if (buffer.endsWith('\r')) {
          line(buffer.slice(0, -1));
          buffer = '';
        }
        // SSE dispatch requires a blank line; never treat truncated JSON as success.
        if (buffer || data.length || !response) throw new Error('Incomplete Responses stream');
        content = collectOutputContent(response);
        usage = translateResponsesUsage(response.usage);
      } catch (error: unknown) {
        fail(error instanceof ResponsesStreamError ? error : new ResponsesStreamError('invalid_response'));
        return;
      }

      try {
        // Keep failures in the injected observer distinguishable from malformed
        // upstream content: only parsing and translation errors map to 502.
        onUsage(usage);
        settled = true;
        cleanup();
        resolve({
          id: `msg_${requestId}`, type: 'message', role: 'assistant', model, content,
          stop_reason: responseStopReason(response, content),
          stop_sequence: null,
          usage,
        });
      } catch (error: unknown) {
        fail(error instanceof Error ? error : new Error('Responses usage observer failed'));
      }
    };
    const onError = () => fail(new Error('Responses stream read failed'));
    const onAborted = () => fail(new Error('Responses stream aborted'));
    const onClose = () => { if (!settled) onAborted(); };
    const onCancel = () => fail(new Error('Downstream disconnected'));
    upstream.setEncoding('utf8');
    upstream.on('data', onData);
    upstream.once('end', onEnd);
    upstream.once('error', onError);
    upstream.once('aborted', onAborted);
    upstream.once('close', onClose);
    downstream.once('close', onCancel);
    if (downstream.destroyed) onCancel();
  });
}
