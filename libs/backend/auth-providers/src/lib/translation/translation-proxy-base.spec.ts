/**
 * TranslationProxyBase â€” unit specs.
 *
 * Surface under test:
 *   - Lifecycle: `start()` binds to an OS-assigned port on 127.0.0.1,
 *     `isRunning()` flips to true, `getUrl()` returns the bound URL, and
 *     `stop()` tears down cleanly.
 *   - Routing:
 *       * GET  /health         â†’ 200 { status: 'ok' }
 *       * GET  /v1/models      â†’ 200 { object: 'list', data: [...] } derived
 *                                from `getStaticModels()`.
 *       * POST /v1/messages    â†’ delegates to the translator pipeline.
 *       * any other path       â†’ 404 with Anthropic-shaped error body.
 *   - Error shape: `sendErrorResponse()` always emits
 *     `{ type: 'error', error: { type, message } }` with the correct status.
 *
 * We instantiate the abstract base through a tiny concrete subclass that
 * overrides the 4 abstract hooks with stubs. Because the translator pipeline
 * and upstream forwarding are exercised by their own specs (and require a
 * fake upstream HTTP server), we only touch the routing surface here.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/openai-translation/translation-proxy-base.ts`
 */

import 'reflect-metadata';

import * as http from 'http';
import { createHash } from 'node:crypto';
import { APIError } from '@anthropic-ai/sdk';
import { CodexTranslationProxy } from '../providers/codex/codex-translation-proxy';
import { CopilotTranslationProxy } from '../providers/copilot/copilot-translation-proxy';
import { OpenRouterTranslationProxy } from '../providers/openrouter/openrouter-translation-proxy';
import { LocalModelTranslationProxy } from '../providers/local/local-model-translation-proxy';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import {
  TranslationProxyBase,
  type TranslationProxyConfig,
  type ProxyPhaseTimingRecord,
  type ProxyTimingOptions,
} from './translation-proxy-base';
import { translateAnthropicToResponses } from './responses-request-translator';
import type { AnthropicMessagesRequest } from './openai-translation.types';
import {
  providerQuotaStore,
  PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
} from '../auth/provider-quota.store';

// ---------------------------------------------------------------------------
// Concrete subclass â€” stubs the 4 abstract hooks.
// ---------------------------------------------------------------------------

class FakeTranslationProxy extends TranslationProxyBase {
  constructor(
    logger: Logger,
    config: TranslationProxyConfig,
    timing?: ProxyTimingOptions,
  ) {
    super(logger, config, timing);
  }
  /**
   * The REGISTRY id the quota store is keyed on. Settable so the two dynamic
   * subclasses' shape (id known only at construction) is exercised here too.
   */
  public providerId = 'fake-provider';
  public protocol: 'messages' | 'chat/completions' | 'responses' | undefined =
    'chat/completions';
  public forceResponsesStream = false;
  public upstreamTimeoutMs = 600_000;
  public readonly normalizeModelIdMock = jest.fn((model: string) => model);
  protected override normalizeModelId(model: string): string {
    return this.normalizeModelIdMock(model);
  }
  public override getAuthFailureMessage(): string {
    return super.getAuthFailureMessage();
  }
  public override getUpstreamErrorMessage(
    status: number,
    body: string,
  ): string {
    return super.getUpstreamErrorMessage(status, body);
  }
  public override resolveUpstreamProtocol(_modelId: string) {
    return this.protocol;
  }
  protected override requiresResponsesStream(): boolean {
    return this.forceResponsesStream;
  }
  public readonly getApiEndpointMock = jest.fn(
    async () => 'http://127.0.0.1:1', // intentionally-unreachable port for forwarding tests
  );
  public readonly getHeadersMock = jest.fn(async () => ({
    authorization: 'Bearer fake',
    'content-type': 'application/json',
  }));
  public readonly onAuthFailureMock = jest.fn(async () => false);
  public readonly getStaticModelsMock = jest.fn(() => [
    { id: 'fake-model-a' },
    { id: 'fake-model-b' },
  ]);

  protected override getApiEndpoint(): Promise<string> {
    return this.getApiEndpointMock();
  }
  protected override getHeaders(): Promise<Record<string, string>> {
    return this.getHeadersMock();
  }
  protected override onAuthFailure(): Promise<boolean> {
    return this.onAuthFailureMock();
  }
  protected override getStaticModels(): Array<{ id: string }> {
    return this.getStaticModelsMock();
  }
  protected override getUpstreamTimeoutMs(): number {
    return this.upstreamTimeoutMs;
  }
  protected override getProviderId(): string {
    return this.providerId;
  }
}

// ---------------------------------------------------------------------------
// Minimal HTTP helper â€” makes a localhost request and collects the response.
// ---------------------------------------------------------------------------

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  url: string,
  opts: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: Number(u.port),
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: opts.body
          ? {
              ...opts.headers,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(opts.body).toString(),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('error', reject);
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Test harness â€” fresh proxy per test, guaranteed cleanup.
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TranslationProxyConfig = {
  name: 'Fake',
  modelPrefix: '',
  completionsPath: '/chat/completions',
};

interface Harness {
  logger: MockLogger;
  proxy: FakeTranslationProxy;
  url: string;
  stop: () => Promise<void>;
}

async function startProxy(
  config: TranslationProxyConfig = DEFAULT_CONFIG,
  timing?: ProxyTimingOptions,
): Promise<Harness> {
  const logger = createMockLogger();
  const proxy = new FakeTranslationProxy(
    logger as unknown as Logger,
    config,
    timing,
  );
  const { url } = await proxy.start();
  return {
    logger,
    proxy,
    url,
    stop: () => proxy.stop(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TranslationProxyBase â€” lifecycle', () => {
  it('start() binds to 127.0.0.1 on an OS-assigned port and marks isRunning=true', async () => {
    const h = await startProxy();
    try {
      expect(h.proxy.isRunning()).toBe(true);
      expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(h.proxy.getUrl()).toBe(h.url);
    } finally {
      await h.stop();
    }
  });

  it('stop() releases the port and flips isRunning back to false', async () => {
    const h = await startProxy();
    const urlWhileUp = h.url;
    await h.stop();
    expect(h.proxy.isRunning()).toBe(false);
    expect(h.proxy.getUrl()).toBeUndefined();
    // A follow-up request to the same URL must fail at the socket layer.
    await expect(request(urlWhileUp + '/health')).rejects.toThrow();
  });

  it('start() is idempotent â€” a second call returns the same URL without re-binding', async () => {
    const h = await startProxy();
    try {
      const second = await h.proxy.start();
      expect(second.url).toBe(h.url);
    } finally {
      await h.stop();
    }
  });

  it('stop() is a no-op when the proxy has never started', async () => {
    const logger = createMockLogger();
    const proxy = new FakeTranslationProxy(
      logger as unknown as Logger,
      DEFAULT_CONFIG,
    );
    await expect(proxy.stop()).resolves.toBeUndefined();
    expect(proxy.isRunning()).toBe(false);
  });
});

describe('TranslationProxyBase â€” routing', () => {
  it('GET /health responds with 200 { status: "ok" }', async () => {
    const h = await startProxy();
    try {
      const res = await request(`${h.url}/health`);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
    } finally {
      await h.stop();
    }
  });

  it('GET /v1/models returns the static model list from getStaticModels()', async () => {
    const h = await startProxy();
    try {
      const res = await request(`${h.url}/v1/models`);
      expect(res.status).toBe(200);
      const body = JSON.parse(res.body) as {
        object: string;
        data: Array<{ id: string; object: string }>;
      };
      expect(body.object).toBe('list');
      expect(body.data.map((m) => m.id)).toEqual([
        'fake-model-a',
        'fake-model-b',
      ]);
      expect(body.data[0].object).toBe('model');
    } finally {
      await h.stop();
    }
  });

  it('unknown routes respond with 404 in Anthropic error-shape', async () => {
    const h = await startProxy();
    try {
      const res = await request(`${h.url}/v1/nope`);
      expect(res.status).toBe(404);
      const body = JSON.parse(res.body) as {
        type: string;
        error: { type: string; message: string };
      };
      expect(body).toMatchObject({
        type: 'error',
        error: { type: 'not_found_error' },
      });
      expect(body.error.message).toMatch(/nope/i);
    } finally {
      await h.stop();
    }
  });

  it('POST /v1/messages with an invalid JSON body responds with 400 invalid_request_error', async () => {
    const h = await startProxy();
    try {
      const res = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: '{not json',
      });
      expect(res.status).toBe(400);
      const body = JSON.parse(res.body) as {
        error: { type: string };
      };
      expect(body.error.type).toBe('invalid_request_error');
    } finally {
      await h.stop();
    }
  });
});

// ---------------------------------------------------------------------------
// The 429 side effect (TASK_2026_306 defect B, task 2.1).
//
// Two halves that have to hold together:
//   * the RESPONSE is untouched â€” status, headers, body and message are exactly
//     what they were before the quota store existed. `context.md` puts the 429
//     response explicitly out of scope: it was already correct.
//   * the SIDE EFFECT fires â€” a cooldown is recorded against the REGISTRY
//     provider id (never the `name` display label), and cleared again the
//     moment the upstream answers.
//
// A real upstream on loopback, because the branch under test reads
// `proxyRes.statusCode` and `proxyRes.headers['retry-after']` off a live
// response; a mocked `http.request` would assert only that the code calls what
// it was written to call.
// ---------------------------------------------------------------------------

/** Minimal upstream that answers every POST with a scripted status. */
async function startUpstream(handler: http.RequestListener): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no upstream address');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe('TranslationProxyBase SDK message envelope', () => {
  it.each(['messages', 'chat/completions', 'responses'] as const)(
    'accepts SDK system turns and preserves their position through %s',
    async (protocol) => {
      let received: Record<string, unknown> | undefined;
      const upstream = await startUpstream((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          received = JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >;
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify(
              protocol === 'responses'
                ? { status: 'completed', output: [] }
                : {
                    choices: [
                      { message: { content: 'ok' }, finish_reason: 'stop' },
                    ],
                  },
            ),
          );
        });
      });
      const h = await startProxy();
      h.proxy.protocol = protocol;
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      // Synthetic-content fixture from SDK 0.3.278 / CLI 2.1.278:
      // the first gpt-5.6-sol request has user text blocks followed by a system turn.
      const body = {
        model: 'gpt-5.6-sol',
        max_tokens: 32000,
        stream: false,
        system: [{ type: 'text', text: 'Base instructions' }],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Context' },
              { type: 'text', text: 'Hello' },
            ],
          },
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text: 'SDK instructions',
                cache_control: { type: 'ephemeral' },
              },
            ],
          },
          { role: 'assistant', content: 'Hi' },
          { role: 'system', content: 'Updated instructions' },
          { role: 'user', content: '' },
          { role: 'user', content: [] },
        ],
      };
      try {
        const result = await request(`${h.url}/v1/messages?beta=true`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: NATIVE_HEADERS,
        });
        expect(result.status).toBe(200);
        expect(received?.['model']).toBe('gpt-5.6-sol');
        if (protocol === 'messages') {
          expect(received).toEqual(body);
        } else {
          const systemRole = protocol === 'responses' ? 'developer' : 'system';
          const turns =
            received?.[protocol === 'responses' ? 'input' : 'messages'];
          expect(turns).toEqual([
            { role: systemRole, content: 'Base instructions' },
            expect.objectContaining({ role: 'user' }),
            { role: systemRole, content: 'SDK instructions' },
            expect.objectContaining({ role: 'assistant' }),
            { role: systemRole, content: 'Updated instructions' },
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'user' }),
          ]);
        }
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );

  it.each([
    [{ model: ' ' }, 'model'],
    [{ max_tokens: undefined }, 'max_tokens'],
    [{ max_tokens: 0 }, 'max_tokens'],
    [{ max_tokens: -1 }, 'max_tokens'],
    [{ max_tokens: 1.5 }, 'max_tokens'],
    [{ max_tokens: 'private-token' }, 'max_tokens'],
    [{ messages: {} }, 'messages'],
    [
      { messages: [{ role: 'private-role', content: 'private-message' }] },
      'messages.role',
    ],
    [{ messages: [{ role: 'system', content: null }] }, 'messages.content'],
    [
      { messages: [{ role: 'user', content: [{ text: 'private-message' }] }] },
      'messages.content',
    ],
    [{ stream: 'private-token' }, 'stream'],
    [{ model: null, max_tokens: 0 }, 'model, max_tokens'],
  ])(
    'rejects malformed fields without exposing values: %j',
    async (invalid, fields) => {
      const h = await startProxy();
      try {
        const result = await request(`${h.url}/v1/messages?beta=true`, {
          method: 'POST',
          body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), ...invalid }),
        });
        expect(result.status).toBe(400);
        expect(JSON.parse(result.body)).toEqual({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: `Invalid Messages request: invalid fields: ${fields}`,
          },
        });
        expect(result.body).not.toContain('private-');
        expect(h.proxy.normalizeModelIdMock).not.toHaveBeenCalled();
        expect(h.proxy.getHeadersMock).not.toHaveBeenCalled();
        expect(h.proxy.getApiEndpointMock).not.toHaveBeenCalled();
      } finally {
        await h.stop();
      }
    },
  );

  it.each([
    ['missing', undefined],
    ['null', null],
    ['number', 42],
    ['boolean', true],
    ['array', ['private-message']],
    ['object', { secret: 'private-token' }],
  ])(
    'rejects %s text in system blocks with a field-only error',
    async (_label, text) => {
      const h = await startProxy();
      try {
        const result = await request(`${h.url}/v1/messages?beta=true`, {
          method: 'POST',
          body: JSON.stringify({
            ...JSON.parse(MESSAGES_BODY),
            messages: [
              { role: 'user', content: 'private-message' },
              {
                role: 'system',
                content: [
                  { type: 'text', text: 'valid instructions' },
                  { type: 'text', text },
                  { type: 'text', text },
                ],
              },
            ],
          }),
        });
        expect(result.status).toBe(400);
        expect(JSON.parse(result.body)).toEqual({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message:
              'Invalid Messages request: invalid fields: messages.content.text',
          },
        });
        expect(result.body).not.toContain('private-');
        expect(h.proxy.normalizeModelIdMock).not.toHaveBeenCalled();
        expect(h.proxy.getHeadersMock).not.toHaveBeenCalled();
        expect(h.proxy.getApiEndpointMock).not.toHaveBeenCalled();
      } finally {
        await h.stop();
      }
    },
  );

  it('preserves non-text system directives and unchanged user/assistant block validation', async () => {
    let received: unknown;
    const upstream = await startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString());
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      });
    });
    const h = await startProxy();
    h.proxy.protocol = 'messages';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    const body = {
      ...JSON.parse(MESSAGES_BODY),
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'tool_addition',
              tool: { type: 'tool_reference', name: 'lookup' },
            },
            {
              type: 'tool_removal',
              tool: { type: 'tool_reference', name: 'lookup' },
            },
          ],
        },
        ...(['user', 'assistant'] as const).map((role) => ({
          role,
          content: [
            { type: 'text' },
            { type: 'text', text: null },
            { type: 'provider-extension', payload: { untouched: true } },
          ],
        })),
      ],
    };
    try {
      const result = await request(`${h.url}/v1/messages?beta=true`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: NATIVE_HEADERS,
      });
      expect(result.status).toBe(200);
      expect(received).toEqual(body);
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it.each(['null', '[]'])(
    'names body for an invalid root: %s',
    async (body) => {
      const h = await startProxy();
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body,
        });
        expect(result.status).toBe(400);
        expect(JSON.parse(result.body).error.message).toBe(
          'Invalid Messages request: invalid fields: body',
        );
      } finally {
        await h.stop();
      }
    },
  );
});

const MESSAGES_BODY = JSON.stringify({
  model: 'fake-model-a',
  max_tokens: 16,
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
});

describe('TranslationProxyBase â€” Responses JSON usage', () => {
  it('records monotonic metadata-only phases with exact request and inexact compaction correlation', async () => {
    const forbidden = [
      'authorization',
      'header',
      'prompt',
      'messages',
      'body',
      'tool',
      'secret',
    ];
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'x-secret': 'never-record',
      });
      res.end(
        JSON.stringify({
          status: 'completed',
          output: [],
          usage: {
            input_tokens: 42,
            output_tokens: 9,
            input_tokens_details: { cached_tokens: 12 },
          },
        }),
      );
    });
    let tick = 100;
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: () => tick++,
      record: (record) => records.push(record),
    });
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
      });
      expect(result.status).toBe(200);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record).toMatchObject({
        requestCorrelation: 'exact',
        compactionCorrelation: 'inexact',
        overlapCount: 0,
        retryOrdinal: 0,
        stream: false,
        status: 'success',
        terminalInputTokens: 30,
        terminalCacheReadTokens: 12,
        terminalOutputTokens: 9,
      });
      expect([
        record.requestReceivedAt,
        record.requestParsedAt,
        record.attemptStartedAt,
        record.upstreamResponseAt,
        record.firstByteAt,
        record.finishedAt,
      ]).toEqual([100, 101, 102, 103, 104, 105]);
      const keys = Object.keys(record).map((key) => key.toLowerCase());
      for (const fragment of forbidden) {
        expect(keys.some((key) => key.includes(fragment))).toBe(false);
      }
      expect(JSON.stringify(record)).not.toContain('never-record');
      expect(JSON.stringify(record)).not.toContain('Bearer fake');
      expect(record.requestBytes).toBeGreaterThan(0);
      expect(record.responseBytes).toBeGreaterThan(0);
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it.each([false, true])(
    'contains malformed usage over HTTP (stream=%s)',
    async (stream) => {
      const upstream = await startUpstream((_req, res) => {
        const response = {
          status: 'completed',
          output: [],
          usage: { input_tokens: 'private-upstream-value', output_tokens: 9 },
        };
        res.writeHead(200, {
          'Content-Type': stream ? 'text/event-stream' : 'application/json',
        });
        res.end(
          stream
            ? `data: ${JSON.stringify({ type: 'response.completed', response })}\n\ndata: [DONE]\n\n`
            : JSON.stringify(response),
        );
      });
      const records: ProxyPhaseTimingRecord[] = [];
      const h = await startProxy(DEFAULT_CONFIG, {
        now: () => 1,
        record: (record) => records.push(record),
      });
      h.proxy.protocol = 'responses';
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream }),
        });
        expect(result.body).not.toContain('private-upstream-value');
        expect(records).toHaveLength(1);
        expect(records[0].status).toBe('invalid-response');
        if (stream) {
          // No output preceded the rejected terminal, so no stream was opened.
          expect(result.status).toBe(502);
          expect(JSON.parse(result.body)).toEqual({
            type: 'error',
            error: {
              type: 'api_error',
              message: 'Invalid upstream Responses usage',
            },
          });
        } else {
          expect(result.status).toBe(500);
          expect(JSON.parse(result.body)).toEqual({
            type: 'error',
            error: {
              type: 'api_error',
              message: 'Failed to translate Fake response',
            },
          });
        }
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );
  it.each([
    [undefined, 42, undefined],
    [{}, 42, undefined],
    [{ cached_tokens: 0 }, 42, 0],
    [{ cached_tokens: 12 }, 30, 12],
    [{ cached_tokens: 99 }, 0, 42],
  ])(
    'forwards input/cache without double counting %j',
    async (details, input, cache) => {
      const upstream = await startUpstream((req, res) => {
        expect(req.url).toBe('/responses');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'completed',
            output: [
              {
                type: 'function_call',
                call_id: 'call',
                name: 'read_file',
                arguments: '{"path":"a"}',
              },
            ],
            usage: {
              input_tokens: 42,
              output_tokens: 9,
              input_tokens_details: details,
              output_tokens_details: { reasoning_tokens: 7 },
            },
          }),
        );
      });
      const h = await startProxy();
      h.proxy.protocol = 'responses';
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      try {
        const response = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body: MESSAGES_BODY,
        });
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', input: { path: 'a' } }],
        });
        expect(JSON.parse(response.body).usage).toEqual({
          input_tokens: input,
          output_tokens: 9,
          ...(cache !== undefined ? { cache_read_input_tokens: cache } : {}),
        });
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );
});

describe('TranslationProxyBase â€” 429 records a provider cooldown', () => {
  beforeEach(() => providerQuotaStore.clear());
  afterEach(() => providerQuotaStore.clear());

  async function runAgainstUpstream(
    handler: http.RequestListener,
    providerId = 'fake-provider',
  ): Promise<HttpResult> {
    const upstream = await startUpstream(handler);
    const h = await startProxy();
    h.proxy.providerId = providerId;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      return await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
      });
    } finally {
      await h.stop();
      await upstream.close();
    }
  }

  it('leaves the bare-429 response byte-identical while recording the cooldown', async () => {
    const res = await runAgainstUpstream((_req, upRes) => {
      upRes.writeHead(429, { 'Content-Type': 'application/json' });
      upRes.end('{"error":"rate limited"}');
    });

    // The response, asserted exhaustively rather than by `toMatchObject`.
    expect(res.status).toBe(429);
    expect(JSON.parse(res.body)).toEqual({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: 'Fake API rate limit exceeded. Please wait and try again.',
      },
    });
    // No header arrived, so none is forwarded. The gate still arms.
    expect(res.headers['retry-after']).toBeUndefined();

    const state = providerQuotaStore.cooldownFor('fake-provider');
    expect(state).not.toBeNull();
    expect(providerQuotaStore.retryAfterMs('fake-provider')).toBeGreaterThan(0);
    expect(
      providerQuotaStore.retryAfterMs('fake-provider'),
    ).toBeLessThanOrEqual(PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS);
  });

  it('honours an upstream retry-after in BOTH the response and the cooldown', async () => {
    const res = await runAgainstUpstream((_req, upRes) => {
      upRes.writeHead(429, { 'retry-after': '120' });
      upRes.end('{}');
    });

    // Response half: header forwarded, message carries the sentence. Unchanged.
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('120');
    expect(JSON.parse(res.body)).toEqual({
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message:
          'Fake API rate limit exceeded. Retry after 120 seconds. Please wait and try again.',
      },
    });

    // Side-effect half: the honoured delay, not the 15-minute default.
    const ms = providerQuotaStore.retryAfterMs('fake-provider');
    expect(ms).toBeGreaterThan(110_000);
    expect(ms).toBeLessThanOrEqual(120_000);
  });

  it('keys on the REGISTRY id the subclass answers with, not the display name', async () => {
    // `TranslationProxyConfig.name` is `'Fake'` here. A store keyed on that
    // would record a cooldown `ProviderAuthResolver` can never match.
    await runAgainstUpstream((_req, upRes) => {
      upRes.writeHead(429);
      upRes.end('{}');
    }, 'dynamic-entry-id');

    expect(providerQuotaStore.cooldownFor('dynamic-entry-id')).not.toBeNull();
    expect(providerQuotaStore.cooldownFor('Fake')).toBeNull();
  });

  it('clears the cooldown on the next successful answer, not only on expiry', async () => {
    // A subscription that refilled early must not stay gated for the rest of
    // the cooldown.
    providerQuotaStore.recordRateLimit('fake-provider');
    expect(providerQuotaStore.cooldownFor('fake-provider')).not.toBeNull();

    const res = await runAgainstUpstream((_req, upRes) => {
      upRes.writeHead(200, { 'Content-Type': 'application/json' });
      upRes.end(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'fake-model-a',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    });

    expect(res.status).toBe(200);
    expect(providerQuotaStore.cooldownFor('fake-provider')).toBeNull();
  });

  it('does not clear the cooldown on a non-429 upstream error', async () => {
    // Only an ANSWER clears it. A 500 is not evidence the quota refilled.
    providerQuotaStore.recordRateLimit('fake-provider');

    const res = await runAgainstUpstream((_req, upRes) => {
      upRes.writeHead(500);
      upRes.end('{"error":"boom"}');
    });

    expect(res.status).toBe(500);
    expect(providerQuotaStore.cooldownFor('fake-provider')).not.toBeNull();
  });
});

describe('TranslationProxyBase phase timing terminal paths', () => {
  const assertSafeTiming = (
    records: ProxyPhaseTimingRecord[],
    status: ProxyPhaseTimingRecord['status'],
  ) => {
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe(status);
    const serialized = JSON.stringify(records);
    for (const secret of [
      'Bearer fake',
      'private-upstream-value',
      'Keep this prompt',
      'read_file',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  };

  async function timedProxy() {
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: Date.now,
      record: (record) => records.push(record),
    });
    return { ...h, records };
  }

  it.each([
    ['complete usage', { input_tokens: 3, output_tokens: 2 }],
    ['missing usage', undefined],
  ])('records stream success exactly once for %s', async (_name, usage) => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'x-private': 'private-upstream-value',
      });
      res.end(
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [],
            usage,
          },
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    const h = await timedProxy();
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      expect(
        (
          await request(`${h.url}/v1/messages`, {
            method: 'POST',
            body: JSON.stringify({
              ...JSON.parse(MESSAGES_BODY),
              stream: true,
              system: 'Keep this prompt',
            }),
          })
        ).status,
      ).toBe(200);
      assertSafeTiming(h.records, 'success');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records invalid-response exactly once for an early SSE EOF', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        'data: {"type":"response.output_text.delta","delta":"private-upstream-value"}\n\n',
      );
    });
    const h = await timedProxy();
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream: true }),
      });
      assertSafeTiming(h.records, 'invalid-response');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('uses the 502 path and records forced-stream invalid usage exactly once', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        `data: ${JSON.stringify({
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [],
            usage: { input_tokens: 'private-upstream-value', output_tokens: 2 },
          },
        })}\n\n`,
      );
    });
    const h = await timedProxy();
    h.proxy.protocol = 'responses';
    h.proxy.forceResponsesStream = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
      });
      expect(result.status).toBe(502);
      assertSafeTiming(h.records, 'invalid-response');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it.each([
    [
      'malformed function arguments',
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [
            {
              type: 'function_call',
              call_id: 'call',
              name: 'read_file',
              arguments: '{"private-upstream-value":',
            },
          ],
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      })}\n\n`,
    ],
    [
      'wrong content shape',
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{ type: 'message', content: 'private-upstream-value' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        },
      })}\n\n`,
    ],
    [
      'invalid JSON frame',
      'data: {"type":"response.completed","private-upstream-value":\n\n',
    ],
  ])(
    'uses the 502 path and records forced-stream %s exactly once',
    async (_name, wire) => {
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(wire);
      });
      const h = await timedProxy();
      h.proxy.protocol = 'responses';
      h.proxy.forceResponsesStream = true;
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body: MESSAGES_BODY,
        });
        expect(result.status).toBe(502);
        expect(result.body).toContain('invalid_response');
        assertSafeTiming(h.records, 'invalid-response');
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );

  it('records rate-limited exactly once', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(429);
      res.end();
    });
    const h = await timedProxy();
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      expect(
        (
          await request(`${h.url}/v1/messages`, {
            method: 'POST',
            body: MESSAGES_BODY,
          })
        ).status,
      ).toBe(429);
      assertSafeTiming(h.records, 'rate-limited');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records timeout exactly once and retains the 600000 ms production default', async () => {
    const upstream = await startUpstream(() => undefined);
    const h = await timedProxy();
    h.proxy.upstreamTimeoutMs = 10;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      expect(
        (
          await request(`${h.url}/v1/messages`, {
            method: 'POST',
            body: MESSAGES_BODY,
          })
        ).status,
      ).toBe(504);
      assertSafeTiming(h.records, 'timeout');
      expect(
        new FakeTranslationProxy(h.logger as unknown as Logger, DEFAULT_CONFIG)
          .upstreamTimeoutMs,
      ).toBe(600_000);
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records network-error exactly once', async () => {
    const upstream = await startUpstream((req) => req.socket.destroy());
    const h = await timedProxy();
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      expect(
        (
          await request(`${h.url}/v1/messages`, {
            method: 'POST',
            body: MESSAGES_BODY,
          })
        ).status,
      ).toBe(500);
      assertSafeTiming(h.records, 'network-error');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records pre-write cancellation exactly once', async () => {
    let releaseHeaders!: (headers: {
      authorization: string;
      'content-type': string;
    }) => void;
    let recorded!: () => void;
    const recordedPromise = new Promise<void>((resolve) => {
      recorded = resolve;
    });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: Date.now,
      record: (record) => {
        records.push(record);
        recorded();
      },
    });
    h.proxy.getHeadersMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseHeaders = resolve;
        }),
    );
    const client = http.request(`${h.url}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(MESSAGES_BODY),
      },
    });
    client.on('error', () => undefined);
    client.end(MESSAGES_BODY);
    while (!h.proxy.getHeadersMock.mock.calls.length)
      await new Promise((resolve) => setImmediate(resolve));
    client.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    releaseHeaders({
      authorization: 'Bearer fake',
      'content-type': 'application/json',
    });
    await recordedPromise;
    assertSafeTiming(records, 'cancelled');
    await h.stop();
  });

  it.each(['responses', 'messages'] as const)(
    'records mid-stream cancellation exactly once for %s',
    async (protocol) => {
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        );
      });
      let recorded!: () => void;
      const recordedPromise = new Promise<void>((resolve) => {
        recorded = resolve;
      });
      const records: ProxyPhaseTimingRecord[] = [];
      const h = await startProxy(DEFAULT_CONFIG, {
        now: Date.now,
        record: (record) => {
          records.push(record);
          recorded();
        },
      });
      h.proxy.protocol = protocol;
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      const body = JSON.stringify({
        ...JSON.parse(MESSAGES_BODY),
        stream: true,
      });
      const client = http.request(
        `${h.url}/v1/messages`,
        {
          method: 'POST',
          headers: {
            ...NATIVE_HEADERS,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => response.once('data', () => response.destroy()),
      );
      client.on('error', () => undefined);
      client.end(body);
      await recordedPromise;
      assertSafeTiming(records, 'cancelled');
      await h.stop();
      await upstream.close();
    },
  );

  it('counts other in-flight attempts and decrements exactly once', async () => {
    const responders: http.ServerResponse[] = [];
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const upstream = await startUpstream((_req, res) => {
      responders.push(res);
      if (responders.length === 2) release();
    });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: Date.now,
      record: (record) => records.push(record),
    });
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    const calls = [1, 2].map(() =>
      request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY }),
    );
    await ready;
    for (const res of responders) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', output: [] }));
    }
    await Promise.all(calls);
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.overlapCount).sort()).toEqual([0, 1]);
    expect(records.every((record) => record.status === 'success')).toBe(true);
    await h.stop();
    await upstream.close();
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_408 Phase 1: overflow mapping, one terminal per stream, and the
// same outcome on the stream, forced-SSE collector and JSON paths.
// ---------------------------------------------------------------------------

const SENTINEL = 'private-upstream-value';
const PROMPT_TOO_LONG_DEFAULT =
  "prompt is too long: the request exceeds the model's context window";
const INCOMPLETE_TOOL_INPUT =
  'upstream_incomplete: Upstream response ended with incomplete tool input';

interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

function parseSseBody(body: string): SseFrame[] {
  return body
    .split('\n\n')
    .filter((frame) => frame.trim())
    .map((frame) => {
      const lines = frame.split('\n');
      const event = (lines.find((l) => l.startsWith('event: ')) ?? '').slice(7);
      const data = (lines.find((l) => l.startsWith('data: ')) ?? '').slice(6);
      return { event, data: JSON.parse(data) as Record<string, unknown> };
    });
}

async function timedHarness() {
  const records: ProxyPhaseTimingRecord[] = [];
  const h = await startProxy(DEFAULT_CONFIG, {
    now: Date.now,
    record: (record) => records.push(record),
  });
  return { ...h, records };
}

describe('TranslationProxyBase upstream context overflow', () => {
  const overflowBody = JSON.stringify({
    error: {
      code: 'context_length_exceeded',
      message: `Your input exceeds the context window of this model. ${SENTINEL}`,
    },
  });

  it.each([
    ['responses', false],
    ['responses', true],
    ['chat/completions', false],
    ['chat/completions', true],
  ] as const)(
    'maps an upstream 400 overflow to the prompt-too-long contract (%s, stream=%s)',
    async (protocol, stream) => {
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(overflowBody);
      });
      const h = await timedHarness();
      h.proxy.protocol = protocol;
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream }),
        });
        expect(result.status).toBe(400);
        const body = JSON.parse(result.body);
        expect(body).toEqual({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: PROMPT_TOO_LONG_DEFAULT,
          },
        });
        expect(result.body).not.toContain(SENTINEL);
        // The installed SDK client error the CLI inspects carries the phrase.
        expect(
          APIError.generate(400, body, undefined, new Headers()).message,
        ).toContain('prompt is too long');
        expect(h.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('upstream 400 classified as context overflow'),
        );
        const logged = JSON.stringify([
          h.logger.warn.mock.calls,
          h.logger.error.mock.calls,
          h.logger.info.mock.calls,
          h.logger.debug.mock.calls,
        ]);
        expect(logged).not.toContain(SENTINEL);
        expect(h.records).toHaveLength(1);
        expect(h.records[0].status).toBe('upstream-error');
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );

  it('carries token counts from a 413 Chat-style overflow into the token-gap shape', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          message: `This model's maximum context length is 128000 tokens. However, your messages resulted in 130532 tokens. ${SENTINEL}`,
        }),
      );
    });
    const h = await timedHarness();
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
      });
      expect(result.status).toBe(400);
      const message = JSON.parse(result.body).error.message as string;
      expect(message).toBe('prompt is too long: 130532 tokens > 128000 maximum');
      expect(message).toMatch(
        /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i,
      );
      expect(result.body).not.toContain(SENTINEL);
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it.each(['responses', 'chat/completions'] as const)(
    'keeps a non-overflow 400 byte-identical to the legacy api_error body (%s)',
    async (protocol) => {
      const upstreamBody = JSON.stringify({
        error: { code: 'invalid_request', message: 'Unsupported parameter: foo' },
      });
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(upstreamBody);
      });
      const h = await timedHarness();
      h.proxy.protocol = protocol;
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body: MESSAGES_BODY,
        });
        expect(result.status).toBe(400);
        expect(result.body).toBe(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'api_error',
              message: `Fake API error (400): ${upstreamBody.substring(0, 200)}`,
            },
          }),
        );
        expect(h.logger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('classified as context overflow'),
        );
        expect(h.records[0].status).toBe('upstream-error');
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );
});

type ParityPath = 'stream' | 'forced-sse' | 'json';

type ParityOutcome =
  | { kind: 'stop'; stopReason: string }
  | { kind: 'error'; status: number; type: string; message: string };

interface ParityRow {
  name: string;
  /** Upstream SSE body for the stream and forced-SSE paths. */
  sse: string;
  /** Upstream JSON body; `undefined` when the JSON API has no such shape. */
  json?: Record<string, unknown>;
  expected: ParityOutcome;
  /** The terminal is the first upstream event: no output precedes it. */
  errorFirst?: boolean;
}

function upstreamSse(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;
}

const PARITY_USAGE = { input_tokens: 5, output_tokens: 3 };

function parityResponse(
  status: string,
  extra: Record<string, unknown>,
  toolArgs?: string,
): Record<string, unknown> {
  return {
    status,
    output:
      toolArgs === undefined
        ? [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }]
        : [
            {
              type: 'function_call',
              call_id: 'call_1',
              name: 'read_file',
              arguments: toolArgs,
            },
          ],
    usage: PARITY_USAGE,
    ...extra,
  };
}

/** Streamed items for a snapshot: text delta, or one function call. */
function streamedItems(toolArgs?: string): string {
  if (toolArgs === undefined) {
    return upstreamSse('response.output_text.delta', { delta: 'hi' });
  }
  const item = { type: 'function_call', call_id: 'call_1', name: 'read_file' };
  return (
    upstreamSse('response.output_item.added', { output_index: 0, item }) +
    upstreamSse('response.function_call_arguments.delta', {
      output_index: 0,
      delta: toolArgs,
    }) +
    upstreamSse('response.output_item.done', {
      output_index: 0,
      item: { ...item, arguments: toolArgs },
    })
  );
}

function terminalRow(
  name: string,
  event: 'response.completed' | 'response.incomplete' | 'response.failed',
  extra: Record<string, unknown>,
  expected: ParityOutcome,
  toolArgs?: string,
): ParityRow {
  const status =
    event === 'response.completed'
      ? 'completed'
      : event === 'response.incomplete'
        ? 'incomplete'
        : 'failed';
  const response = parityResponse(status, extra, toolArgs);
  return {
    name,
    sse: streamedItems(toolArgs) + upstreamSse(event, { response }),
    json: response,
    expected,
  };
}

const stop = (stopReason: string): ParityOutcome => ({ kind: 'stop', stopReason });
const failure = (
  status: number,
  type: string,
  message: string,
): ParityOutcome => ({ kind: 'error', status, type, message });

const incompleteFor = (reason: string) => ({ incomplete_details: { reason } });
const failedWith = (code?: string) =>
  code ? { error: { code, message: SENTINEL } } : {};

const PARITY_ROWS: ParityRow[] = [
  terminalRow('completed text', 'response.completed', {}, stop('end_turn')),
  terminalRow('completed tool call', 'response.completed', {}, stop('tool_use'), '{"path":"a"}'),
  terminalRow('max_output_tokens, no tools', 'response.incomplete', incompleteFor('max_output_tokens'), stop('max_tokens')),
  terminalRow('max_output_tokens, valid args', 'response.incomplete', incompleteFor('max_output_tokens'), stop('max_tokens'), '{"path":"a"}'),
  terminalRow('max_output_tokens, invalid args', 'response.incomplete', incompleteFor('max_output_tokens'), failure(502, 'api_error', INCOMPLETE_TOOL_INPUT), '{"x":'),
  terminalRow('content_filter, no tools', 'response.incomplete', incompleteFor('content_filter'), stop('refusal')),
  terminalRow('content_filter, valid args', 'response.incomplete', incompleteFor('content_filter'), stop('refusal'), '{"path":"a"}'),
  terminalRow('content_filter, invalid args', 'response.incomplete', incompleteFor('content_filter'), failure(502, 'api_error', INCOMPLETE_TOOL_INPUT), '{"x":'),
  terminalRow('other incomplete reason', 'response.incomplete', incompleteFor('other_reason'), failure(502, 'api_error', 'upstream_incomplete: Upstream Responses response incomplete')),
  terminalRow('failed context_length_exceeded', 'response.failed', failedWith('context_length_exceeded'), failure(400, 'invalid_request_error', PROMPT_TOO_LONG_DEFAULT)),
  terminalRow('failed rate_limit_exceeded', 'response.failed', failedWith('rate_limit_exceeded'), failure(429, 'rate_limit_error', 'Upstream rate limit exceeded')),
  terminalRow('failed server_error', 'response.failed', failedWith('server_error'), failure(502, 'api_error', 'Upstream Responses request failed (server_error)')),
  terminalRow('failed invalid_prompt', 'response.failed', failedWith('invalid_prompt'), failure(400, 'invalid_request_error', 'Upstream rejected the request (invalid_prompt)')),
  terminalRow('failed without error', 'response.failed', failedWith(), failure(502, 'api_error', 'Upstream Responses request failed (unknown)')),
  {
    name: 'standalone error, top-level code',
    sse:
      streamedItems() +
      upstreamSse('error', { code: 'context_length_exceeded', message: SENTINEL }),
    expected: failure(400, 'invalid_request_error', PROMPT_TOO_LONG_DEFAULT),
  },
  {
    name: 'standalone error, nested code',
    sse:
      streamedItems() +
      upstreamSse('error', { error: { code: 'rate_limit_exceeded', message: SENTINEL } }),
    expected: failure(429, 'rate_limit_error', 'Upstream rate limit exceeded'),
  },
];

/**
 * Every error row again with its terminal as the FIRST upstream event. The
 * stream path has sent nothing yet, so it answers with the same HTTP status
 * and body as the non-stream paths (the SDK CLI compacts only on HTTP 400).
 */
const upstreamTerminal = (row: ParityRow): string =>
  row.sse.slice(row.sse.lastIndexOf('event: '));
const ERROR_FIRST_ROWS: ParityRow[] = PARITY_ROWS.filter(
  (row) => row.expected.kind === 'error',
).map((row) => ({
  ...row,
  name: `${row.name}, error first`,
  sse: upstreamTerminal(row),
  errorFirst: true,
}));

const PARITY_PATHS: ParityPath[] = ['stream', 'forced-sse', 'json'];

// The JSON API has no standalone `error` event, so those rows run on the two
// SSE paths only.
const PARITY_CASES = [...PARITY_ROWS, ...ERROR_FIRST_ROWS].flatMap((row) =>
  PARITY_PATHS.filter((path) => path !== 'json' || row.json !== undefined).map(
    (path) => [row.name, path, row] as const,
  ),
);

async function runParityCase(
  path: ParityPath,
  row: ParityRow,
): Promise<{
  outcome: ParityOutcome;
  body: string;
  records: ProxyPhaseTimingRecord[];
}> {
  const upstream = await startUpstream((_req, res) => {
    if (path === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(row.json));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(row.sse);
  });
  const h = await timedHarness();
  h.proxy.protocol = 'responses';
  h.proxy.forceResponsesStream = path === 'forced-sse';
  h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
  try {
    const result = await request(`${h.url}/v1/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...JSON.parse(MESSAGES_BODY),
        stream: path === 'stream',
      }),
    });
    // Only an error-first terminal may leave the stream path as an HTTP error.
    const streamAnsweredHttpError =
      path === 'stream' && !!row.errorFirst && row.expected.kind === 'error';
    if (path === 'stream' && !streamAnsweredHttpError) {
      expect(result.status).toBe(200);
      const frames = parseSseBody(result.body);
      const terminals = frames.filter(
        (frame) => frame.event === 'error' || frame.event === 'message_stop',
      );
      // Exactly one Anthropic terminal, and it is the last frame.
      expect(terminals).toHaveLength(1);
      expect(frames.at(-1)).toBe(terminals[0]);
      const error = frames.find((frame) => frame.event === 'error');
      const delta = frames.find((frame) => frame.event === 'message_delta');
      const outcome: ParityOutcome = error
        ? {
            kind: 'error',
            // SSE errors travel on a 200 stream; compare with the mapping's status.
            status: row.expected.kind === 'error' ? row.expected.status : 200,
            ...(error.data['error'] as { type: string; message: string }),
          }
        : {
            kind: 'stop',
            stopReason: (delta?.data['delta'] as { stop_reason: string })
              .stop_reason,
          };
      return { outcome, body: result.body, records: h.records };
    }
    const body = JSON.parse(result.body);
    const outcome: ParityOutcome =
      result.status === 200
        ? { kind: 'stop', stopReason: body.stop_reason }
        : {
            kind: 'error',
            status: result.status,
            type: body.error.type,
            message: body.error.message,
          };
    return { outcome, body: result.body, records: h.records };
  } finally {
    await h.stop();
    await upstream.close();
  }
}

describe('TranslationProxyBase Responses terminal parity', () => {
  it.each(PARITY_CASES)('%s via %s', async (_name, path, row) => {
    const { outcome, body, records } = await runParityCase(path, row);
    expect(outcome).toEqual(row.expected);
    expect(body).not.toContain(SENTINEL);
    // The old JSON path fabricated `input: {}` for truncated args. (The stream
    // path legitimately opens tool blocks with `input: {}`.)
    if (path !== 'stream') expect(body).not.toContain('"input":{}');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe(
      row.expected.kind === 'stop' ? 'success' : 'invalid-response',
    );
    if (row.expected.kind === 'stop') {
      expect(records[0].terminalOutputTokens).toBe(PARITY_USAGE.output_tokens);
    }
  });

  it('ends a stream that hits EOF before any terminal with one SSE api_error', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // The last frame lacks its blank line, so it is never dispatched.
      res.end(
        upstreamSse('response.output_text.delta', { delta: 'partial' }) +
          `event: response.completed\ndata: ${JSON.stringify({
            response: parityResponse('completed', {}),
          })}\n`,
      );
    });
    const h = await timedHarness();
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream: true }),
      });
      const frames = parseSseBody(result.body);
      expect(frames.map((frame) => frame.event)).toEqual([
        'message_start',
        'content_block_start',
        'content_block_delta',
        'error',
      ]);
      expect(frames.at(-1)?.data).toEqual({
        type: 'error',
        error: {
          type: 'api_error',
          message: 'Upstream Responses stream ended before completion',
        },
      });
      expect(h.records).toHaveLength(1);
      expect(h.records[0].status).toBe('invalid-response');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  /** Runs one streaming Responses request; resolves once timing is recorded. */
  async function streamThrough(
    handler: http.RequestListener,
    configure: (proxy: FakeTranslationProxy) => void = () => undefined,
  ) {
    const upstream = await startUpstream(handler);
    let recorded!: () => void;
    const recordedPromise = new Promise<void>((resolve) => {
      recorded = resolve;
    });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: Date.now,
      record: (record) => {
        records.push(record);
        recorded();
      },
    });
    h.proxy.protocol = 'responses';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    configure(h.proxy);
    try {
      // `request` rejects on an aborted downstream, so resolving proves a clean end.
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream: true }),
      });
      await recordedPromise;
      // The proxy keeps serving after the failure.
      expect((await request(`${h.url}/health`)).status).toBe(200);
      // An error before any output is a plain JSON HTTP error, not a stream.
      const frames = result.status === 200 ? parseSseBody(result.body) : [];
      return { result, frames, records };
    } finally {
      await h.stop();
      await upstream.close();
    }
  }

  const TRUNCATED_ERROR = {
    type: 'error',
    error: {
      type: 'api_error',
      message: 'Upstream Responses stream ended before completion',
    },
  };

  it('ends with exactly one SSE error and a clean end when the upstream socket aborts mid-stream', async () => {
    const { result, frames, records } = await streamThrough((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(upstreamSse('response.output_text.delta', { delta: 'partial' }));
      setTimeout(() => res.socket?.destroy(), 30);
    });
    expect(result.status).toBe(200);
    expect(frames.map((frame) => frame.event)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'error',
    ]);
    expect(frames.filter((frame) => frame.event === 'error')).toHaveLength(1);
    expect(frames.at(-1)?.data).toEqual(TRUNCATED_ERROR);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('invalid-response');
  });

  it('ends with exactly one SSE error and a clean end on a post-header upstream timeout', async () => {
    const { result, frames, records } = await streamThrough(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(upstreamSse('response.output_text.delta', { delta: 'partial' }));
        // Then go silent until the proxy's idle timeout fires.
      },
      (proxy) => {
        proxy.upstreamTimeoutMs = 50;
      },
    );
    expect(result.status).toBe(200);
    expect(frames.filter((frame) => frame.event === 'error')).toHaveLength(1);
    expect(frames.at(-1)?.data).toEqual(TRUNCATED_ERROR);
    expect(frames.map((frame) => frame.event)).not.toContain('message_stop');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('timeout');
  });

  it('adds no second terminal when the upstream socket aborts after a terminal', async () => {
    const { frames, records } = await streamThrough((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        upstreamSse('response.completed', {
          response: parityResponse('completed', {}),
        }),
      );
      setTimeout(() => res.socket?.destroy(), 30);
    });
    expect(frames.map((frame) => frame.event)).toEqual([
      'message_start',
      'message_delta',
      'message_stop',
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('success');
  });

  it('delivers a CR-only response.failed overflow as the HTTP 400 prompt-too-long error at EOF', async () => {
    const { result, records } = await streamThrough((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Exactly two final CRs: the last one is only resolved by clean EOF.
      res.end(
        'event: response.failed\rdata: {"response":{"error":{"code":"context_length_exceeded"}}}\r\r',
      );
    });
    // Nothing preceded the failure, so no stream was opened.
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: PROMPT_TOO_LONG_DEFAULT,
      },
    });
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('invalid-response');
  });

  it('answers a response.failed overflow split across chunks before any output with HTTP 400', async () => {
    const wire = upstreamSse('response.failed', {
      response: { status: 'failed', error: { code: 'context_length_exceeded', message: SENTINEL } },
    });
    const { result, records } = await streamThrough((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(wire.slice(0, 20));
      setTimeout(() => res.end(wire.slice(20)), 20);
    });
    expect(result.status).toBe(400);
    expect(result.body).not.toContain(SENTINEL);
    expect(JSON.parse(result.body).error).toEqual({
      type: 'invalid_request_error',
      message: PROMPT_TOO_LONG_DEFAULT,
    });
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('invalid-response');
  });

  it('keeps an overflow that follows output as the single SSE error terminal', async () => {
    const { result, frames, records } = await streamThrough((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        upstreamSse('response.output_text.delta', { delta: 'partial' }) +
          upstreamSse('response.failed', {
            response: { error: { code: 'context_length_exceeded', message: SENTINEL } },
          }),
      );
    });
    expect(result.status).toBe(200);
    expect(frames.map((frame) => frame.event)).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'error',
    ]);
    expect(frames.at(-1)?.data).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: PROMPT_TOO_LONG_DEFAULT },
    });
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('invalid-response');
  });

  it('answers an upstream socket abort before any output with an HTTP 502, not a destroyed socket', async () => {
    const { result, records } = await streamThrough((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': keep-alive\n\n');
      setTimeout(() => res.socket?.destroy(), 30);
    });
    expect(result.status).toBe(502);
    expect(JSON.parse(result.body)).toEqual(TRUNCATED_ERROR);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('invalid-response');
  });

  /** An upstream handler that never ends on its own; resolves when it closes. */
  function openUpstream(first: string) {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      upstreamClosed = resolve;
    });
    const handler: http.RequestListener = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(first);
      // Heartbeats keep the proxy's socket-idle timeout from ever firing.
      const beat = setInterval(() => res.write(': ping\n\n'), 10);
      res.once('close', () => {
        clearInterval(beat);
        upstreamClosed();
      });
    };
    return { handler, closed };
  }

  const within = (promise: Promise<void>, ms: number) =>
    Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);

  it('releases an upstream that stays open after an error-first HTTP answer', async () => {
    const upstream = openUpstream(
      upstreamSse('response.failed', {
        response: { error: { code: 'context_length_exceeded', message: SENTINEL } },
      }),
    );
    const { result, records } = await streamThrough(upstream.handler);
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body).error.message).toBe(PROMPT_TOO_LONG_DEFAULT);
    expect(await within(upstream.closed, 1000)).toBe(true);
    // No second response or timing record from the release.
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('invalid-response');
  });

  it('answers HTTP 504 at the header deadline while upstream sends only non-output traffic', async () => {
    const upstream = openUpstream(
      upstreamSse('response.created', { response: { status: 'in_progress' } }),
    );
    const { result, records } = await streamThrough(upstream.handler, (proxy) => {
      proxy.upstreamTimeoutMs = 50;
    });
    expect(result.status).toBe(504);
    expect(JSON.parse(result.body).error).toEqual({
      type: 'api_error',
      message: 'Fake API request timed out',
    });
    expect(await within(upstream.closed, 1000)).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('timeout');
  });

  it('does not fire the header deadline once output has started', async () => {
    const { result, frames, records } = await streamThrough(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(upstreamSse('response.output_text.delta', { delta: 'hi' }));
        const beat = setInterval(() => res.write(': ping\n\n'), 10);
        setTimeout(() => {
          clearInterval(beat);
          res.end(
            upstreamSse('response.completed', {
              response: parityResponse('completed', {}),
            }),
          );
        }, 150);
      },
      (proxy) => {
        proxy.upstreamTimeoutMs = 50;
      },
    );
    expect(result.status).toBe(200);
    expect(frames.at(-1)?.event).toBe('message_stop');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('success');
  });

  it('answers an upstream timeout before any output with the shared HTTP 504', async () => {
    const { result, records } = await streamThrough(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(': keep-alive\n\n');
      },
      (proxy) => {
        proxy.upstreamTimeoutMs = 50;
      },
    );
    expect(result.status).toBe(504);
    expect(JSON.parse(result.body).error.type).toBe('api_error');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('timeout');
  });
});

// These probes invoke the production hook without needing unrelated auth services.
class CodexLaneProbe extends CodexTranslationProxy {
  static lane(model: string) {
    return this.prototype.resolveUpstreamProtocol(model);
  }
  static forcedStream(target: URL) {
    return this.prototype.requiresResponsesStream(target);
  }
}
class CopilotLaneProbe extends CopilotTranslationProxy {
  static lane(model: string) {
    return this.prototype.resolveUpstreamProtocol(model);
  }
}
class OpenRouterLaneProbe extends OpenRouterTranslationProxy {
  static lane(model: string) {
    return this.prototype.resolveUpstreamProtocol(model);
  }
}
// Ollama and LM Studio. The only production proxy that overrides NOTHING, so
// its lane is whatever the base default happens to be. That made it invisible
// to the migration: the old `shouldUseResponsesApi` default was `false` and the
// new `resolveUpstreamProtocol` default is `'chat/completions'`, which is the
// same lane by luck rather than by contract. This pins it so a future change to
// the default cannot silently reroute local models.
class LocalLaneProbe extends LocalModelTranslationProxy {
  static lane(model: string) {
    return this.prototype.resolveUpstreamProtocol(model);
  }
}

describe('existing provider protocol lanes', () => {
  it('pins Codex to Responses for every model', () => {
    for (const model of ['gpt-5.3-codex', 'gpt-5', 'claude-sonnet-4-6']) {
      expect(CodexLaneProbe.lane(model)).toBe('responses');
    }
  });
  it('pins Copilot to Chat Completions for every model', () => {
    for (const model of ['gpt-5', 'claude-sonnet-4.6', 'gemini-2.5-pro']) {
      expect(CopilotLaneProbe.lane(model)).toBe('chat/completions');
    }
  });
  it('pins OpenRouter to Chat Completions for every model', () => {
    for (const model of ['openai/gpt-5', 'anthropic/claude-sonnet-4.5']) {
      expect(OpenRouterLaneProbe.lane(model)).toBe('chat/completions');
    }
  });
  it('pins local providers (Ollama, LM Studio) to Chat Completions via the base default', () => {
    for (const model of ['llama3.1', 'qwen2.5-coder', 'gpt-oss-20b']) {
      expect(LocalLaneProbe.lane(model)).toBe('chat/completions');
    }
  });
  it('keeps Codex forced SSE limited to the subscription Responses endpoint', () => {
    expect(
      CodexLaneProbe.forcedStream(
        new URL('https://chatgpt.com/backend-api/codex/responses'),
      ),
    ).toBe(true);
    expect(
      CodexLaneProbe.forcedStream(
        new URL('https://api.openai.com/v1/responses'),
      ),
    ).toBe(false);
    expect(
      CodexLaneProbe.forcedStream(
        new URL('https://example.com/backend-api/codex/responses'),
      ),
    ).toBe(false);
  });
});

const NATIVE_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'prompt-caching-2024-07-31',
};

describe('TranslationProxyBase native Messages lane', () => {
  it.each([false, true])(
    'preserves native request and response bytes and allowlists headers (stream=%s)',
    async (stream) => {
      const responseBody = stream
        ? 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"cache_read_input_tokens":9}}}\n\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n\n'
        : ' { "content": [{"type":"thinking","thinking":"native"},{"type":"tool_use","id":"t1","name":"lookup","input":{}}], "usage": {"cache_read_input_tokens":9} }\n';
      let receivedBody = '';
      let receivedHeaders: http.IncomingHttpHeaders = {};
      let receivedPath: string | undefined;
      const upstream = await startUpstream((req, res) => {
        receivedHeaders = req.headers;
        receivedPath = req.url;
        req.on('data', (chunk: Buffer) => {
          receivedBody += chunk.toString('utf8');
        });
        req.on('end', () => {
          res.writeHead(201, {
            'content-type': stream ? 'text/event-stream' : 'application/json',
            'cache-control': 'no-cache',
            'request-id': 'native-request',
            'x-secret': 'hidden',
            'set-cookie': 'hidden=value',
          });
          res.write(responseBody.slice(0, 17));
          res.end(responseBody.slice(17));
        });
      });
      const h = await startProxy();
      h.proxy.protocol = 'messages';
      h.proxy.getApiEndpointMock.mockResolvedValue(
        `${upstream.origin}/zen/go/v1`,
      );
      const body = ` { "model": "fake-model-a", "max_tokens": 16, "stream": ${stream}, "messages": [{"role":"user","content":"hi"}], "thinking":{"type":"adaptive"}, "metadata":{"user_id":"u"}, "cache_control":{"type":"ephemeral"} }\n`;
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body,
          headers: {
            ...NATIVE_HEADERS,
            authorization: 'Bearer client',
            'x-api-key': 'client-key',
            cookie: 'private=value',
          },
        });
        expect(receivedBody).toBe(body);
        expect(receivedPath).toBe('/zen/go/v1/messages');
        expect(receivedHeaders).toMatchObject({
          ...NATIVE_HEADERS,
          authorization: 'Bearer fake',
        });
        expect(receivedHeaders['x-api-key']).toBeUndefined();
        expect(receivedHeaders['cookie']).toBeUndefined();
        expect(result.status).toBe(201);
        expect(result.body).toBe(responseBody);
        expect(result.headers['request-id']).toBe('native-request');
        expect(result.headers['cache-control']).toBe('no-cache');
        expect(result.headers['set-cookie']).toBeUndefined();
        expect(result.headers['x-secret']).toBeUndefined();
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );

  it('normalizes an explicit tier alias while preserving every other native field', async () => {
    let received: unknown;
    let path: string | undefined;
    const upstream = await startUpstream((req, res) => {
      path = req.url;
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        received = JSON.parse(Buffer.concat(chunks).toString());
        res.end('{}');
      });
    });
    const h = await startProxy({
      ...DEFAULT_CONFIG,
      messagesPath: '/native/messages',
    });
    h.proxy.protocol = 'messages';
    h.proxy.normalizeModelIdMock.mockImplementation((model) =>
      model === 'sonnet' ? 'native-model' : model,
    );
    h.proxy.getApiEndpointMock.mockResolvedValue(`${upstream.origin}/zen/v1`);
    const body = {
      ...JSON.parse(MESSAGES_BODY),
      model: 'sonnet',
      future: { untouched: true },
      tools: [{ type: 'native-tool', name: 'lookup' }],
    };
    try {
      expect(
        (
          await request(`${h.url}/v1/messages`, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: NATIVE_HEADERS,
          })
        ).status,
      ).toBe(200);
      expect(received).toEqual({ ...body, model: 'native-model' });
      expect(path).toBe('/zen/v1/native/messages');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it.each([
    'null',
    '[]',
    '{}',
    '{"model":2}',
    '{"model":" "}',
    '{"model":"m","max_tokens":1,"messages":{}}',
    '{"model":"m","max_tokens":1,"messages":[null]}',
  ])(
    'rejects malformed envelopes before auth or upstream: %s',
    async (body) => {
      const h = await startProxy();
      h.proxy.protocol = 'messages';
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body,
          headers: NATIVE_HEADERS,
        });
        expect(result.status).toBe(400);
        expect(h.proxy.normalizeModelIdMock).not.toHaveBeenCalled();
        expect(h.proxy.getHeadersMock).not.toHaveBeenCalled();
        expect(h.proxy.getApiEndpointMock).not.toHaveBeenCalled();
      } finally {
        await h.stop();
      }
    },
  );

  it('rejects undefined lanes before auth or upstream without falling back to Chat', async () => {
    const h = await startProxy();
    h.proxy.protocol = undefined;
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
      });
      expect(result.status).toBe(400);
      expect(result.body).toContain('not supported');
      expect(h.proxy.getHeadersMock).not.toHaveBeenCalled();
      expect(h.proxy.getApiEndpointMock).not.toHaveBeenCalled();
    } finally {
      await h.stop();
    }
  });

  it('requires an inbound anthropic-version before auth or upstream', async () => {
    const h = await startProxy();
    h.proxy.protocol = 'messages';
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
      });
      expect(result.status).toBe(400);
      expect(result.body).toContain('anthropic-version');
      expect(h.proxy.getHeadersMock).not.toHaveBeenCalled();
      expect(h.proxy.getApiEndpointMock).not.toHaveBeenCalled();
    } finally {
      await h.stop();
    }
  });

  it.each([401, 403, 429, 500])(
    'uses the shared auth, quota and sanitized error hooks for native status %s',
    async (status) => {
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(status, { 'retry-after': '2' });
        res.end('private vendor diagnostic');
      });
      const h = await startProxy();
      h.proxy.protocol = 'messages';
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      jest
        .spyOn(h.proxy, 'getAuthFailureMessage')
        .mockReturnValue('Rotate the Fake key');
      jest
        .spyOn(h.proxy, 'getUpstreamErrorMessage')
        .mockReturnValue('Fake denied this request');
      try {
        const result = await request(`${h.url}/v1/messages`, {
          method: 'POST',
          body: MESSAGES_BODY,
          headers: NATIVE_HEADERS,
        });
        expect(result.status).toBe(status);
        expect(result.body).not.toContain('private vendor diagnostic');
        expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain(
          'private vendor diagnostic',
        );
        if (status === 401) {
          expect(result.body).toContain('Rotate the Fake key');
          expect(h.proxy.onAuthFailureMock).toHaveBeenCalledTimes(1);
        }
        if (status === 429) {
          expect(result.headers['retry-after']).toBe('2');
          expect(result.body).toContain('rate_limit_error');
        }
        if (status === 403 || status === 500)
          expect(result.body).toContain('Fake denied this request');
      } finally {
        await h.stop();
        await upstream.close();
        providerQuotaStore.clear();
      }
    },
  );

  it.each([false, true])(
    'fails a truncated native response instead of completing successfully (stream=%s)',
    async (stream) => {
      const upstream = await startUpstream((_req, res) => {
        res.writeHead(200, {
          'content-type': stream ? 'text/event-stream' : 'application/json',
        });
        res.write('partial');
        setTimeout(() => res.destroy(), 20);
      });
      const h = await startProxy();
      h.proxy.protocol = 'messages';
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
      try {
        await expect(
          request(`${h.url}/v1/messages`, {
            method: 'POST',
            body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream }),
            headers: NATIVE_HEADERS,
          }),
        ).rejects.toThrow();
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );

  it('returns 504 on native upstream timeout', async () => {
    const upstream = await startUpstream(() => undefined);
    const h = await startProxy();
    h.proxy.protocol = 'messages';
    h.proxy.upstreamTimeoutMs = 20;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST',
        body: MESSAGES_BODY,
        headers: NATIVE_HEADERS,
      });
      expect(result.status).toBe(504);
    } finally {
      await h.stop();
      await upstream.close();
    }
  });
});

describe('TranslationProxyBase request-local dispatch', () => {
  it.each(['/zen/v1', '/zen/go/v1'])(
    'keeps all three concurrent lanes under %s',
    async (basePath) => {
      const paths: string[] = [];
      const received: Record<string, unknown>[] = [];
      const upstream = await startUpstream((req, res) => {
        paths.push(req.url ?? '');
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          received.push(
            JSON.parse(Buffer.concat(chunks).toString()) as Record<
              string,
              unknown
            >,
          );
          res.setHeader('content-type', 'application/json');
          if (req.url?.endsWith('/chat/completions')) {
            res.end(
              JSON.stringify({
                choices: [
                  { message: { content: 'chat' }, finish_reason: 'stop' },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              }),
            );
          } else if (req.url?.endsWith('/responses')) {
            res.end(
              JSON.stringify({
                status: 'completed',
                output: [
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: 'responses' }],
                  },
                ],
              }),
            );
          } else {
            res.end('{"native":true}');
          }
        });
      });
      const h = await startProxy();
      h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin + basePath);
      jest
        .spyOn(h.proxy, 'resolveUpstreamProtocol')
        .mockImplementation((model) => {
          if (model === 'native') return 'messages';
          if (model === 'responses') return 'responses';
          return 'chat/completions';
        });
      try {
        const results = await Promise.all(
          ['native', 'chat', 'responses'].map((model) =>
            request(`${h.url}/v1/messages`, {
              method: 'POST',
              headers: NATIVE_HEADERS,
              body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), model }),
            }),
          ),
        );
        expect(paths.sort()).toEqual(
          ['/messages', '/chat/completions', '/responses']
            .map((suffix) => basePath + suffix)
            .sort(),
        );
        expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
        expect(results[0].body).toBe('{"native":true}');
        expect(results[1].body).toContain('chat');
        expect(results[2].body).toContain('responses');
        expect(
          received.find((body) => body['model'] === 'chat'),
        ).toHaveProperty('messages');
        expect(
          received.find((body) => body['model'] === 'responses'),
        ).toHaveProperty('input');
        expect(
          received.find((body) => body['model'] === 'native'),
        ).not.toHaveProperty('input');
      } finally {
        await h.stop();
        await upstream.close();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// TASK_2026_408 Phase 2 — Responses tool-name guard over HTTP
// ---------------------------------------------------------------------------

describe('TranslationProxyBase Responses tool-name guard', () => {
  // 70 characters, with dots that OpenAI rejects.
  const LONG_MCP = 'mcp__server.with.dots__tool' + 'x'.repeat(43);
  const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
  const aliasOf = (name: string) =>
    `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 53)}_${createHash('sha256')
      .update(name, 'utf16le').digest('hex').slice(0, 10)}`;

  function guardBody(stream: boolean, toolNames: string[] = [LONG_MCP, 'Read']): string {
    return JSON.stringify({
      model: 'fake-model-a',
      max_tokens: 16,
      stream,
      messages: [
        { role: 'user', content: 'use the tool' },
        { role: 'assistant', content: [
          { type: 'tool_use', id: 'call_hist', name: toolNames[0], input: { value: '1' } },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'call_hist', content: 'one' },
        ] },
      ],
      tools: toolNames.map((name) => ({
        name, description: 'a tool', input_schema: { type: 'object' },
      })),
    });
  }

  interface Recorded { raw: string; body: Record<string, unknown> }

  /** Upstream that answers with a function_call named as tools[0] was sent. */
  function toolCallingUpstream(path: ParityPath, recorded: Recorded[], statuses: number[] = []) {
    return startUpstream((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = JSON.parse(raw) as { tools: Array<{ name: string }> };
        recorded.push({ raw, body });
        const status = statuses.shift();
        if (status !== undefined) {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'expired' } }));
          return;
        }
        const item = {
          type: 'function_call', call_id: 'call_new', name: body.tools[0].name, arguments: '{"value":"42"}',
        };
        const response = { status: 'completed', output: [item], usage: PARITY_USAGE };
        if (path === 'json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(
          upstreamSse('response.output_item.added', { output_index: 0, item: { ...item, arguments: '' } }) +
          upstreamSse('response.function_call_arguments.delta', { output_index: 0, delta: item.arguments }) +
          upstreamSse('response.output_item.done', { output_index: 0, item }) +
          upstreamSse('response.completed', { response }),
        );
      });
    });
  }

  /** The tool_use block the client received, from SSE or JSON. */
  function clientToolUse(path: ParityPath, body: string): Record<string, unknown> | undefined {
    if (path !== 'stream') {
      const content = (JSON.parse(body) as { content: Array<Record<string, unknown>> }).content;
      return content.find((block) => block['type'] === 'tool_use');
    }
    const start = parseSseBody(body).find((frame) => frame.event === 'content_block_start');
    return start?.data['content_block'] as Record<string, unknown> | undefined;
  }

  async function run(path: ParityPath, body: string, statuses: number[] = []) {
    const recorded: Recorded[] = [];
    const upstream = await toolCallingUpstream(path, recorded, statuses);
    const h = await startProxy();
    h.proxy.protocol = 'responses';
    h.proxy.forceResponsesStream = path === 'forced-sse';
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    h.proxy.onAuthFailureMock.mockResolvedValue(true);
    try {
      const result = await request(`${h.url}/v1/messages`, { method: 'POST', body });
      return { result, recorded, proxy: h.proxy };
    } finally {
      await h.stop();
      await upstream.close();
    }
  }

  it.each(PARITY_PATHS)('a 70-character MCP name round-trips via %s, including replayed history', async (path) => {
    expect(LONG_MCP).toHaveLength(70);
    const alias = aliasOf(LONG_MCP);
    const { result, recorded } = await run(path, guardBody(path === 'stream'));

    expect(recorded).toHaveLength(1);
    const sent = recorded[0].body as {
      tools: Array<{ name: string }>;
      input: Array<{ type?: string; name?: string; call_id?: string }>;
    };
    expect(sent.tools.map((tool) => tool.name)).toEqual([alias, 'Read']);
    expect(alias).toMatch(VALID_NAME);
    const history = sent.input.find((item) => item.type === 'function_call');
    expect(history).toMatchObject({ call_id: 'call_hist', name: alias });
    expect(recorded[0].raw).not.toContain(LONG_MCP);

    expect(result.status).toBe(200);
    expect(clientToolUse(path, result.body)).toMatchObject({ id: 'call_new', name: LONG_MCP });
    expect(result.body).not.toContain(alias);
  });

  it.each([false, true])('valid names give a byte-identical upstream request (stream=%s)', async (stream) => {
    const body = guardBody(stream, ['Read', 'mcp__srv__tool']);
    const { result, recorded } = await run(stream ? 'stream' : 'json', body);
    expect(result.status).toBe(200);
    expect(recorded[0].raw).toBe(JSON.stringify(
      translateAnthropicToResponses(JSON.parse(body) as AnthropicMessagesRequest, { modelPrefix: '' })));
  });

  it.each([
    ['alias equals another tool original name', [LONG_MCP, aliasOf(LONG_MCP)]],
    ['history name equals an alias', [aliasOf(LONG_MCP), LONG_MCP]],
  ])('a collision (%s) is a 400 sent before any upstream call', async (_case, names) => {
    const { result, recorded, proxy } = await run('stream', guardBody(true, names));
    expect(recorded).toHaveLength(0);
    expect(proxy.getApiEndpointMock).not.toHaveBeenCalled();
    expect(proxy.getHeadersMock).not.toHaveBeenCalled();
    expect(result.status).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: `Tool name collision after Responses name normalization: ${aliasOf(LONG_MCP)}`,
      },
    });
  });

  it.each(PARITY_PATHS)('the 401 retry keeps the alias and its reverse map via %s', async (path) => {
    const alias = aliasOf(LONG_MCP);
    const { result, recorded, proxy } = await run(path, guardBody(path === 'stream'), [401]);
    expect(proxy.onAuthFailureMock).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveLength(2);
    expect(recorded[1].raw).toBe(recorded[0].raw);
    expect((recorded[1].body as { tools: Array<{ name: string }> }).tools[0].name).toBe(alias);
    expect(result.status).toBe(200);
    expect(clientToolUse(path, result.body)).toMatchObject({ name: LONG_MCP });
    expect(result.body).not.toContain(alias);
  });
});
