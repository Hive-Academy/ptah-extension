/**
 * TranslationProxyBase — unit specs.
 *
 * Surface under test:
 *   - Lifecycle: `start()` binds to an OS-assigned port on 127.0.0.1,
 *     `isRunning()` flips to true, `getUrl()` returns the bound URL, and
 *     `stop()` tears down cleanly.
 *   - Routing:
 *       * GET  /health         → 200 { status: 'ok' }
 *       * GET  /v1/models      → 200 { object: 'list', data: [...] } derived
 *                                from `getStaticModels()`.
 *       * POST /v1/messages    → delegates to the translator pipeline.
 *       * any other path       → 404 with Anthropic-shaped error body.
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
import {
  providerQuotaStore,
  PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS,
} from '../auth/provider-quota.store';

// ---------------------------------------------------------------------------
// Concrete subclass — stubs the 4 abstract hooks.
// ---------------------------------------------------------------------------

class FakeTranslationProxy extends TranslationProxyBase {
  constructor(logger: Logger, config: TranslationProxyConfig, timing?: ProxyTimingOptions) {
    super(logger, config, timing);
  }
  /**
   * The REGISTRY id the quota store is keyed on. Settable so the two dynamic
   * subclasses' shape (id known only at construction) is exercised here too.
   */
  public providerId = 'fake-provider';
  public useResponsesApi = false;
  public forceResponsesStream = false;
  public upstreamTimeoutMs = 600_000;
  protected override shouldUseResponsesApi(): boolean {
    return this.useResponsesApi;
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
// Minimal HTTP helper — makes a localhost request and collects the response.
// ---------------------------------------------------------------------------

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  url: string,
  opts: { method?: string; body?: string } = {},
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
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(opts.body).toString(),
            }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
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
// Test harness — fresh proxy per test, guaranteed cleanup.
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
  const proxy = new FakeTranslationProxy(logger as unknown as Logger, config, timing);
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

describe('TranslationProxyBase — lifecycle', () => {
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

  it('start() is idempotent — a second call returns the same URL without re-binding', async () => {
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

describe('TranslationProxyBase — routing', () => {
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
//   * the RESPONSE is untouched — status, headers, body and message are exactly
//     what they were before the quota store existed. `context.md` puts the 429
//     response explicitly out of scope: it was already correct.
//   * the SIDE EFFECT fires — a cooldown is recorded against the REGISTRY
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

const MESSAGES_BODY = JSON.stringify({
  model: 'fake-model-a',
  max_tokens: 16,
  stream: false,
  messages: [{ role: 'user', content: 'hi' }],
});

describe('TranslationProxyBase — Responses JSON usage', () => {
  it('records monotonic metadata-only phases with exact request and inexact compaction correlation', async () => {
    const forbidden = ['authorization', 'header', 'prompt', 'messages', 'body', 'tool', 'secret'];
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'x-secret': 'never-record' });
      res.end(JSON.stringify({ status: 'completed', output: [], usage: {
        input_tokens: 42, output_tokens: 9, input_tokens_details: { cached_tokens: 12 },
      } }));
    });
    let tick = 100;
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: () => tick++,
      record: (record) => records.push(record),
    });
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY });
      expect(result.status).toBe(200);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record).toMatchObject({
        requestCorrelation: 'exact', compactionCorrelation: 'inexact', overlapCount: 0,
        retryOrdinal: 0, stream: false, status: 'success',
        terminalInputTokens: 30, terminalCacheReadTokens: 12, terminalOutputTokens: 9,
      });
      expect([
        record.requestReceivedAt, record.requestParsedAt, record.attemptStartedAt,
        record.upstreamResponseAt, record.firstByteAt, record.finishedAt,
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

  it.each([false, true])('contains malformed usage over HTTP (stream=%s)', async (stream) => {
    const upstream = await startUpstream((_req, res) => {
      const response = { status: 'completed', output: [],
        usage: { input_tokens: 'private-upstream-value', output_tokens: 9 } };
      res.writeHead(200, { 'Content-Type': stream ? 'text/event-stream' : 'application/json' });
      res.end(stream
        ? `data: ${JSON.stringify({ type: 'response.completed', response })}\n\ndata: [DONE]\n\n`
        : JSON.stringify(response));
    });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, {
      now: () => 1,
      record: (record) => records.push(record),
    });
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, {
        method: 'POST', body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream }),
      });
      expect(result.body).not.toContain('private-upstream-value');
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe('invalid-response');
      if (stream) {
        expect(result.status).toBe(200);
        expect(result.body).toContain('Invalid upstream Responses usage');
        expect(result.body).not.toContain('message_stop');
        expect(result.body).not.toContain('message_delta');
      } else {
        expect(result.status).toBe(500);
        expect(JSON.parse(result.body)).toEqual({ type: 'error', error: {
          type: 'api_error', message: 'Failed to translate Fake response',
        } });
      }
    } finally {
      await h.stop();
      await upstream.close();
    }
  });
  it.each([
    [undefined, 42, undefined],
    [{}, 42, undefined],
    [{ cached_tokens: 0 }, 42, 0],
    [{ cached_tokens: 12 }, 30, 12],
    [{ cached_tokens: 99 }, 0, 42],
  ])('forwards input/cache without double counting %j', async (details, input, cache) => {
    const upstream = await startUpstream((req, res) => {
      expect(req.url).toBe('/responses');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'completed', output: [
        { type: 'function_call', call_id: 'call', name: 'read_file', arguments: '{"path":"a"}' },
      ], usage: { input_tokens: 42, output_tokens: 9, input_tokens_details: details,
        output_tokens_details: { reasoning_tokens: 7 } } }));
    });
    const h = await startProxy();
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const response = await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ stop_reason: 'tool_use',
        content: [{ type: 'tool_use', input: { path: 'a' } }] });
      expect(JSON.parse(response.body).usage).toEqual({ input_tokens: input, output_tokens: 9,
        ...(cache !== undefined ? { cache_read_input_tokens: cache } : {}) });
    } finally {
      await h.stop();
      await upstream.close();
    }
  });
});

describe('TranslationProxyBase — 429 records a provider cooldown', () => {
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
    for (const secret of ['Bearer fake', 'private-upstream-value', 'Keep this prompt', 'read_file']) {
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
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-private': 'private-upstream-value' });
      res.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
        status: 'completed', output: [], usage,
      } })}\n\ndata: [DONE]\n\n`);
    });
    const h = await timedProxy();
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      expect((await request(`${h.url}/v1/messages`, {
        method: 'POST', body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream: true,
          system: 'Keep this prompt' }),
      })).status).toBe(200);
      assertSafeTiming(h.records, 'success');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records invalid-response exactly once for an early SSE EOF', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"type":"response.output_text.delta","delta":"private-upstream-value"}\n\n');
    });
    const h = await timedProxy();
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      await request(`${h.url}/v1/messages`, {
        method: 'POST', body: JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream: true }),
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
      res.end(`data: ${JSON.stringify({ type: 'response.completed', response: {
        status: 'completed', output: [],
        usage: { input_tokens: 'private-upstream-value', output_tokens: 2 },
      } })}\n\n`);
    });
    const h = await timedProxy();
    h.proxy.useResponsesApi = true;
    h.proxy.forceResponsesStream = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY });
      expect(result.status).toBe(502);
      assertSafeTiming(h.records, 'invalid-response');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it.each([
    ['malformed function arguments', `data: ${JSON.stringify({
      type: 'response.completed', response: {
        status: 'completed',
        output: [{ type: 'function_call', call_id: 'call', name: 'read_file',
          arguments: '{"private-upstream-value":' }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    })}\n\n`],
    ['wrong content shape', `data: ${JSON.stringify({
      type: 'response.completed', response: {
        status: 'completed',
        output: [{ type: 'message', content: 'private-upstream-value' }],
        usage: { input_tokens: 3, output_tokens: 2 },
      },
    })}\n\n`],
    ['invalid JSON frame', 'data: {"type":"response.completed","private-upstream-value":\n\n'],
  ])('uses the 502 path and records forced-stream %s exactly once', async (_name, wire) => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(wire);
    });
    const h = await timedProxy();
    h.proxy.useResponsesApi = true;
    h.proxy.forceResponsesStream = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      const result = await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY });
      expect(result.status).toBe(502);
      expect(result.body).toContain('invalid_response');
      assertSafeTiming(h.records, 'invalid-response');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records rate-limited exactly once', async () => {
    const upstream = await startUpstream((_req, res) => { res.writeHead(429); res.end(); });
    const h = await timedProxy();
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    try {
      expect((await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY })).status).toBe(429);
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
      expect((await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY })).status).toBe(504);
      assertSafeTiming(h.records, 'timeout');
      expect(new FakeTranslationProxy(h.logger as unknown as Logger, DEFAULT_CONFIG).upstreamTimeoutMs).toBe(600_000);
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
      expect((await request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY })).status).toBe(500);
      assertSafeTiming(h.records, 'network-error');
    } finally {
      await h.stop();
      await upstream.close();
    }
  });

  it('records pre-write cancellation exactly once', async () => {
    let releaseHeaders!: (headers: { authorization: string; 'content-type': string }) => void;
    let recorded!: () => void;
    const recordedPromise = new Promise<void>((resolve) => { recorded = resolve; });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, { now: Date.now, record: (record) => {
      records.push(record);
      recorded();
    } });
    h.proxy.getHeadersMock.mockImplementation(() => new Promise((resolve) => { releaseHeaders = resolve; }));
    const client = http.request(`${h.url}/v1/messages`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(MESSAGES_BODY),
    } });
    client.on('error', () => undefined);
    client.end(MESSAGES_BODY);
    while (!h.proxy.getHeadersMock.mock.calls.length) await new Promise((resolve) => setImmediate(resolve));
    client.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    releaseHeaders({ authorization: 'Bearer fake', 'content-type': 'application/json' });
    await recordedPromise;
    assertSafeTiming(records, 'cancelled');
    await h.stop();
  });

  it('records mid-stream cancellation exactly once', async () => {
    const upstream = await startUpstream((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"response.output_text.delta","delta":"partial"}\n\n');
    });
    let recorded!: () => void;
    const recordedPromise = new Promise<void>((resolve) => { recorded = resolve; });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, { now: Date.now, record: (record) => {
      records.push(record);
      recorded();
    } });
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    const body = JSON.stringify({ ...JSON.parse(MESSAGES_BODY), stream: true });
    const client = http.request(`${h.url}/v1/messages`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
    } }, (response) => response.once('data', () => response.destroy()));
    client.on('error', () => undefined);
    client.end(body);
    await recordedPromise;
    assertSafeTiming(records, 'cancelled');
    await h.stop();
    await upstream.close();
  });

  it('counts other in-flight attempts and decrements exactly once', async () => {
    const responders: http.ServerResponse[] = [];
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const upstream = await startUpstream((_req, res) => {
      responders.push(res);
      if (responders.length === 2) release();
    });
    const records: ProxyPhaseTimingRecord[] = [];
    const h = await startProxy(DEFAULT_CONFIG, { now: Date.now, record: (record) => records.push(record) });
    h.proxy.useResponsesApi = true;
    h.proxy.getApiEndpointMock.mockResolvedValue(upstream.origin);
    const calls = [1, 2].map(() => request(`${h.url}/v1/messages`, { method: 'POST', body: MESSAGES_BODY }));
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
