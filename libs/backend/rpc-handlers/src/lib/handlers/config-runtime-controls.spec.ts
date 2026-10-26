import 'reflect-metadata';
import {
  SdkAgentAdapter,
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
    const h = fixture();
    const order: string[] = [];
    h.runtime.setModel.mockImplementation(async () => {
      order.push('apply');
      return { timing: 'effectiveNow', revision: 1 };
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
    const h = fixture();
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
});
