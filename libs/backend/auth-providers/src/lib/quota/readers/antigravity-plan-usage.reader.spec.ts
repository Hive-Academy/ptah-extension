import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { createServer } from 'node:http';
import { accountOwnerKey } from '../provider-owner.resolver';
import {
  ANTIGRAVITY_CSRF_HEADER,
  ANTIGRAVITY_REQUEST_BODY,
} from './antigravity-ls.provisional';
import {
  createAntigravityPlanUsageReader,
  defaultRequest,
  readJsonResponse,
} from './antigravity-plan-usage.reader';

const TOKEN = 'csrf-token';
const EMAIL = 'fixture-user@example.test';
const PROCESS =
  'P 123 /opt/antigravity/language_server --csrf_token ' +
  TOKEN +
  ' --extension_server_port 4444\nL 123 5555';
const response = {
  userStatus: {
    email: EMAIL,
    cascadeModelConfigData: {
      clientModelConfigs: [
        {
          label: 'Gemini',
          modelOrAlias: { model: 'gemini-3' },
          quotaInfo: {
            remainingFraction: 0.4,
            resetTime: '2030-01-01T00:00:00Z',
          },
        },
        { label: 'empty', quotaInfo: {} },
        { label: 'skip' },
      ],
    },
  },
};
const owner = accountOwnerKey(
  'antigravity',
  require('node:path').join(require('node:os').homedir(), '.gemini') +
    '\0' +
    EMAIL,
);
function reader(
  request: (
    scheme: 'http' | 'https',
    port: number,
    token: string,
    signal: AbortSignal,
  ) => Promise<unknown>,
  observe = () => owner,
) {
  return createAntigravityPlanUsageReader(
    createMockLogger() as unknown as Logger,
    () => 1,
    async (command) => (command === 'lsof' ? 'n127.0.0.1:5555' : PROCESS),
    request,
    observe,
  );
}
describe('Antigravity plan-usage reader', () => {
  it('tries HTTPS then HTTP and maps the provisional response without exposing its email', async () => {
    const request = jest.fn(async (scheme: 'http' | 'https') =>
      scheme === 'https' ? Promise.reject(new Error('tls')) : response,
    );
    const observe = jest.fn(() => owner);
    const result = await reader(
      request,
      observe,
    )({ target: { ownerRef: { key: owner } } as never, refresh: true });
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      'https',
      'http',
    ]);
    expect(observe).toHaveBeenCalledWith(EMAIL);
    expect(JSON.stringify(result)).not.toContain(EMAIL);
    expect(result).toMatchObject({
      status: 'available',
      windows: [
        { modelScope: 'gemini-3', used: { percent: 60 } },
        { modelScope: 'empty', used: { percent: 100 } },
      ],
    });
  });
  it('uses the extension port when no listener can be discovered', async () => {
    const request = jest.fn(async () => response);
    const instance = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async (command) =>
        command === 'lsof' ? '' : PROCESS.replace('L 123 5555', ''),
      request,
      () => owner,
    );
    await instance({
      target: { ownerRef: { key: owner } } as never,
      refresh: true,
    });
    expect(request).toHaveBeenCalledWith(
      'http',
      4444,
      TOKEN,
      expect.any(AbortSignal),
    );
  });
  it('accepts padded POSIX pids, rejects ambiguous servers, and rejects no ports', async () => {
    const request = jest.fn(async () => response);
    const padded = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async (command) =>
        command === 'lsof'
          ? 'n127.0.0.1:5555'
          : PROCESS.replace('P 123', '  123'),
      request,
      () => owner,
    );
    await padded({
      target: { ownerRef: { key: owner } } as never,
      refresh: true,
    });
    expect(request).toHaveBeenCalled();
    const unavailable = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () =>
        `${PROCESS}\nP 456 /opt/antigravity/language_server --csrf_token other --extension_server_port 9999`,
      request,
      () => owner,
    );
    await expect(
      unavailable({
        target: { ownerRef: { key: owner } } as never,
        refresh: true,
      }),
    ).resolves.toMatchObject({ status: 'service-unavailable' });
    const noPorts = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () => ' 812 /opt/antigravity/language_server --csrf_token token',
      request,
      () => owner,
    );
    await expect(
      noPorts({ target: { ownerRef: { key: owner } } as never, refresh: true }),
    ).resolves.toMatchObject({ status: 'service-unavailable' });
  });
  it('caps long model names, parses reset time, and keeps logger output private', async () => {
    const logger = createMockLogger() as unknown as Logger;
    const long = 'x'.repeat(100);
    const instance = createAntigravityPlanUsageReader(
      logger,
      () => 2,
      async (command) => (command === 'lsof' ? 'n127.0.0.1:5555' : PROCESS),
      async () => ({
        userStatus: {
          email: EMAIL,
          cascadeModelConfigData: {
            clientModelConfigs: [
              {
                label: long,
                quotaInfo: {
                  remainingFraction: 1,
                  resetTime: '2030-01-01T00:00:00Z',
                },
              },
            ],
          },
        },
      }),
      () => owner,
    );
    const result = await instance({
      target: { ownerRef: { key: owner } } as never,
      refresh: true,
    });
    expect(result.windows[0]).toMatchObject({
      modelScope: long.slice(0, 64),
      resetsAt: Date.parse('2030-01-01T00:00:00Z'),
    });
    expect(JSON.stringify(logger)).not.toContain(EMAIL);
    expect(JSON.stringify(logger)).not.toContain(TOKEN);
  });
  it('sends confirmed headers and JSON body over a real loopback request', async () => {
    const seen = await new Promise<{
      headers: Record<string, string | string[] | undefined>;
      body: string;
    }>((resolve) => {
      const server = createServer((request, reply) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => {
          resolve({
            headers: request.headers,
            body: Buffer.concat(chunks).toString(),
          });
          reply.end('{}');
          server.close();
        });
      });
      server.listen(0, '127.0.0.1', async () => {
        const address = server.address();
        if (address && typeof address !== 'string')
          await defaultRequest(
            'http',
            address.port,
            TOKEN,
            new AbortController().signal,
          );
      });
    });
    expect(seen.headers[ANTIGRAVITY_CSRF_HEADER.toLowerCase()]).toBe(TOKEN);
    expect(seen.headers['content-type']).toBe('application/json');
    expect(seen.headers['connect-protocol-version']).toBe('1');
    expect(JSON.parse(seen.body)).toEqual(ANTIGRAVITY_REQUEST_BODY);
  });
  it('removes caller abort listener after settling', async () => {
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    await reader(async () => response)({
      target: { ownerRef: { key: owner } } as never,
      refresh: true,
      signal: controller.signal,
    });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('handles quoted arguments, aborts discovery, and rejects a real closed-port request', async () => {
    const quoted =
      ' 812 "/opt/antigravity/language_server" --csrf_token="' +
      TOKEN +
      '" --extension_server_port=4444';
    const request = jest.fn(async () => response);
    const quotedReader = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () => quoted,
      request,
      () => owner,
    );
    await quotedReader({
      target: { ownerRef: { key: owner } } as never,
      refresh: true,
    });
    expect(request).toHaveBeenCalledWith(
      'http',
      4444,
      TOKEN,
      expect.any(AbortSignal),
    );
    const controller = new AbortController();
    const pending = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () => new Promise<string>(() => undefined),
      request,
    )({
      target: { ownerRef: { key: owner } } as never,
      refresh: true,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toMatchObject({
      status: 'service-unavailable',
    });
    const port = await new Promise<number>((resolve) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() =>
          resolve((address as import('node:net').AddressInfo).port),
        );
      });
    });
    await expect(
      defaultRequest('http', port, TOKEN, new AbortController().signal),
    ).rejects.toBeDefined();
  });
  it('applies one deadline to an unsettled discovery command', async () => {
    jest.useFakeTimers();
    try {
      const pending = createAntigravityPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => 1,
        async () => new Promise<string>(() => undefined),
      )({ target: { ownerRef: { key: owner } } as never, refresh: true });
      await jest.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toMatchObject({
        status: 'service-unavailable',
      });
    } finally {
      jest.useRealTimers();
    }
  });
  it('returns unavailable when the parsed account belongs to another owner', async () => {
    const result = await reader(
      async () => response,
      () => 'antigravity#account:different',
    )({ target: { ownerRef: { key: owner } } as never, refresh: true });
    expect(result.status).toBe('service-unavailable');
  });
  it('keeps the confirmed transport constants exact', () => {
    expect(ANTIGRAVITY_CSRF_HEADER).toBe('X-Codeium-Csrf-Token');
    expect(ANTIGRAVITY_REQUEST_BODY).toEqual({
      metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        ideVersion: 'unknown',
        locale: 'en',
      },
    });
  });
  it('settles once on a request error', async () => {
    const request = { on: jest.fn(), end: jest.fn(), destroy: jest.fn() };
    (request.on as jest.Mock).mockImplementation((event, listener) => {
      if (event === 'error') listener(new Error('ECONNREFUSED'));
      return request;
    });
    await expect(readJsonResponse(() => request as never)).rejects.toThrow(
      'ECONNREFUSED',
    );
  });
});
