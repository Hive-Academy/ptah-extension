import {
  createServer,
  request as httpRequest,
  type RequestListener,
  type Server,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  ANTIGRAVITY_STATUS_PATH,
  ANTIGRAVITY_WINDOWS_PROCESS_ARGS,
} from './antigravity-ls.provisional';
import {
  ANTIGRAVITY_MAX_MODEL_LENGTH,
  ANTIGRAVITY_USAGE_TIMEOUT_MS,
  createAntigravityPlanUsageReader,
  readJsonResponse,
} from './antigravity-plan-usage.reader';

const CSRF_TOKEN = 'csrf-private-token';
const SERVER_EXE =
  '/home/u/.antigravity/extensions/antigravity/bin/language_server_linux_x64';
const PROCESS = `123 ${SERVER_EXE} --csrf_token ${CSRF_TOKEN} --port 4444`;
const UNAVAILABLE = {
  status: 'service-unavailable',
  windowSetEstablished: false,
  windows: [],
};

function loggerCalls(logger: Record<string, unknown>): string {
  return JSON.stringify(
    Object.values(logger)
      .filter(jest.isMockFunction)
      .flatMap((method) => method.mock.calls),
  );
}

function readerFor(
  processList: string,
  request: jest.Mock = jest.fn(async () => ({
    models: { gemini: { remainingFraction: 0.5 } },
  })),
) {
  const reader = createAntigravityPlanUsageReader(
    createMockLogger() as unknown as Logger,
    () => 1,
    async () => processList,
    request,
  );
  return { reader, request };
}

describe('Antigravity plan-usage reader', () => {
  it('F33: maps provisional data without exposing the CSRF token in logger calls', async () => {
    const rawLogger = createMockLogger() as unknown as Record<string, unknown>;
    const request = jest.fn(async () => ({
      models: { gemini: { remainingFraction: 0.25, resetTime: null } },
    }));
    const reader = createAntigravityPlanUsageReader(
      rawLogger as unknown as Logger,
      () => 1,
      async () => PROCESS,
      request,
    );
    const reading = await reader({ target: {} as never, refresh: true });
    expect(reading.windows[0]).toMatchObject({
      key: 'other:model-gemini',
      kind: 'other',
      label: 'Window 1 · gemini',
      modelScope: 'gemini',
      used: { kind: 'percent', percent: 75 },
      usedSource: 'provider-unofficial',
    });
    expect(request).toHaveBeenCalledWith(
      4444,
      CSRF_TOKEN,
      expect.any(AbortSignal),
    );
    expect(loggerCalls(rawLogger)).not.toContain(CSRF_TOKEN);
  });

  it('never asserts a period, rounds the percent and caps the model name', async () => {
    const longModel = 'm'.repeat(500);
    const { reader } = readerFor(
      PROCESS,
      jest.fn(async () => ({
        models: {
          gemini: { remainingFraction: 0.7 },
          [longModel]: { remainingFraction: 0.123456 },
        },
      })),
    );
    const reading = await reader({ target: {} as never, refresh: true });
    expect(reading.windows.map((w) => w.kind)).toEqual(['other', 'other']);
    expect(reading.windows.some((w) => /weekly/i.test(w.label))).toBe(false);
    expect(reading.windows[0].used).toEqual({ kind: 'percent', percent: 30 });
    expect(reading.windows[1].used).toEqual({
      kind: 'percent',
      percent: 87.7,
    });
    const capped = 'm'.repeat(ANTIGRAVITY_MAX_MODEL_LENGTH);
    expect(reading.windows[1]).toMatchObject({
      key: `other:model-${capped}`,
      label: `Window 2 · ${capped}`,
      modelScope: capped,
    });
  });

  it('preserves a long Windows command line so arguments at its end are parsed', async () => {
    const { reader, request } = readerFor(
      `99 C:\\Users\\u\\AppData\\Local\\Programs\\Antigravity\\bin\\language_server_windows_x64.exe ${'x'.repeat(12_000)} --csrf_token ${CSRF_TOKEN} --port 4444`,
    );
    await reader({ target: {} as never, refresh: true });
    expect(ANTIGRAVITY_WINDOWS_PROCESS_ARGS[2]).toContain('ForEach-Object');
    expect(request).toHaveBeenCalledWith(
      4444,
      CSRF_TOKEN,
      expect.any(AbortSignal),
    );
  });

  it('does not attribute a non-Antigravity language server', async () => {
    const { reader, request } = readerFor(
      '123 /opt/codeium/bin/language_server_linux_x64 --csrf_token other --port 4444',
    );
    await expect(
      reader({ target: {} as never, refresh: true }),
    ).resolves.toEqual(UNAVAILABLE);
    expect(request).not.toHaveBeenCalled();
  });

  it('anchors the markers to the executable, not to an argument naming them', async () => {
    const { reader, request } = readerFor(
      [
        '77 /usr/bin/vim /src/antigravity/language_server.go --csrf_token stolen --port 5555',
        '78 C:\\Tools\\editor.exe C:\\antigravity\\language_server.ts --csrf_token=stolen --port=5555',
      ].join('\n'),
    );
    await expect(
      reader({ target: {} as never, refresh: true }),
    ).resolves.toEqual(UNAVAILABLE);
    expect(request).not.toHaveBeenCalled();
  });

  it('treats several different (port, token) pairs as ambiguous', async () => {
    const { reader, request } = readerFor(
      [PROCESS, `456 ${SERVER_EXE} --csrf_token other-token --port 5555`].join(
        '\n',
      ),
    );
    await expect(
      reader({ target: {} as never, refresh: true }),
    ).resolves.toEqual(UNAVAILABLE);
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts the same (port, token) pair listed twice', async () => {
    const { reader, request } = readerFor(`${PROCESS}\n${PROCESS}`);
    await reader({ target: {} as never, refresh: true });
    expect(request).toHaveBeenCalledWith(
      4444,
      CSRF_TOKEN,
      expect.any(AbortSignal),
    );
  });

  it('strips the quotes of a quoted Windows executable and token', async () => {
    const { reader, request } = readerFor(
      `321 "C:\\Program Files\\Antigravity\\resources\\bin\\language_server_windows_x64.exe" --csrf_token "${CSRF_TOKEN}" --port 4444`,
    );
    await reader({ target: {} as never, refresh: true });
    expect(request).toHaveBeenCalledWith(
      4444,
      CSRF_TOKEN,
      expect.any(AbortSignal),
    );
  });

  it('returns service-unavailable for a rejected local request without logging the CSRF token', async () => {
    const rawLogger = createMockLogger() as unknown as Record<string, unknown>;
    const reader = createAntigravityPlanUsageReader(
      rawLogger as unknown as Logger,
      () => 1,
      async () => PROCESS,
      async () => Promise.reject(new Error('request failed')),
    );
    await expect(
      reader({ target: {} as never, refresh: true }),
    ).resolves.toEqual(UNAVAILABLE);
    expect(loggerCalls(rawLogger)).not.toContain(CSRF_TOKEN);
  });

  it('honours an already-aborted caller signal before process discovery', async () => {
    const run = jest.fn(async () => PROCESS);
    const controller = new AbortController();
    controller.abort();
    const reader = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      run,
      async () => ({ models: {} }),
    );
    await expect(
      reader({ target: {} as never, refresh: true, signal: controller.signal }),
    ).resolves.toEqual(UNAVAILABLE);
    expect(run).not.toHaveBeenCalled();
  });

  it('passes a caller abort through to the local request', async () => {
    const controller = new AbortController();
    const request = jest.fn(
      (_port: number, _csrf: string, signal: AbortSignal) =>
        new Promise<unknown>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const reader = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () => PROCESS,
      request,
    );
    const pending = reader({
      target: {} as never,
      refresh: true,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toEqual(UNAVAILABLE);
  });

  it('observes a caller abort during process discovery', async () => {
    const controller = new AbortController();
    let discoverySignal: AbortSignal | undefined;
    const run = jest.fn(
      (_command: string, _args: readonly string[], signal: AbortSignal) => {
        discoverySignal = signal;
        return new Promise<string>(() => undefined);
      },
    );
    const request = jest.fn();
    const reader = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      run,
      request,
    );
    const pending = reader({
      target: {} as never,
      refresh: true,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toEqual(UNAVAILABLE);
    expect(discoverySignal?.aborted).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('one deadline covers discovery and the request together', async () => {
    jest.useFakeTimers();
    try {
      const run = jest.fn(
        () =>
          new Promise<string>((resolve) =>
            setTimeout(
              () => resolve(PROCESS),
              ANTIGRAVITY_USAGE_TIMEOUT_MS - 500,
            ),
          ),
      );
      // A request that ignores its signal entirely still cannot outlive it.
      const request = jest.fn(() => new Promise<unknown>(() => undefined));
      const reader = createAntigravityPlanUsageReader(
        createMockLogger() as unknown as Logger,
        () => 1,
        run,
        request,
      );
      let settled = false;
      const pending = reader({ target: {} as never, refresh: true }).then(
        (reading) => {
          settled = true;
          return reading;
        },
      );
      await jest.advanceTimersByTimeAsync(ANTIGRAVITY_USAGE_TIMEOUT_MS - 1);
      expect(request).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual(UNAVAILABLE);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns service-unavailable for a mismatch without logging the CSRF token', async () => {
    const rawLogger = createMockLogger() as unknown as Record<string, unknown>;
    const reader = createAntigravityPlanUsageReader(
      rawLogger as unknown as Logger,
      () => 1,
      async () => PROCESS,
      async () => ({ models: { gemini: { remainingFraction: 2 } } }),
    );
    await expect(
      reader({ target: {} as never, refresh: true }),
    ).resolves.toEqual(UNAVAILABLE);
    expect(loggerCalls(rawLogger)).not.toContain(CSRF_TOKEN);
  });
});

describe('Antigravity readJsonResponse (loopback server, in-process)', () => {
  let server: Server;
  let port: number;
  let handler: RequestListener;

  beforeAll(async () => {
    server = createServer((req, res) => handler(req, res));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  const call = (signal?: AbortSignal, maxBytes?: number) =>
    readJsonResponse(
      (onResponse) =>
        httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: ANTIGRAVITY_STATUS_PATH,
            method: 'POST',
            ...(signal && { signal }),
          },
          onResponse,
        ),
      maxBytes,
    );

  it('parses a 2xx JSON body', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: {} }));
    };
    await expect(call()).resolves.toEqual({ models: {} });
  });

  it('settles within the deadline when the body stalls after the headers', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"models":');
      // Never ends: the client's deadline must settle the read.
    };
    const started = Date.now();
    await expect(call(AbortSignal.timeout(200))).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(ANTIGRAVITY_USAGE_TIMEOUT_MS);
  });

  it('rejects when the server drops the connection mid-body', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"models":', () => res.socket?.destroy());
    };
    await expect(call()).rejects.toBeDefined();
  });

  it('rejects a non-2xx status without parsing the body', async () => {
    handler = (_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: {} }));
    };
    await expect(call()).rejects.toThrow('status 500');
  });

  it('rejects a body over the size cap', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: {}, padding: 'x'.repeat(4_096) }));
    };
    await expect(call(undefined, 1_024)).rejects.toThrow(
      'response body too large',
    );
  });
});
