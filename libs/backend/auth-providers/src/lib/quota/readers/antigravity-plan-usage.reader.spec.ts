import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { ANTIGRAVITY_WINDOWS_PROCESS_ARGS } from './antigravity-ls.provisional';
import { createAntigravityPlanUsageReader } from './antigravity-plan-usage.reader';

const CSRF_TOKEN = 'csrf-private-token';
const PROCESS = `123 antigravity language_server --csrf_token ${CSRF_TOKEN} --port 4444`;

function loggerCalls(logger: Record<string, unknown>): string {
  return JSON.stringify(
    Object.values(logger)
      .filter(jest.isMockFunction)
      .flatMap((method) => method.mock.calls),
  );
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
      key: 'weekly_model:gemini',
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

  it('preserves a long Windows command line so arguments at its end are parsed', async () => {
    const request = jest.fn(async () => ({
      models: { gemini: { remainingFraction: 0.5 } },
    }));
    const reader = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () =>
        `99 antigravity language_server ${'x'.repeat(12_000)} --csrf_token ${CSRF_TOKEN} --port 4444`,
      request,
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
    const request = jest.fn(async () => ({ models: {} }));
    const reader = createAntigravityPlanUsageReader(
      createMockLogger() as unknown as Logger,
      () => 1,
      async () => '123 codeium language_server --csrf_token other --port 4444',
      request,
    );
    await expect(
      reader({ target: {} as never, refresh: true }),
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
    expect(request).not.toHaveBeenCalled();
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
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
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
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
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
    await expect(pending).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
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
    ).resolves.toEqual({
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: [],
    });
    expect(loggerCalls(rawLogger)).not.toContain(CSRF_TOKEN);
  });
});
