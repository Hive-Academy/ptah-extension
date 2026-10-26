import 'reflect-metadata';
import {
  SdkAgentAdapter,
  SdkError,
  type SdkPermissionHandler,
} from '@ptah-extension/agent-sdk';
import type {
  ModelResolver,
  ProviderModelsService,
} from '@ptah-extension/auth-providers';
import {
  ConfigManager,
  RpcHandler,
  type SentryService,
  Logger,
} from '@ptah-extension/vscode-core';
import {
  createMockConfigManager,
  createMockRpcHandler,
  createMockSentryService,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  ModelSettings,
  ReasoningSettings,
} from '@ptah-extension/settings-core';
import type { SessionId, SessionRuntimeControls } from '@ptah-extension/shared';
import {
  createMockModelSettings,
  createMockReasoningSettings,
} from '../../test-utils/mock-settings';
import { ConfigRpcHandlers } from './config-rpc.handlers';
import { configRuntimeControls } from './config-runtime-controls';

function fixture(native = true) {
  const logger: Logger = Object.assign(
    Object.create(Logger.prototype),
    createMockLogger(),
  );
  const rpc: RpcHandler & ReturnType<typeof createMockRpcHandler> =
    Object.assign(Object.create(RpcHandler.prototype), createMockRpcHandler());
  const config: ConfigManager & ReturnType<typeof createMockConfigManager> =
    Object.assign(
      Object.create(ConfigManager.prototype),
      createMockConfigManager(),
    );
  const model = createMockModelSettings();
  const effort = createMockReasoningSettings();
  const legacy: SdkAgentAdapter = Object.assign(
    Object.create(SdkAgentAdapter.prototype),
    {
      setSessionModel: jest.fn().mockResolvedValue(undefined),
      setSessionEffort: jest.fn().mockResolvedValue(undefined),
      setSessionPermissionLevel: jest.fn().mockResolvedValue(undefined),
      getActiveSessionIds: jest.fn().mockReturnValue([]),
    },
  );
  const runtime: jest.Mocked<SessionRuntimeControls> = {
    setModel: jest
      .fn()
      .mockResolvedValue({ timing: 'effectiveNow', revision: 1 }),
    setPermission: jest
      .fn()
      .mockResolvedValue({ timing: 'effectiveNow', revision: 1 }),
    setEffort: jest.fn().mockResolvedValue({ timing: 'nextTurn', revision: 1 }),
    interrupt: jest.fn(),
    compact: jest.fn(),
  };
  runtime.setModel.mockImplementation(async (_id, value, options) => {
    await model.selectedModel.set(value, options?.applyTo);
    return { timing: 'effectiveNow', revision: 1 };
  });
  runtime.setEffort.mockImplementation(async (_id, value, options) => {
    await effort.effort.set(value ?? '', options?.applyTo);
    return { timing: 'nextTurn', revision: 1 };
  });
  runtime.setPermission.mockImplementation(async (_id, value, options) => {
    await config.set('autopilot.enabled', options?.autopilot?.enabled ?? (value !== 'ask'));
    await config.set('autopilot.permissionLevel', options?.autopilot?.permissionLevel ?? value);
    return { timing: 'effectiveNow', revision: 1 };
  });
  new ConfigRpcHandlers(
    logger,
    rpc,
    config,
    legacy,
    {} as ProviderModelsService,
    { setPermissionLevel: jest.fn() } as Pick<
      SdkPermissionHandler,
      'setPermissionLevel'
    > as SdkPermissionHandler,
    {} as ModelResolver,
    createMockSentryService() as SentryService,
    model as ModelSettings,
    effort as ReasoningSettings,
    { getPricing: jest.fn(), ensureHydrated: jest.fn() },
    null,
    native ? runtime : null,
  ).register();
  const call = (method: string, params: Record<string, unknown>) =>
    rpc.handleMessage({ method, params, correlationId: method });
  return { call, runtime, legacy, model, effort, config };
}

describe('config runtime controls', () => {
  it.each([
    [
      'config:model-switch',
      { model: 'gpt-5', sessionId: 'native' },
      'setModel',
      { model: 'gpt-5' },
    ],
    [
      'config:effort-set',
      { effort: 'max', sessionId: 'native' },
      'setEffort',
      { effort: 'max' },
    ],
    [
      'config:autopilot-toggle',
      { enabled: true, permissionLevel: 'yolo', sessionId: 'native' },
      'setPermission',
      { enabled: true, permissionLevel: 'yolo' },
    ],
  ] as const)(
    'routes %s and preserves its result shape',
    async (method, params, operation, expected) => {
      const h = fixture();
      const response = await h.call(method, params);
      expect(response.success).toBe(true);
      expect(response.data).toEqual(expected);
      expect(h.runtime[operation]).toHaveBeenCalled();
      expect(h.legacy.setSessionModel).not.toHaveBeenCalled();
      expect(h.legacy.setSessionEffort).not.toHaveBeenCalled();
      expect(h.legacy.setSessionPermissionLevel).not.toHaveBeenCalled();
    },
  );

  it('applies before saving and surfaces persistence failure', async () => {
    const h = fixture(false);
    const order: string[] = [];
    jest.mocked(h.legacy.setSessionModel).mockImplementation(async () => {
      order.push('apply');
    });
    h.model.selectedModel.set.mockImplementation(async () => {
      order.push('save');
      throw new Error('storage unavailable');
    });
    const response = await h.call('config:model-switch', {
      model: 'gpt-5',
      sessionId: 'native',
    });
    expect(order).toEqual(['apply', 'save']);
    expect(response.success).toBe(false);
  });

  it('does not save when native application fails', async () => {
    const h = fixture();
    h.runtime.setEffort.mockRejectedValue(new Error('busy'));
    expect(
      (
        await h.call('config:effort-set', {
          effort: 'max',
          sessionId: 'native',
        })
      ).success,
    ).toBe(false);
    expect(h.effort.effort.set).not.toHaveBeenCalled();
  });

  it('restores partial permission settings writes on persistence failure', async () => {
    const h = fixture(false);
    h.config.set
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk'));
    expect(
      (
        await h.call('config:autopilot-toggle', {
          enabled: true,
          permissionLevel: 'yolo',
          sessionId: 'native',
        })
      ).success,
    ).toBe(false);
    expect(h.config.set).toHaveBeenNthCalledWith(3, 'autopilot.enabled', false);
    expect(h.config.set).toHaveBeenNthCalledWith(
      4,
      'autopilot.permissionLevel',
      'ask',
    );
  });

  it('delegates frontend yolo and max to the legacy mapping owner without aliases', async () => {
    const h = fixture(false);
    const controls = configRuntimeControls(null, h.legacy);
    await controls.setPermission('claude' as SessionId, 'yolo');
    await controls.setEffort('claude' as SessionId, 'max');
    expect(h.legacy.setSessionPermissionLevel).toHaveBeenCalledWith(
      'claude',
      'yolo',
    );
    expect(h.legacy.setSessionEffort).toHaveBeenCalledWith('claude', 'max');
    expect(
      (
        await h.call('config:effort-set', {
          effort: 'max',
          sessionId: 'claude',
        })
      ).data,
    ).toEqual({ effort: 'max' });
    expect(h.effort.effort.set).toHaveBeenCalledWith('max', 'app');
  });
  it.each([true, false])('writes each setting exactly once (bound=%s)', async (bound) => {
    const h = fixture(bound);
    await h.call('config:model-switch', { model: 'new', sessionId: 'session', applyTo: 'workspace' });
    await h.call('config:effort-set', { effort: 'high', sessionId: 'session', applyTo: 'workspace' });
    await h.call('config:autopilot-toggle', { enabled: true, permissionLevel: 'plan', sessionId: 'session' });
    expect(h.model.selectedModel.set).toHaveBeenCalledTimes(1);
    expect(h.model.selectedModel.set).toHaveBeenCalledWith('new', 'workspace');
    expect(h.effort.effort.set).toHaveBeenCalledTimes(1);
    expect(h.effort.effort.set).toHaveBeenCalledWith('high', 'workspace');
    expect(h.config.set.mock.calls).toEqual([['autopilot.enabled', true], ['autopilot.permissionLevel', 'plan']]);
    if (bound) {
      expect(h.runtime.setModel).toHaveBeenCalledWith('session', 'new', { applyTo: 'workspace' });
      expect(h.runtime.setEffort).toHaveBeenCalledWith('session', 'high', { applyTo: 'workspace' });
      expect(h.runtime.setPermission).toHaveBeenCalledWith('session', 'plan', { applyTo: 'global', autopilot: { enabled: true, permissionLevel: 'plan' } });
    }
  });

  it('saves without applying when the SDK session query is not initialized', async () => {
    const h = fixture(false);
    jest.mocked(h.legacy.setSessionModel).mockRejectedValue(new SdkError('Session query not initialized: idle'));
    const response = await h.call('config:model-switch', { model: 'new', sessionId: 'idle' });
    expect(response.success).toBe(true);
    expect(h.model.selectedModel.set).toHaveBeenCalledTimes(1);
  });

  it('does not swallow a live failure merely containing similar text', async () => {
    const h = fixture(false);
    jest.mocked(h.legacy.setSessionModel).mockRejectedValue(new Error('Session not found: remote dependency'));
    const response = await h.call('config:model-switch', { model: 'new', sessionId: 'live' });
    expect(response.success).toBe(false);
    expect(h.model.selectedModel.set).not.toHaveBeenCalled();
  });

  it('preserves a disabled autopilot selection through the bound persistence owner', async () => {
    const h = fixture();
    const result = await h.call('config:autopilot-toggle', { enabled: false, permissionLevel: 'plan', sessionId: 'session' });
    expect(result.success).toBe(true);
    expect(h.runtime.setPermission).toHaveBeenCalledWith('session', 'ask', {
      applyTo: 'global', autopilot: { enabled: false, permissionLevel: 'plan' },
    });
    expect(h.config.set.mock.calls).toEqual([['autopilot.enabled', false], ['autopilot.permissionLevel', 'plan']]);
  });

});
