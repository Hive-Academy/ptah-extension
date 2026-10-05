import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SessionEndCallback,
  SessionEndCallbackRegistry,
} from '../session-end-callback-registry';
import type { ContextUsageReadBack } from '../session-lifecycle-manager';
import {
  CONTEXT_USAGE_READ_TIMEOUT_MS,
  ContextUsagePort,
  type ContextUsageQuery,
} from './context-usage.port';

function createLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

function createRegistry(): {
  registry: SessionEndCallbackRegistry;
  fire: (sessionId: string) => void;
} {
  const callbacks: SessionEndCallback[] = [];
  const registry = {
    register: jest.fn((cb: SessionEndCallback) => {
      callbacks.push(cb);
      return () => undefined;
    }),
  } as unknown as SessionEndCallbackRegistry;
  return {
    registry,
    fire: (sessionId) =>
      callbacks.forEach((cb) => cb({ sessionId, workspaceRoot: '/ws' })),
  };
}

const USAGE: ContextUsageReadBack = {
  totalTokens: 120_000,
  maxTokens: 200_000,
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
};

function queryReturning(
  impl: () => Promise<ContextUsageReadBack>,
): ContextUsageQuery & { getContextUsage: jest.Mock } {
  return { getContextUsage: jest.fn(impl) };
}

describe('ContextUsagePort', () => {
  let logger: jest.Mocked<Logger>;
  let ends: ReturnType<typeof createRegistry>;
  let port: ContextUsagePort;

  beforeEach(() => {
    logger = createLogger();
    ends = createRegistry();
    port = new ContextUsagePort(logger, ends.registry);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('maps the SDK response with sdk-getContextUsage provenance and asks for the summary detail', async () => {
    const query = queryReturning(async () => USAGE);

    const reading = await port.readAtTurnEnd('s1', 't1', query);

    expect(reading).toEqual({
      totalTokens: 120_000,
      maxTokens: 200_000,
      autoCompactThreshold: 160_000,
      source: 'sdk-getContextUsage',
    });
    expect(query.getContextUsage).toHaveBeenCalledWith({ detail: 'summary' });
    expect(port.getLast('s1')).toEqual(reading);
  });

  it('omits autoCompactThreshold when the SDK does not report one', async () => {
    const query = queryReturning(async () => ({
      totalTokens: 10,
      maxTokens: 100,
      isAutoCompactEnabled: false,
    }));

    const reading = await port.readAtTurnEnd('s1', 't1', query);

    expect(reading).toEqual({
      totalTokens: 10,
      maxTokens: 100,
      source: 'sdk-getContextUsage',
    });
    expect(reading).not.toHaveProperty('autoCompactThreshold');
  });

  it('calls the accessor at most once per session and turn, including concurrent callers', async () => {
    const query = queryReturning(async () => USAGE);

    const [a, b] = await Promise.all([
      port.readAtTurnEnd('s1', 't1', query),
      port.readAtTurnEnd('s1', 't1', query),
    ]);
    const c = await port.readAtTurnEnd('s1', 't1', query);

    expect(query.getContextUsage).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it('reads again on the next turn and keeps sessions apart', async () => {
    const query = queryReturning(async () => USAGE);

    await port.readAtTurnEnd('s1', 't1', query);
    await port.readAtTurnEnd('s1', 't2', query);
    await port.readAtTurnEnd('s2', 't1', query);

    expect(query.getContextUsage).toHaveBeenCalledTimes(3);
    expect(port.getLast('s2')).toBeDefined();
    expect(port.getLast('s3')).toBeUndefined();
  });

  it('returns undefined and logs one line when the accessor is missing', async () => {
    const reading = await port.readAtTurnEnd('s1', 't1', {});

    expect(reading).toBeUndefined();
    expect(port.getLast('s1')).toBeUndefined();
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns undefined, logs the error type only, and keeps the last good reading when the accessor throws', async () => {
    await port.readAtTurnEnd('s1', 't1', queryReturning(async () => USAGE));
    const throwing = queryReturning(async () => {
      throw new TypeError('secret /path/to/file');
    });

    await expect(
      port.readAtTurnEnd('s1', 't2', throwing),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = String(logger.warn.mock.calls[0][0]);
    expect(line).toContain('TypeError');
    expect(line).not.toContain('secret');
    expect(port.getLast('s1')?.totalTokens).toBe(120_000);
  });

  it('returns undefined and logs one line when the response has no finite token counts', async () => {
    const query = queryReturning(
      async () =>
        ({
          totalTokens: Number.NaN,
          isAutoCompactEnabled: true,
        }) as unknown as ContextUsageReadBack,
    );

    await expect(
      port.readAtTurnEnd('s1', 't1', query),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the accessor never answers within the timeout', async () => {
    jest.useFakeTimers();
    const query = queryReturning(() => new Promise(() => undefined));

    const pending = port.readAtTurnEnd('s1', 't1', query);
    await jest.advanceTimersByTimeAsync(CONTEXT_USAGE_READ_TIMEOUT_MS);

    await expect(pending).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('release drops the cached reading and the turn entry', async () => {
    const query = queryReturning(async () => USAGE);
    await port.readAtTurnEnd('s1', 't1', query);

    port.release('s1');

    expect(port.getLast('s1')).toBeUndefined();
    await port.readAtTurnEnd('s1', 't1', query);
    expect(query.getContextUsage).toHaveBeenCalledTimes(2);
  });

  it('a release while a read is in flight is not undone by its result', async () => {
    let resolve!: (value: ContextUsageReadBack) => void;
    const query = queryReturning(
      () => new Promise<ContextUsageReadBack>((r) => (resolve = r)),
    );

    const pending = port.readAtTurnEnd('s1', 't1', query);
    port.release('s1');
    resolve(USAGE);
    await pending;

    expect(port.getLast('s1')).toBeUndefined();
  });

  it('releases the session on the session-end signal', async () => {
    await port.readAtTurnEnd('s1', 't1', queryReturning(async () => USAGE));

    ends.fire('s1');

    expect(port.getLast('s1')).toBeUndefined();
  });
});
