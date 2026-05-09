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
  let licenseService: { getCachedStatus: jest.Mock };
  let handler: RpcHandler;

  beforeEach(() => {
    captureException = jest.fn();
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    licenseService = {
      getCachedStatus: jest
        .fn()
        .mockReturnValue({ valid: true, tier: 'pro', reason: null }),
    };

    container.registerInstance(TOKENS.SENTRY_SERVICE, {
      captureException,
    });

    handler = new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      licenseService as unknown as ConstructorParameters<typeof RpcHandler>[1],
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
      'LICENSE_REQUIRED',
      'PRO_TIER_REQUIRED',
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

  it("exempts 'db:' methods from license check (TASK_2026_THOTH_PERSISTENCE_HARDENING)", async () => {
    // Replace license service with one that returns no cached status (would
    // normally block all non-exempt methods).
    const unlicensedHandler = new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      {
        getCachedStatus: jest.fn().mockReturnValue(null),
      } as unknown as ConstructorParameters<typeof RpcHandler>[1],
    );

    unlicensedHandler.registerMethod('db:health', async () => ({
      isOpen: false,
    }));

    const response = await unlicensedHandler.handleMessage({
      method: 'db:health',
      params: {},
      correlationId: 'db-health-unlicensed',
    });

    // Must NOT return LICENSE_REQUIRED — db: methods are exempt
    expect(response.success).toBe(true);
    expect(response.errorCode).toBeUndefined();
  });
});
