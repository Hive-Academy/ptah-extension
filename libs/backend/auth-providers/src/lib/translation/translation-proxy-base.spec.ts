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
} from './translation-proxy-base';

// ---------------------------------------------------------------------------
// Concrete subclass — stubs the 4 abstract hooks.
// ---------------------------------------------------------------------------

class FakeTranslationProxy extends TranslationProxyBase {
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
): Promise<Harness> {
  const logger = createMockLogger();
  const proxy = new FakeTranslationProxy(logger as unknown as Logger, config);
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
