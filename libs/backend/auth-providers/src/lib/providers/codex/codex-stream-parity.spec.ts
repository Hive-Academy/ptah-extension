import 'reflect-metadata';
import * as http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { SdkMessageTransformer, type SDKMessage } from '@ptah-extension/agent-sdk';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { CodexTranslationProxy } from './codex-translation-proxy';
import type { ICodexAuthService } from './codex-provider.types';

const response = (usage: unknown, output: unknown[] = [
  { type: 'message', content: [{ type: 'output_text', text: 'hello' }] },
]) => ({ status: 'completed', output, usage });

function auth(endpoint: string): ICodexAuthService {
  return {
    getAccountUsageEligibility: async () => 'supported',
    getApiEndpoint: () => endpoint,
    getHeaders: async () => ({ authorization: 'Bearer fake-only' }),
    ensureTokensFresh: async () => false,
    isAuthenticated: async () => true,
    listModels: async () => [],
    clearCache: () => undefined,
    getTokenStatus: async () => ({ authenticated: true, stale: false }),
    startWatchingAuthFile: () => undefined,
    stopWatchingAuthFile: () => undefined,
  };
}

function ptahConsumer(): { transformer: SdkMessageTransformer; total: () => number } {
  const values = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const usageTracker = {
    recordSessionUsage: (_id: string, next: Partial<typeof values>) => {
      for (const key of Object.keys(values) as Array<keyof typeof values>) {
        values[key] = Math.max(values[key], next[key] ?? values[key]);
      }
    },
    getCumulativeTokens: () => Object.values(values).reduce((sum, value) => sum + value, 0),
    clearSessionTokenSnapshot: () => undefined,
  };
  const logger = createMockLogger() as unknown as Logger;
  return {
    transformer: new SdkMessageTransformer(
      logger, {} as never, {} as never,
      { resolveForPricing: (model: string) => model } as never,
      {} as never, usageTracker as never,
      { markGenerating: () => undefined, settleTurn: () => undefined } as never,
    ),
    total: usageTracker.getCumulativeTokens,
  };
}

async function server(handler: http.RequestListener) {
  const instance = http.createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  const address = instance.address();
  if (!address || typeof address === 'string') throw new Error('Missing fake server address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      instance.close((error) => error ? reject(error) : resolve())),
  };
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe('Codex Responses real-consumer usage parity', () => {
  it.each([
    ['uncached', { input_tokens: 42, output_tokens: 9 }, undefined],
    ['cached', { input_tokens: 42, output_tokens: 9,
      input_tokens_details: { cached_tokens: 12 } }, undefined],
    ['tool', { input_tokens: 42, output_tokens: 9,
      input_tokens_details: { cached_tokens: 12 } }, [
      { type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{"path":"a"}' },
    ]],
    ['missing', undefined, undefined],
  ])('matches non-stream usage for %s terminal responses', async (_name, usage, output) => {
    const upstream = await server((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        const request = JSON.parse(body) as { stream?: boolean; model: string; instructions?: string };
        expect(request.model).toBe('gpt-test');
        expect(request.instructions).toBe('Keep this system prompt');
        const terminal = response(usage, output);
        if (request.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const contentWire = output
            ? sse({ type: 'response.output_item.added', output_index: 0,
              item: { type: 'function_call', call_id: 'call-1', name: 'read_file' } }) +
              sse({ type: 'response.function_call_arguments.delta', output_index: 0,
                delta: '{"path":"a"}' }) +
              sse({ type: 'response.output_item.done', output_index: 0,
                item: output[0] })
            : sse({ type: 'response.output_text.delta', delta: 'hello' });
          const wire = contentWire +
            sse({ type: 'response.completed', response: terminal }) +
            sse({ type: 'response.completed', response: terminal }) + 'data: [DONE]\n\n';
          for (const piece of [wire.slice(0, 7), wire.slice(7, 31), wire.slice(31)]) res.write(piece);
          res.end();
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(terminal));
        }
      });
    });
    const logger = createMockLogger();
    const proxy = new CodexTranslationProxy(
      logger as unknown as Logger, auth(upstream.origin),
    );
    try {
      const { url } = await proxy.start();
      const client = new Anthropic({ apiKey: 'fake-client-key', baseURL: url });
      const request = {
        model: 'gpt-test', max_tokens: 50,
        system: 'Keep this system prompt',
        messages: [{ role: 'user' as const, content: 'hi' }],
      };
      const plain = await client.messages.create(request);
      const stream = client.messages.stream(request);
      const consumer = ptahConsumer();
      for await (const event of stream) {
        consumer.transformer.transform(
          { type: 'stream_event', event } as unknown as SDKMessage,
          'session-parity' as never,
        );
      }
      const streamed = await stream.finalMessage();
      expect(streamed.usage).toEqual(plain.usage);
      expect(consumer.total()).toBe(
        plain.usage.input_tokens + plain.usage.output_tokens +
        (plain.usage.cache_read_input_tokens ?? 0),
      );
      expect(streamed.stop_reason).toBe(output ? 'tool_use' : 'end_turn');
    } finally {
      await proxy.stop();
      await upstream.close();
    }
  });

  it.each([
    ['malformed', sse({ type: 'response.completed', response: response({ input_tokens: 'secret', output_tokens: 9 }) })],
    ['early EOF', sse({ type: 'response.output_text.delta', delta: 'partial' })],
  ])('fails closed for %s streams', async (_name, wire) => {
    const upstream = await server((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(wire);
    });
    const logger = createMockLogger();
    const proxy = new CodexTranslationProxy(
      logger as unknown as Logger, auth(upstream.origin),
    );
    try {
      const { url } = await proxy.start();
      const client = new Anthropic({ apiKey: 'fake-client-key', baseURL: url });
      const stream = client.messages.stream({
        model: 'gpt-test', max_tokens: 50,
        messages: [{ role: 'user', content: 'hi' }],
      });
      await expect(stream.finalMessage()).rejects.toThrow();
      const timingCalls = logger.debug.mock.calls.filter(([message]) =>
        String(message).includes('proxy phase timing'));
      expect(timingCalls).toHaveLength(1);
      expect(timingCalls[0][1]).toMatchObject({ status: 'invalid-response' });
      expect(JSON.stringify(timingCalls[0][1])).not.toContain('secret');
    } finally {
      await proxy.stop();
      await upstream.close();
    }
  });
});
