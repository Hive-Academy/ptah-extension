import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { SdkAgentAdapter } from './sdk-agent-adapter';

type AuthOperationContext = NonNullable<
  Parameters<SdkAgentAdapter['initialize']>[0]
>;

/** Isolate the initialization path from constructor event subscriptions. */
function fixture(configured = true) {
  const configureAuthentication = jest.fn().mockResolvedValue({
    configured,
    details: [],
    errorMessage: configured ? undefined : 'Auth unavailable',
  });
  const findExecutable = jest
    .fn()
    .mockResolvedValue({ path: '/cli', cliJsPath: '/cli.js' });
  const setHealth = jest.fn();
  const emitInitialized = jest.fn();
  const adapter: SdkAgentAdapter = Object.assign(
    Object.create(SdkAgentAdapter.prototype) as SdkAgentAdapter,
    {
      initInFlight: null,
      logger: createMockLogger(),
      authManager: {
        resolveActiveAuth: () => ({
          authMethod: 'oauth',
          providerId: 'openai-codex',
        }),
        configureAuthentication,
      },
      config: {
        get: (key: string) =>
          key === 'model.selected' ? 'claude-sonnet' : undefined,
      },
      runtimeState: { setHealth, setCliJsPath: jest.fn() },
      cliDetector: { findExecutable },
      events: { emitInitialized },
      sentryService: { captureException: jest.fn() },
    },
  );
  return {
    adapter,
    configureAuthentication,
    findExecutable,
    setHealth,
    emitInitialized,
  };
}

describe('legacy runtime auth initialization', () => {
  it('passes explicit operation context unchanged to the existing auth path', async () => {
    const h = fixture();
    const context: AuthOperationContext = {
      reason: 'legacy-session-start',
      hostNativeCodex: true,
      providerId: 'openai-codex',
      normalizedHome: '/home/codex',
    };
    await expect(h.adapter.initialize(context)).resolves.toBe(true);
    expect(h.configureAuthentication).toHaveBeenCalledWith(undefined, context);
    expect(h.configureAuthentication.mock.calls[0][1]).toBe(context);
    expect(h.findExecutable).toHaveBeenCalledTimes(1);
    expect(h.emitInitialized).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it('keeps the no-argument default auth call and CLI initialization when context is absent', async () => {
    const h = fixture();
    await expect(h.adapter.initialize()).resolves.toBe(true);
    expect(h.configureAuthentication).toHaveBeenCalledWith();
    expect(h.findExecutable).toHaveBeenCalledTimes(1);
    expect(h.setHealth).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'available' }),
    );
  });

  it('preserves auth-failure behavior without a context', async () => {
    const h = fixture(false);
    await expect(h.adapter.initialize()).resolves.toBe(false);
    expect(h.configureAuthentication).toHaveBeenCalledWith();
    expect(h.findExecutable).not.toHaveBeenCalled();
    expect(h.emitInitialized).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });
});
