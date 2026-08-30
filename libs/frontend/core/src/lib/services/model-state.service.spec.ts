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
import { getPricingMap, type SdkModelInfo } from '@ptah-extension/shared';
import { ClaudeRpcService } from './claude-rpc.service';
import { ModelStateService } from './model-state.service';
import { WorkspaceScopeService } from './workspace-scope.service';
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

  describe('pricing hydration (config:pricing-get)', () => {
    /** Route each RPC method to its own canned response. */
    function routeRpc(handlers: Record<string, unknown>): void {
      rpc.call.mockImplementation((method: string) =>
        Promise.resolve(
          (handlers[method] as never) ?? rpcSuccess({ models: [] }),
        ),
      );
    }

    it('merges the host pricing map into this bundle at construction', async () => {
      routeRpc({
        'config:pricing-get': rpcSuccess({
          pricing: {
            'anthropic/claude-opus-5': {
              inputCostPerToken: 5e-6,
              outputCostPerToken: 25e-6,
              maxTokens: 1_000_000,
              provider: 'openrouter',
            },
          },
          hydrated: true,
        }),
      });

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      // `pricing.utils` keeps its map in a module-level `let`, and the webview
      // loads its OWN instance — so without this call the renderer's map never
      // held a single Claude model.
      expect(rpc.call).toHaveBeenCalledWith('config:pricing-get', {});
      expect(getPricingMap()['anthropic/claude-opus-5']).toBeDefined();
    });

    it('keeps the bundled map when the host cannot hydrate', async () => {
      routeRpc({ 'config:pricing-get': rpcError('offline') });

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      // Degraded, not broken — the bundled entries are still there.
      expect(getPricingMap()['gpt-4o']).toBeDefined();
    });

    it('retries hydration on refresh when the first attempt was not hydrated', async () => {
      routeRpc({
        'config:pricing-get': rpcSuccess({ pricing: {}, hydrated: false }),
      });

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      const before = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:pricing-get',
      ).length;
      await service.refreshModels();
      const after = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:pricing-get',
      ).length;

      // A boot that raced the catalog fetch must not be stuck on the bundled
      // table for the rest of the run.
      expect(after).toBeGreaterThan(before);
    });

    it('does not re-fetch on refresh once hydrated', async () => {
      routeRpc({
        'config:pricing-get': rpcSuccess({ pricing: {}, hydrated: true }),
      });

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      const before = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:pricing-get',
      ).length;
      await service.refreshModels();
      const after = rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:pricing-get',
      ).length;

      expect(after).toBe(before);
    });
  });

  /**
   * TASK_2026_345 — `config:models-list` once per burst.
   *
   * Six callers reach `refreshModels()`, and several share a cause:
   * `TabManagerService.createTab()` runs it for EVERY new tab and
   * `WorkspaceCoordinatorService` runs it on every workspace switch, which is
   * also when tabs are created. The captured boot issued the RPC six times
   * (`tmp/logs/log.log:628, 868, 1195, 1624, 1800, 2046`).
   */
  describe('config:models-list request coalescing', () => {
    function countModelsList(): number {
      return rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:models-list',
      ).length;
    }

    /** Hold every `config:models-list` open until `release()` is called. */
    function gateModelsList(models: SdkModelInfo[]): () => void {
      const waiters: Array<() => void> = [];
      rpc.call.mockImplementation((method: string) => {
        if (method !== 'config:models-list') {
          return Promise.resolve(rpcSuccess({}) as never);
        }
        return new Promise((resolve) => {
          waiters.push(() => resolve(rpcSuccess({ models }) as never));
        });
      });
      return () => {
        for (const resolve of waiters.splice(0, waiters.length)) resolve();
      };
    }

    it('makes one request for a burst of concurrent refreshes', async () => {
      const models = [makeModel({ id: 'sonnet', isSelected: true })];
      const release = gateModelsList(models);

      const service = createService();
      // The constructor's load is still in flight; four tabs open at once.
      const burst = Promise.all([
        service.refreshModels(),
        service.refreshModels(),
        service.refreshModels(),
        service.refreshModels(),
      ]);

      expect(countModelsList()).toBe(1);
      release();
      await burst;

      expect(countModelsList()).toBe(1);
      expect(service.availableModels()).toEqual(models);
    });

    it('still re-reads for a refresh that arrives after the previous one settled', async () => {
      // An auth change or a provider switch MUST re-read; this is a coalescer,
      // not a cache.
      rpc.call.mockImplementation((method: string) =>
        Promise.resolve(
          (method === 'config:models-list'
            ? rpcSuccess({ models: [makeModel({ id: 'sonnet' })] })
            : rpcSuccess({})) as never,
        ),
      );

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      const before = countModelsList();
      await service.refreshModels();
      await service.refreshModels();

      expect(countModelsList()).toBe(before + 2);
    });

    it('releases the latch when the request fails, so a retry is not swallowed', async () => {
      rpc.call.mockImplementation((method: string) =>
        method === 'config:models-list'
          ? Promise.reject(new Error('transport gone'))
          : Promise.resolve(rpcSuccess({}) as never),
      );

      const service = createService();
      const harness = makeSignalStoreHarness<ModelStoreState>(service);
      await harness.flush();

      const before = countModelsList();
      await service.refreshModels();

      expect(countModelsList()).toBe(before + 1);
    });
  });

  /**
   * TASK_2026_345, judge round 1 — two call sites colliding across a switch.
   *
   * `config:models-list` carries no workspace parameter and the host resolves
   * the active provider at RPC-PROCESSING time (see the note on
   * `WorkspaceCoordinatorService.refreshWorkspaceProviderState`).
   * `TabManagerService.createTab()` calls `refreshModels()` unconditionally and
   * the coordinator calls it right after a switch precisely to get the NEW
   * provider's models. With an unkeyed latch the post-switch caller awaited the
   * pre-switch request and received the OLD provider's list, defeating the
   * coordinator's own `switchGeneration` guard.
   */
  describe('config:models-list across a workspace switch', () => {
    const QA = 'D:/projects/qa3elhamor';
    const HUB = 'D:/projects/property-hub';

    const QA_MODELS = [makeModel({ id: 'sonnet', isSelected: true })];
    const HUB_MODELS = [
      makeModel({ id: 'gpt-5-codex', name: 'Codex', isSelected: true }),
    ];

    function countModelsList(): number {
      return rpc.call.mock.calls.filter(
        (c: unknown[]) => c[0] === 'config:models-list',
      ).length;
    }

    /**
     * Model the host: every `config:models-list` is answered against whichever
     * workspace is active when it is PROCESSED, and replies are held until
     * `release()` so a switch can be interleaved.
     */
    function gateHost(start: string): {
      setHostWorkspace: (path: string) => void;
      release: () => void;
    } {
      let hostWorkspace = start;
      const waiters: Array<() => void> = [];

      rpc.call.mockImplementation((method: string) => {
        if (method !== 'config:models-list') {
          return Promise.resolve(rpcSuccess({}) as never);
        }
        return new Promise((resolve) => {
          waiters.push(() =>
            resolve(
              rpcSuccess({
                models: hostWorkspace === QA ? QA_MODELS : HUB_MODELS,
              }) as never,
            ),
          );
        });
      });

      return {
        setHostWorkspace: (path: string) => {
          hostWorkspace = path;
        },
        release: () => {
          for (const resolve of waiters.splice(0, waiters.length)) resolve();
        },
      };
    }

    it('does not answer a post-switch caller with the pre-switch request', async () => {
      const host = gateHost(QA);
      const service = createService();
      const scope = TestBed.inject(WorkspaceScopeService);
      scope.switchTo(QA);

      // Call site 1: `TabManagerService.createTab()` on the old workspace.
      const stale = service.refreshModels();
      expect(countModelsList()).toBeGreaterThanOrEqual(1);
      const beforeSwitch = countModelsList();

      // The switch. `WorkspaceCoordinatorService` moves the scope in its
      // synchronous fan-out, before it dispatches the refresh below.
      scope.switchTo(HUB);
      host.setHostWorkspace(HUB);

      // Call site 2: `refreshWorkspaceProviderState`, asking for the NEW
      // provider's models.
      const fresh = service.refreshModels();
      // A NEW round trip, not the pre-switch one handed back. (Identity of the
      // returned promise proves nothing here — `refreshModels` is an async
      // wrapper and mints a fresh promise per call; the request count is the
      // observable contract.)
      expect(countModelsList()).toBe(beforeSwitch + 1);

      host.release();
      await Promise.all([stale, fresh]);

      expect(service.availableModels()).toEqual(HUB_MODELS);
      expect(service.currentModel()).toBe('gpt-5-codex');
    });

    it('discards a stale response that lands after the switch', async () => {
      // The other half: not just "do not JOIN the old request" but "do not let
      // the old request WRITE". The host answers it against whatever workspace
      // it sees, so its list belongs to neither scope reliably.
      const host = gateHost(QA);
      const service = createService();
      const scope = TestBed.inject(WorkspaceScopeService);
      scope.switchTo(QA);

      const stale = service.refreshModels();
      scope.switchTo(HUB);
      host.release();
      await stale;

      expect(service.availableModels()).toEqual([]);
      expect(service.currentModel()).toBe('');
    });

    it('still coalesces a burst of callers WITHIN one workspace', async () => {
      // The keying must not undo round 1: four tabs opening on one workspace
      // are still one request.
      const host = gateHost(QA);
      const service = createService();
      const scope = TestBed.inject(WorkspaceScopeService);
      scope.switchTo(QA);

      const before = countModelsList();
      const burst = Promise.all([
        service.refreshModels(),
        service.refreshModels(),
        service.refreshModels(),
        service.refreshModels(),
      ]);
      expect(countModelsList()).toBe(before + 1);

      host.release();
      await burst;
      expect(service.availableModels()).toEqual(QA_MODELS);
    });

    it('does not invalidate on a redundant switch to the active workspace', async () => {
      const host = gateHost(QA);
      const service = createService();
      const scope = TestBed.inject(WorkspaceScopeService);
      scope.switchTo(QA);

      const first = service.refreshModels();
      const before = countModelsList();
      // A redundant switch to the workspace already active must not throw the
      // in-flight request away — `TabManagerService.switchWorkspace` and
      // `AppStateManager.switchWorkspace` both early-return on this case, so it
      // is reachable, and invalidating here would put the duplicate round trips
      // straight back.
      scope.switchTo(QA);
      const joined = service.refreshModels();

      expect(countModelsList()).toBe(before);

      host.release();
      await Promise.all([first, joined]);
      expect(service.availableModels()).toEqual(QA_MODELS);
    });
  });
});
