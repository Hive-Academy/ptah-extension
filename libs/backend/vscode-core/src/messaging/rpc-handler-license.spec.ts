import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import { RpcHandler } from './rpc-handler';

describe('RpcHandler — license validation branches', () => {
  let logger: {
    debug: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let captureException: jest.Mock;

  function buildHandler(licenseReturn: unknown) {
    const licenseService = {
      getCachedStatus: jest.fn().mockReturnValue(licenseReturn),
    };
    return new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      licenseService as unknown as ConstructorParameters<typeof RpcHandler>[1],
      { captureException } as unknown as ConstructorParameters<
        typeof RpcHandler
      >[2],
    );
  }

  beforeEach(() => {
    captureException = jest.fn();
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    container.registerInstance(TOKENS.SENTRY_SERVICE, { captureException });
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('blocks with LICENSE_REQUIRED when no cached status', async () => {
    const handler = buildHandler(null);
    handler.registerMethod('session:list', async () => ({}));

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-1',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('LICENSE_REQUIRED');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('No cached license status'),
      expect.anything(),
    );
  });

  it('blocks with LICENSE_REQUIRED when license is invalid', async () => {
    const handler = buildHandler({
      valid: false,
      tier: 'community',
      reason: 'expired',
    });
    handler.registerMethod('session:list', async () => ({}));

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-2',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('LICENSE_REQUIRED');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Invalid license'),
      expect.anything(),
    );
  });

  it('blocks with PRO_TIER_REQUIRED when community tier accesses pro-only method', async () => {
    const handler = buildHandler({
      valid: true,
      tier: 'community',
      reason: null,
    });
    handler.registerMethod('setup-wizard:start', async () => ({}));

    const response = await handler.handleMessage({
      method: 'setup-wizard:start',
      params: {},
      correlationId: 'c-3',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('PRO_TIER_REQUIRED');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Pro tier required'),
      expect.anything(),
    );
  });

  it('allows pro-only method when tier=pro', async () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });
    handler.registerMethod('setup-wizard:start', async () => ({ ok: true }));

    const response = await handler.handleMessage({
      method: 'setup-wizard:start',
      params: {},
      correlationId: 'c-4',
    });

    expect(response.success).toBe(true);
  });

  it('allows pro-only method when tier=trial_pro', async () => {
    const handler = buildHandler({
      valid: true,
      tier: 'trial_pro',
      reason: null,
    });
    handler.registerMethod('ptahCli:list', async () => ({ agents: [] }));

    const response = await handler.handleMessage({
      method: 'ptahCli:list',
      params: {},
      correlationId: 'c-5',
    });

    expect(response.success).toBe(true);
  });

  it('bypasses license check for license: prefix', async () => {
    const handler = buildHandler(null);
    handler.registerMethod('license:status', async () => ({ active: false }));

    const response = await handler.handleMessage({
      method: 'license:status',
      params: {},
      correlationId: 'c-6',
    });

    expect(response.success).toBe(true);
  });

  it('bypasses license check for auth: prefix', async () => {
    const handler = buildHandler(null);
    handler.registerMethod('auth:login', async () => ({ ok: true }));

    const response = await handler.handleMessage({
      method: 'auth:login',
      params: {},
      correlationId: 'c-7',
    });

    expect(response.success).toBe(true);
  });

  it('bypasses license check for settings: prefix', async () => {
    const handler = buildHandler(null);
    handler.registerMethod('settings:export', async () => ({ data: {} }));

    const response = await handler.handleMessage({
      method: 'settings:export',
      params: {},
      correlationId: 'c-8',
    });

    expect(response.success).toBe(true);
  });

  it('returns method not found when handler not registered', async () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-nf',
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Method not found/);
    expect(response.errorCode).toBeUndefined();
  });

  it('throws when registering a method with invalid prefix', () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });

    expect(() =>
      handler.registerMethod('malicious:hack', async () => ({})),
    ).toThrow(/Invalid method name/);
    expect(logger.error).toHaveBeenCalled();
  });

  it('warns when overwriting an existing method', () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });
    handler.registerMethod('session:list', async () => ({ v: 1 }));
    handler.registerMethod('session:list', async () => ({ v: 2 }));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Overwriting method'),
    );
  });

  it('unregisterMethod removes the handler and returns silently', async () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });
    handler.registerMethod('session:list', async () => ({}));
    handler.unregisterMethod('session:list');

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-unreg',
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Method not found/);
  });

  it('unregisterMethod is a no-op for unknown methods', () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });
    expect(() => handler.unregisterMethod('session:unknown')).not.toThrow();
  });

  it('getRegisteredMethods returns all registered method names', () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });
    handler.registerMethod('session:list', async () => ({}));
    handler.registerMethod('chat:sendMessage', async () => ({}));

    const methods = handler.getRegisteredMethods();
    expect(methods).toContain('session:list');
    expect(methods).toContain('chat:sendMessage');
  });

  it('handles license validation exception and returns LICENSE_REQUIRED', async () => {
    const licenseService = {
      getCachedStatus: jest.fn().mockImplementation(() => {
        throw new Error('db crash');
      }),
    };
    const handler = new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      licenseService as unknown as ConstructorParameters<typeof RpcHandler>[1],
      undefined,
    );
    handler.registerMethod('session:list', async () => ({}));

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-err',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('LICENSE_REQUIRED');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('License validation error'),
      expect.anything(),
    );
  });

  it('skips Sentry when sentryService is undefined and plain Error is thrown', async () => {
    const licenseService = {
      getCachedStatus: jest
        .fn()
        .mockReturnValue({ valid: true, tier: 'pro', reason: null }),
    };
    const handler = new RpcHandler(
      logger as unknown as ConstructorParameters<typeof RpcHandler>[0],
      licenseService as unknown as ConstructorParameters<typeof RpcHandler>[1],
      undefined,
    );
    handler.registerMethod('session:list', async () => {
      throw new Error('no sentry here');
    });

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-nosentry',
    });

    expect(response.success).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('wraps non-Error thrown values into Error', async () => {
    const handler = buildHandler({ valid: true, tier: 'pro', reason: null });
    handler.registerMethod('session:list', async () => {
      throw 'string-error';
    });

    const response = await handler.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'c-str',
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe('string-error');
  });
});
