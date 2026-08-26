import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import { RpcHandler } from './rpc-handler';
import { RpcUserError } from './rpc-types';

describe('RpcHandler.handleMessage — RpcUserError handling', () => {
  let captureException: jest.Mock;
  let logger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let handler: RpcHandler;

  beforeEach(() => {
    captureException = jest.fn();
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    container.registerInstance(TOKENS.SENTRY_SERVICE, {
      captureException,
    });

    handler = new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      {
        captureException,
      } as unknown as ConstructorParameters<typeof RpcHandler>[1],
      undefined,
    );
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('returns structured errorCode and skips Sentry when handler throws RpcUserError', async () => {
    handler.registerMethod('session:list', async () => {
      throw new RpcUserError('Open a folder first.', 'WORKSPACE_NOT_OPEN');
    });

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'corr-1',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('WORKSPACE_NOT_OPEN');
    expect(response.error).toBe('Open a folder first.');
    expect(response.correlationId).toBe('corr-1');
    expect(captureException).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('still reports plain Errors to Sentry', async () => {
    handler.registerMethod('session:list', async () => {
      throw new Error('database is on fire');
    });

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'corr-2',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBeUndefined();
    expect(response.error).toBe('database is on fire');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'database is on fire' }),
      expect.objectContaining({ errorSource: 'rpc-handler' }),
    );
  });

  it('passes errorCode through for each RpcUserError variant', async () => {
    const cases = [
      'AUTH_REQUIRED',
      'PERSISTENCE_UNAVAILABLE',
      'WORKSPACE_NOT_OPEN',
      'MESSAGE_ID_NOT_FOUND',
      'MODEL_NOT_AVAILABLE',
    ] as const;

    for (const code of cases) {
      handler.registerMethod('session:list', async () => {
        throw new RpcUserError(`msg-${code}`, code);
      });
      const response = await handler.handleMessage({
        method: 'session:list',
        params: {},
        correlationId: `corr-${code}`,
      });
      expect(response.errorCode).toBe(code);
      expect(response.success).toBe(false);
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it("accepts 'db:' prefixed methods (TASK_2026_THOTH_PERSISTENCE_HARDENING)", () => {
    // registerMethod should not throw for db: prefixed names
    expect(() => {
      handler.registerMethod('db:health', async () => ({ isOpen: true }));
    }).not.toThrow();

    expect(() => {
      handler.registerMethod('db:reset', async () => ({
        success: true,
        backupPath: null,
        message: 'done',
      }));
    }).not.toThrow();
  });

  it("handles 'db:' prefixed methods (TASK_2026_THOTH_PERSISTENCE_HARDENING)", async () => {
    handler.registerMethod('db:health', async () => ({
      isOpen: false,
    }));

    const response = await handler.handleMessage({
      method: 'db:health',
      params: {},
      correlationId: 'db-health',
    });

    expect(response.success).toBe(true);
    expect(response.errorCode).toBeUndefined();
  });
});

describe('RpcHandler.handleMessage — slow-handler warning (TASK_2026_323)', () => {
  let logger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let addBreadcrumb: jest.Mock;

  /**
   * Builds a handler whose slow threshold is driven by the env var, so the
   * tests can pick a bound low enough to cross with a real `await` rather than
   * faking the clock. `slowWarnMs` is read in the field initialiser, so the env
   * var must be set BEFORE construction — hence a factory, not a shared
   * instance from `beforeEach`.
   */
  const buildHandler = (thresholdMs: number, withTracer = true): RpcHandler => {
    process.env['PTAH_RPC_SLOW_WARN_MS'] = String(thresholdMs);
    return new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      undefined,
      withTracer
        ? ({
            addBreadcrumb,
            startSpan: jest.fn(),
          } as unknown as ConstructorParameters<typeof RpcHandler>[2])
        : undefined,
    );
  };

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    addBreadcrumb = jest.fn();
  });

  afterEach(() => {
    delete process.env['PTAH_RPC_SLOW_WARN_MS'];
  });

  it('warns with method and duration when a handler exceeds the threshold', async () => {
    // Threshold 0.0001 ms: any real handler crosses it, so the assertion does
    // not depend on how fast the machine running the suite happens to be.
    const handler = buildHandler(0.0001);
    handler.registerMethod('memory:search', async () => ({ hits: [] }));

    const response = await handler.handleMessage({
      method: 'memory:search',
      params: {},
      correlationId: 'slow-1',
    });

    expect(response.success).toBe(true);
    const slowWarning = logger.warn.mock.calls.find(
      (call) => call[0] === '[RPC] slow handler',
    );
    expect(slowWarning).toBeDefined();
    expect(slowWarning?.[1]).toEqual(
      expect.objectContaining({ method: 'memory:search' }),
    );
    expect(
      (slowWarning?.[1] as { durationMs: number }).durationMs,
    ).toBeGreaterThanOrEqual(0);
  });

  it('stays quiet for a handler under the threshold', async () => {
    const handler = buildHandler(60_000);
    handler.registerMethod('session:list', async () => ({ sessions: [] }));

    await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'fast-1',
    });

    expect(
      logger.warn.mock.calls.filter((call) => call[0] === '[RPC] slow handler'),
    ).toHaveLength(0);
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });

  it('warns even when the slow handler throws', async () => {
    const handler = buildHandler(0.0001);
    handler.registerMethod('chat:sendMessage', async () => {
      throw new Error('boom');
    });

    const response = await handler.handleMessage({
      method: 'chat:sendMessage',
      params: {},
      correlationId: 'slow-throw',
    });

    expect(response.success).toBe(false);
    expect(
      logger.warn.mock.calls.some((call) => call[0] === '[RPC] slow handler'),
    ).toBe(true);
  });

  it('records a tracer breadcrumb when a tracer is injected', async () => {
    const handler = buildHandler(0.0001);
    handler.registerMethod('workspace:analyze', async () => ({}));

    await handler.handleMessage({
      method: 'workspace:analyze',
      params: {},
      correlationId: 'trace-1',
    });

    expect(addBreadcrumb).toHaveBeenCalledWith(
      'rpc',
      'slow handler',
      expect.objectContaining({
        method: 'workspace:analyze',
        correlationId: 'trace-1',
      }),
    );
  });

  it('still warns when no tracer is registered', async () => {
    const handler = buildHandler(0.0001, false);
    handler.registerMethod('workspace:analyze', async () => ({}));

    await handler.handleMessage({
      method: 'workspace:analyze',
      params: {},
      correlationId: 'no-tracer',
    });

    expect(
      logger.warn.mock.calls.some((call) => call[0] === '[RPC] slow handler'),
    ).toBe(true);
    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});
