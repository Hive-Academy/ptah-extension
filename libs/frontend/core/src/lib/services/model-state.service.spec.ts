/**
 * ModelStateService specs — signal-based model selection with optimistic
 * RPC updates and computed display signals.
 *
 * Coverage:
 *   - Constructor loads models via `config:models-list` and sets the selected
 *     model from the backend payload (`isSelected`).
 *   - `switchModel` optimistically updates current model + isSelected flags,
 *     persists via `config:model-switch`, rolls back on RPC failure.
 *   - Concurrent `switchModel` calls are gated by `_isPending`.
 *   - Computed signals: `currentModelDisplay`, `currentModelProviderHint`,
 *     `currentModelInfo`.
 *   - `refreshModels` re-invokes the loader.
 */

import { TestBed } from '@angular/core/testing';
import type { SdkModelInfo } from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { ModelStateService } from './model-state.service';
import {
  createMockRpcService,
  makeSignalStoreHarness,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

interface ModelStoreState {
  currentModel: string;
  isPending: boolean;
  isLoaded: boolean;
  availableModels: readonly SdkModelInfo[];
  currentModelDisplay: string;
  currentModelProviderHint: string | null;
  currentModelInfo: SdkModelInfo | undefined;
}

function makeModel(overrides: Partial<SdkModelInfo> = {}): SdkModelInfo {
  return {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    description: 'Balanced model',
    isSelected: false,
    providerModelId: null,
    ...overrides,
  };
}

describe('ModelStateService', () => {
  let rpc: MockRpcService;
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  function createService(): ModelStateService {
    TestBed.configureTestingModule({
      providers: [
        ModelStateService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    return TestBed.inject(ModelStateService);
  }

  beforeEach(() => {
    rpc = createMockRpcService();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('initial load (config:models-list)', () => {
    it('loads models and sets currentModel from the one marked isSelected', async () => {
      const models = [
        makeModel({ id: 'opus', name: 'Claude Opus', isSelected: false }),
        makeModel({ id: 'sonnet', name: 'Claude Sonnet', isSelected: true }),
      ];
      rpc.call.mockResolvedValueOnce(rpcSuccess({ models }));

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(rpc.call).toHaveBeenCalledWith('config:models-list', {});
      expect(harness.signal('currentModel')).toBe('sonnet');
      expect(harness.signal('isLoaded')).toBe(true);
      expect(harness.signal('availableModels')).toHaveLength(2);
    });

    it('sets isLoaded=true when no model is marked selected (fallback path)', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ models: [makeModel({ id: 'a' })] }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('isLoaded')).toBe(true);
      expect(harness.signal('currentModel')).toBe('');
    });

    it('marks isLoaded=true even when the RPC fails', async () => {
      rpc.call.mockResolvedValueOnce(rpcError('no models'));
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('isLoaded')).toBe(true);
      expect(harness.signal('availableModels')).toEqual([]);
    });

    it('marks isLoaded=true when the RPC throws', async () => {
      rpc.call.mockRejectedValueOnce(new Error('network'));
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('isLoaded')).toBe(true);
    });
  });

  describe('switchModel()', () => {
    async function mkLoaded(): Promise<{
      service: ModelStateService;
      harness: ReturnType<typeof makeSignalStoreHarness<ModelStoreState>>;
    }> {
      const models = [
        makeModel({ id: 'opus', name: 'Opus', isSelected: false }),
        makeModel({ id: 'sonnet', name: 'Sonnet', isSelected: true }),
      ];
      rpc.call.mockResolvedValueOnce(rpcSuccess({ models }));
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();
      return { service, harness };
    }

    it('optimistically updates currentModel and isSelected flags', async () => {
      const { service, harness } = await mkLoaded();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));

      const pending = service.switchModel('opus');
      expect(harness.signal('currentModel')).toBe('opus');
      const models = harness.signal('availableModels');
      expect(
        models.find((m: SdkModelInfo) => m.id === 'opus')?.isSelected,
      ).toBe(true);
      expect(
        models.find((m: SdkModelInfo) => m.id === 'sonnet')?.isSelected,
      ).toBe(false);

      await pending;

      expect(rpc.call).toHaveBeenCalledWith('config:model-switch', {
        model: 'opus',
        sessionId: null,
      });
      expect(harness.signal('isPending')).toBe(false);
    });

    it('rolls back currentModel + isSelected flags on RPC failure', async () => {
      const { service, harness } = await mkLoaded();
      rpc.call.mockResolvedValueOnce(rpcError('rejected'));

      await service.switchModel('opus');

      expect(harness.signal('currentModel')).toBe('sonnet');
      const models = harness.signal('availableModels');
      expect(
        models.find((m: SdkModelInfo) => m.id === 'sonnet')?.isSelected,
      ).toBe(true);
      expect(
        models.find((m: SdkModelInfo) => m.id === 'opus')?.isSelected,
      ).toBe(false);
    });

    it('ignores concurrent switchModel calls while isPending=true', async () => {
      const { service } = await mkLoaded();

      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const first = service.switchModel('opus');
      await service.switchModel('opus'); // guarded — returns immediately

      const switchCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:model-switch',
      );
      expect(switchCalls).toHaveLength(1);

      resolveInflight?.(rpcSuccess({ success: true }));
      await first;
    });

    it('forwards an explicit sessionId into the RPC params', async () => {
      const { service } = await mkLoaded();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));

      await service.switchModel(
        'opus',
        'sess-1' as unknown as Parameters<ModelStateService['switchModel']>[1],
      );

      expect(rpc.call).toHaveBeenCalledWith('config:model-switch', {
        model: 'opus',
        sessionId: 'sess-1',
      });
    });
  });

  describe('computed derivations', () => {
    it('currentModelDisplay falls back to the model id when no matching model is found', async () => {
      // No models loaded — display should reflect the raw id.
      rpc.call.mockResolvedValueOnce(rpcSuccess({ models: [] }));
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('currentModelDisplay')).toBe('');
    });

    it('currentModelProviderHint returns null when no override is configured', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          models: [
            makeModel({
              id: 'sonnet',
              isSelected: true,
              providerModelId: null,
            }),
          ],
        }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('currentModelProviderHint')).toBeNull();
    });

    it('currentModelProviderHint returns the provider hint when configured', async () => {
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          models: [
            makeModel({
              id: 'sonnet',
              isSelected: true,
              providerModelId: 'openai/gpt-5',
            }),
          ],
        }),
      );
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('currentModelProviderHint')).toBe('openai/gpt-5');
    });

    it('currentModelInfo returns the full metadata object', async () => {
      const sonnet = makeModel({
        id: 'sonnet',
        name: 'Claude Sonnet',
        isSelected: true,
      });
      rpc.call.mockResolvedValueOnce(rpcSuccess({ models: [sonnet] }));
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      expect(harness.signal('currentModelInfo')?.name).toBe('Claude Sonnet');
    });
  });

  describe('refreshModels()', () => {
    it('re-invokes the models-list RPC', async () => {
      rpc.call.mockResolvedValueOnce(rpcSuccess({ models: [] }));
      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          models: [makeModel({ id: 'haiku', isSelected: true })],
        }),
      );
      await service.refreshModels();

      expect(harness.signal('currentModel')).toBe('haiku');
      const listCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:models-list',
      );
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
