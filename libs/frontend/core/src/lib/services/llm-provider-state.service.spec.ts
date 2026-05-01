/**
 * LlmProviderStateService specs — LLM provider catalog + API key lifecycle.
 *
 * Coverage:
 *   - `loadProviderStatus` calls `llm:getProviderStatus`, populates `providers`
 *     + `defaultProvider`, and is idempotent on subsequent calls (guarded by
 *     internal `_isLoaded`).
 *   - `loadProviderStatus` deduplicates concurrent calls (returns the same
 *     in-flight promise).
 *   - `loadProviderModels` / `loadVsCodeModels` populate the providerModels
 *     map and track per-provider loading state in `loadingModels`.
 *   - `setApiKey` / `removeApiKey` trigger a status refresh on success and
 *     set `_error` on failure.
 *   - `setDefaultProvider` updates the `defaultProvider` signal locally on
 *     success.
 *   - `setDefaultModel` surfaces a friendlier message on "unsaved changes"
 *     VS Code settings conflicts.
 *   - `vsCodeModels` computed reads from the providerModels map.
 */

import { TestBed } from '@angular/core/testing';
import type { LlmProviderName } from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { LlmProviderStateService } from './llm-provider-state.service';
import {
  createMockRpcService,
  makeSignalStoreHarness,
  rpcError,
  rpcSuccess,
  type MockRpcService,
} from '../../testing';

interface LlmProviderStoreState {
  providers: ReadonlyArray<{
    provider: LlmProviderName;
    displayName: string;
    isConfigured: boolean;
    defaultModel: string;
    capabilities: readonly string[];
  }>;
  defaultProvider: LlmProviderName | '';
  isLoading: boolean;
  error: string;
  providerModels: ReadonlyMap<
    string,
    Array<{ id: string; displayName: string }>
  >;
  loadingModels: ReadonlySet<string>;
  vsCodeModels: ReadonlyArray<{ id: string; displayName: string }>;
}

describe('LlmProviderStateService', () => {
  let rpc: MockRpcService;
  let consoleError: jest.SpyInstance;

  function createService(): LlmProviderStateService {
    TestBed.configureTestingModule({
      providers: [
        LlmProviderStateService,
        { provide: ClaudeRpcService, useValue: rpc },
      ],
    });
    return TestBed.inject(LlmProviderStateService);
  }

  beforeEach(() => {
    rpc = createMockRpcService();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('initial state', () => {
    it('starts with empty providers and no default', () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      expect(harness.read()).toMatchObject({
        providers: [],
        defaultProvider: '',
        isLoading: false,
        error: '',
      });
    });
  });

  describe('loadProviderStatus()', () => {
    it('populates providers and defaultProvider from the RPC response', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          providers: [
            {
              provider: 'vscode-lm',
              displayName: 'VS Code LM',
              isConfigured: true,
              defaultModel: 'gpt-5',
              capabilities: ['text-chat'],
            },
          ],
          defaultProvider: 'vscode-lm' as LlmProviderName,
        }),
      );

      await service.loadProviderStatus();

      expect(rpc.call).toHaveBeenCalledWith('llm:getProviderStatus', {});
      expect(harness.signal('providers')).toHaveLength(1);
      expect(harness.signal('defaultProvider')).toBe('vscode-lm');
      expect(harness.signal('isLoading')).toBe(false);
    });

    it('stores an error message and keeps _isLoaded=false on RPC failure', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(rpcError('server unreachable'));
      await service.loadProviderStatus();

      expect(harness.signal('error')).toBe('server unreachable');

      // Subsequent call should retry because the previous attempt failed.
      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ providers: [], defaultProvider: '' }),
      );
      await service.loadProviderStatus();
      const statusCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'llm:getProviderStatus',
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('is a no-op once loaded (guard via _isLoaded)', async () => {
      const service = createService();

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ providers: [], defaultProvider: '' }),
      );
      await service.loadProviderStatus();
      const afterFirst = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'llm:getProviderStatus',
      ).length;

      await service.loadProviderStatus();
      const afterSecond = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'llm:getProviderStatus',
      ).length;

      expect(afterSecond).toBe(afterFirst);
    });

    it('deduplicates concurrent loadProviderStatus calls', async () => {
      const service = createService();

      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const first = service.loadProviderStatus();
      const second = service.loadProviderStatus();
      resolveInflight?.(rpcSuccess({ providers: [], defaultProvider: '' }));

      await Promise.all([first, second]);

      const statusCalls = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'llm:getProviderStatus',
      );
      expect(statusCalls).toHaveLength(1);
    });

    it('catches thrown errors and records them on the error signal', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockRejectedValueOnce(new Error('boom'));
      await service.loadProviderStatus();

      expect(harness.signal('error')).toBe('boom');
    });
  });

  describe('loadProviderModels() / loadVsCodeModels()', () => {
    it('populates providerModels map from llm:listProviderModels', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          models: [
            { id: 'm1', displayName: 'Model One' },
            { id: 'm2', displayName: '' },
          ],
        }),
      );

      await service.loadProviderModels('vscode-lm');

      expect(rpc.call).toHaveBeenCalledWith('llm:listProviderModels', {
        provider: 'vscode-lm',
      });
      const models = harness.signal('providerModels').get('vscode-lm');
      expect(models).toEqual([
        { id: 'm1', displayName: 'Model One' },
        { id: 'm2', displayName: 'm2' }, // fallback to id when displayName missing
      ]);
      expect(harness.signal('vsCodeModels')).toEqual(models);
    });

    it('tracks per-provider loading state transitions', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      let resolveInflight: ((v: unknown) => void) | undefined;
      rpc.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInflight = resolve;
          }),
      );

      const pending = service.loadProviderModels('vscode-lm');
      expect(harness.signal('loadingModels').has('vscode-lm')).toBe(true);

      resolveInflight?.(rpcSuccess({ models: [] }));
      await pending;
      expect(harness.signal('loadingModels').has('vscode-lm')).toBe(false);
    });

    it('loadVsCodeModels delegates to loadProviderModels("vscode-lm")', async () => {
      const service = createService();
      rpc.call.mockResolvedValueOnce(rpcSuccess({ models: [] }));

      await service.loadVsCodeModels();

      expect(rpc.call).toHaveBeenCalledWith('llm:listProviderModels', {
        provider: 'vscode-lm',
      });
    });

    it('clears loadingModels even when the RPC throws', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockRejectedValueOnce(new Error('boom'));
      await service.loadProviderModels('vscode-lm');

      expect(harness.signal('loadingModels').has('vscode-lm')).toBe(false);
    });
  });

  describe('setApiKey() / removeApiKey()', () => {
    it('setApiKey refreshes provider status on success', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true })) // setApiKey
        .mockResolvedValueOnce(
          rpcSuccess({ providers: [], defaultProvider: '' }),
        ) // fetchProviderStatus
        .mockResolvedValueOnce(rpcSuccess({ models: [] })); // loadProviderModels

      const ok = await service.setApiKey('vscode-lm', 'sk-test');

      expect(ok).toBe(true);
      expect(rpc.call).toHaveBeenCalledWith('llm:setApiKey', {
        provider: 'vscode-lm',
        apiKey: 'sk-test',
      });
    });

    it('setApiKey stores the error message on failure', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'invalid-key' }),
      );

      const ok = await service.setApiKey('vscode-lm', 'bad');

      expect(ok).toBe(false);
      expect(harness.signal('error')).toBe('invalid-key');
    });

    it('removeApiKey refreshes on success', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(
          rpcSuccess({ providers: [], defaultProvider: '' }),
        );

      const ok = await service.removeApiKey('vscode-lm');

      expect(ok).toBe(true);
      expect(rpc.call).toHaveBeenCalledWith('llm:removeApiKey', 'vscode-lm');
    });

    it('removeApiKey stores a thrown error message', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockRejectedValueOnce(new Error('network'));
      const ok = await service.removeApiKey('vscode-lm');

      expect(ok).toBe(false);
      expect(harness.signal('error')).toBe('network');
    });
  });

  describe('setDefaultProvider() / setDefaultModel()', () => {
    it('setDefaultProvider updates the defaultProvider signal on success', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(rpcSuccess({ success: true }));

      const ok = await service.setDefaultProvider('openrouter');

      expect(ok).toBe(true);
      expect(harness.signal('defaultProvider')).toBe('openrouter');
    });

    it('setDefaultProvider surfaces RPC errors', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({ success: false, error: 'not allowed' }),
      );
      const ok = await service.setDefaultProvider('openrouter');

      expect(ok).toBe(false);
      expect(harness.signal('error')).toBe('not allowed');
    });

    it('setDefaultModel refreshes status on success', async () => {
      const service = createService();
      rpc.call
        .mockResolvedValueOnce(rpcSuccess({ success: true }))
        .mockResolvedValueOnce(
          rpcSuccess({ providers: [], defaultProvider: '' }),
        );

      const ok = await service.setDefaultModel('vscode-lm', 'gpt-5');

      expect(ok).toBe(true);
      expect(rpc.call).toHaveBeenCalledWith('llm:setDefaultModel', {
        provider: 'vscode-lm',
        model: 'gpt-5',
      });
    });

    it('setDefaultModel rewrites the "unsaved changes" VS Code conflict into a friendly message', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<LlmProviderStoreState>(service);

      rpc.call.mockResolvedValueOnce(
        rpcSuccess({
          success: false,
          error: 'settings file has unsaved changes',
        }),
      );

      const ok = await service.setDefaultModel('vscode-lm', 'gpt-5');

      expect(ok).toBe(false);
      expect(harness.signal('error')).toContain('save and close');
    });
  });
});
