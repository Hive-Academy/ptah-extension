import 'reflect-metadata';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger, type MockLogger } from '@ptah-extension/shared/testing';
import { KIMI_CODE_PROXY_TOKEN_PLACEHOLDER } from '@ptah-extension/shared';
import { createMockConfigManager } from '@ptah-extension/vscode-core/testing';
import { KimiCodeTranslationProxy } from './kimi-code-translation-proxy';
import {
  KimiCodeAuthUnavailableError,
  type IKimiCodeAuthService,
  type KimiCodeRequestCredential,
} from './kimi-code-provider.types';

function asLogger(mock: MockLogger): Logger {
  const surface: Partial<Logger> = mock;
  return surface as Logger;
}

interface UpstreamCall {
  path: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const SSE =
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":3}}}\n\n' +
  'event: message_stop\ndata: {"type":"message_stop"}\n\n';

const REQUEST_BODY = JSON.stringify({
  model: 'k3',
  max_tokens: 16,
  stream: true,
  messages: [{ role: 'user', content: 'hi' }],
});

function send(
  proxyUrl: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${proxyUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'interleaved-thinking-2025-05-14',
          authorization: `Bearer ${KIMI_CODE_PROXY_TOKEN_PLACEHOLDER}`,
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(REQUEST_BODY);
  });
}

describe('KimiCodeTranslationProxy', () => {
  let upstream: http.Server;
  let calls: UpstreamCall[];
  let statuses: number[];
  let proxy: KimiCodeTranslationProxy;
  let credentials: KimiCodeRequestCredential[];
  let auth: jest.Mocked<IKimiCodeAuthService>;
  let logger: MockLogger;

  beforeEach(async () => {
    calls = [];
    statuses = [];
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        calls.push({
          path: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const status = statuses.shift() ?? 200;
        if (status !== 200) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end('{"error":{"message":"upstream-secret-detail"}}');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(SSE);
      });
    });
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
    const port = (upstream.address() as AddressInfo).port;

    credentials = [{ kind: 'oauth', accessToken: 'fake-access-token-1' }];
    auth = {
      getStatus: jest.fn(),
      resolveRequestCredential: jest.fn(async () => {
        const next = credentials[0];
        if (!next) throw new KimiCodeAuthUnavailableError('signed-out');
        return next;
      }),
      ensureFresh: jest.fn(async () => true),
      forceRefresh: jest.fn(async () => {
        credentials.shift();
        return credentials.length > 0;
      }),
      isAuthenticated: jest.fn(async () => true),
      clearCache: jest.fn(),
      startWatching: jest.fn(),
      stopWatching: jest.fn(),
    };
    const config = createMockConfigManager({
      values: { 'provider.kimi-code.baseUrl': `http://127.0.0.1:${port}/coding/` },
    });
    logger = createMockLogger();
    proxy = new KimiCodeTranslationProxy(
      asLogger(logger),
      auth,
      config,
    );
  });

  afterEach(async () => {
    await proxy.stop();
    await new Promise<void>((done) => upstream.close(() => done()));
  });

  it('relays to /coding/v1/messages with both OAuth headers and the bytes unchanged', async () => {
    const { url } = await proxy.start();
    const response = await send(url);

    expect(response.status).toBe(200);
    expect(response.body).toBe(SSE);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.path).toBe('/coding/v1/messages');
    expect(call.headers['authorization']).toBe('Bearer fake-access-token-1');
    expect(call.headers['x-api-key']).toBe('fake-access-token-1');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14');
    expect(JSON.stringify(call.headers)).not.toContain(
      KIMI_CODE_PROXY_TOKEN_PLACEHOLDER,
    );
    expect(JSON.parse(call.body)).toEqual(JSON.parse(REQUEST_BODY));
  });

  it('sends only x-api-key for the stored key', async () => {
    credentials = [{ kind: 'apiKey', apiKey: 'fake-kimi-key' }];
    const { url } = await proxy.start();
    await send(url);
    expect(calls[0].headers['x-api-key']).toBe('fake-kimi-key');
    expect(calls[0].headers['authorization']).toBeUndefined();
  });

  it('retries once with the refreshed token after an upstream 401', async () => {
    credentials = [
      { kind: 'oauth', accessToken: 'fake-access-token-1' },
      { kind: 'oauth', accessToken: 'fake-access-token-2' },
    ];
    statuses = [401];
    const { url } = await proxy.start();
    const response = await send(url);
    expect(response.status).toBe(200);
    expect(calls.map((c) => c.headers['x-api-key'])).toEqual([
      'fake-access-token-1',
      'fake-access-token-2',
    ]);
    expect(auth.forceRefresh).toHaveBeenCalledTimes(1);
  });

  it('answers 401 with fixed copy when the refresh yields no new credential', async () => {
    auth.forceRefresh.mockResolvedValue(false);
    statuses = [401, 401];
    const { url } = await proxy.start();
    const response = await send(url);
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(response.body).toContain('kimi login');
    expect(response.body).not.toContain('upstream-secret-detail');
  });

  it('answers 401 with the fixed sign-in message when no credential exists', async () => {
    credentials = [];
    const { url } = await proxy.start();
    const response = await send(url);
    expect(response.status).toBe(401);
    expect(response.body).toContain('Kimi Code is not signed in');
    expect(calls).toHaveLength(0);
  });

  it('never relays an upstream error body', async () => {
    statuses = [500];
    const { url } = await proxy.start();
    const response = await send(url);
    expect(response.body).not.toContain('upstream-secret-detail');
  });

  it('never logs a credential', async () => {
    const { url } = await proxy.start();
    await send(url);
    const logged = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ]);
    expect(logged).not.toContain('fake-access-token');
  });
});
