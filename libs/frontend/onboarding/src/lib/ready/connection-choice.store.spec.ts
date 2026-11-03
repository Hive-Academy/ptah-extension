import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthStateService, ProvidersSettingsStateService, defaultMainConnectionTarget } from '@ptah-extension/core';
import { ProviderReadinessStore } from './provider-readiness.store';
import { ConnectionChoiceStore } from './connection-choice.store';

describe('ConnectionChoiceStore', () => {
  const selection = signal<{ kind: 'claude-cli' | 'openai-codex' }>({ kind: 'claude-cli' });
  const commit = signal({ status: 'saved', refreshFailed: false });
  const activateConnection = jest.fn<Promise<{ started: boolean; selectionReread: 'ok' | 'failed' | 'not-run' }>, [string, string, object]>()
    .mockResolvedValue({ started: true, selectionReread: 'ok' });
  const refreshAuthStatus = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
  const retrySelection = jest.fn<Promise<boolean>, []>().mockResolvedValue(true);
  const markSelectionNotConfirmed = jest.fn();
  const state = {
    mainSources: signal({ status: 'ready', data: { model: { key: 'model', scope: 'workspace' }, effort: { key: 'effort' } } }),
    writeScopes: jest.fn((_key: string) => ['workspace', 'global']),
    reviewContext: jest.fn(() => ({ scopeKey: 'workspace', activePath: '/project' })),
    open: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    activateConnection, commit,
  };
  beforeEach(() => {
    selection.set({ kind: 'claude-cli' });
    commit.set({ status: 'saved', refreshFailed: false });
    activateConnection.mockClear().mockResolvedValue({ started: true, selectionReread: 'ok' });
    state.open.mockClear();
    TestBed.configureTestingModule({ providers: [
      ConnectionChoiceStore,
      { provide: ProvidersSettingsStateService, useValue: state },
      { provide: AuthStateService, useValue: { refreshAuthStatus } },
      { provide: ProviderReadinessStore, useValue: { selection, markSelectionNotConfirmed, retrySelection } },
    ] });
  });
  it('only opens the settings state on first changed choice and never writes before confirmation', () => {
    const choice = TestBed.inject(ConnectionChoiceStore);
    choice.choose('openai-codex');
    choice.choose('openai-codex');
    expect(state.open).toHaveBeenCalledTimes(1);
    expect(activateConnection).not.toHaveBeenCalled();
  });
  it('uses the popover target helper and sends the same scope to activation', async () => {
    const choice = TestBed.inject(ConnectionChoiceStore);
    const popoverTarget = defaultMainConnectionTarget(state as unknown as ProvidersSettingsStateService);
    choice.choose('openai-codex');
    await choice.confirm();
    expect(activateConnection).toHaveBeenCalledWith('openai-codex', popoverTarget, state.reviewContext());
    expect(choice.notice()).toBe(6);
  });
  it.each([
    [{ started: false, selectionReread: 'not-run' } as const, 'saving', 8],
    [{ started: true, selectionReread: 'not-run' } as const, 'failed', 9],
    [{ started: true, selectionReread: 'not-run' } as const, 'partial', 9],
    [{ started: true, selectionReread: 'not-run' } as const, 'blocked', 9],
    [{ started: true, selectionReread: 'not-run' } as const, 'unconfirmed', 10],
    [{ started: true, selectionReread: 'failed' } as const, 'saved', 11],
  ])('maps activation and commit outcome to notice %i', async (result, status, notice) => {
    const choice = TestBed.inject(ConnectionChoiceStore);
    activateConnection.mockResolvedValue(result);
    commit.set({ status, refreshFailed: false });
    choice.choose('openai-codex');
    await choice.confirm();
    expect(choice.notice()).toBe(notice);
  });
});

/** The popover calls this same public activation service; keep its real payload builder in the test. */
describe('stage 1 and main-agent popover RPC payload parity (AC 3.11 renderer)', () => {
  it.each(['claude-cli', 'openai-codex'] as const)('sends the same auth:saveSettings params for %s', async (provider) => {
    const { ClaudeRpcService, RpcResult, WorkspaceScopeService, ProvidersConnectionSetupService, CodexSignInService } =
      await import('@ptah-extension/core');
    const recorder = jest.fn<Promise<InstanceType<typeof RpcResult>>, [string, unknown, unknown?]>(
      async (method) => {
        if (method !== 'auth:saveSettings') throw new Error(`Unexpected RPC: ${method}`);
        return new RpcResult(true, { success: true });
      });
    const saved = signal<{ kind: 'other'; name: string }>({ kind: 'other', name: 'OpenRouter' });
    const mainSources = signal({ status: 'ready', data: {
      model: { key: 'model', scope: 'workspace' }, effort: { key: 'effort' },
    } });
    const commit = signal({ status: 'saved', refreshFailed: false });
    const context = { scopeKey: '', activePath: '/workspace' };
    const connection = { id: provider, name: provider, hasKey: false, configured: true,
      custom: false, defaultsResolvable: true, authMode: provider === 'claude-cli' ? 'cli' : 'oauth', accountLabel: null, tokenStale: false };
    const section = { status: 'ready', data: [connection], error: null };
    const scopes = { status: 'ready', data: { activePath: '/workspace', entries: [] }, error: null };
    const hooks: Parameters<ProvidersConnectionSetupService['activateConnection']>[3] = {
      connections: () => section as unknown as ReturnType<Parameters<ProvidersConnectionSetupService['activateConnection']>[3]['connections']>,
      writeScopes: () => ['workspace', 'global'],
      commit: { refreshScopes: async () => undefined, refresh: async () => undefined,
        scopes: () => scopes as unknown as ReturnType<Parameters<ProvidersConnectionSetupService['activateConnection']>[3]['commit']['scopes']>,
        sectionsReady: () => true },
      refreshConnections: async () => undefined, refreshRoute: async () => undefined,
      route: () => ({ status: 'ready', data: null, error: null }) as unknown as ReturnType<Parameters<ProvidersConnectionSetupService['activateConnection']>[3]['route']>,
      refreshAuthStatus: async () => true,
    };
    const state = {
      mainSources, writeScopes: jest.fn((_key: string) => ['workspace', 'global']),
      reviewContext: () => context, open: async () => undefined, commit,
      activateConnection: async (id: string, target: 'workspace' | 'global', editContext: typeof context) =>
        setup.activateConnection(id, target, editContext, hooks),
    };
    TestBed.configureTestingModule({ providers: [
      ConnectionChoiceStore, WorkspaceScopeService,
      { provide: ClaudeRpcService, useValue: { call: recorder } },
      { provide: CodexSignInService, useValue: { state: () => null, start: async () => undefined, cancel: async () => undefined } },
      { provide: AuthStateService, useValue: { refreshAuthStatus: async () => true } },
      { provide: ProviderReadinessStore, useValue: { selection: saved, markSelectionNotConfirmed: jest.fn(), retrySelection: async () => true } },
      { provide: ProvidersSettingsStateService, useValue: state },
    ] });
    const workspace = TestBed.inject(WorkspaceScopeService);
    workspace.switchTo('/workspace');
    context.scopeKey = workspace.scopeKey();
    const setup = TestBed.inject(ProvidersConnectionSetupService);
    const choice = TestBed.inject(ConnectionChoiceStore);
    choice.choose(provider);
    await choice.confirm();
    const stageParams = recorder.mock.calls.find(([method]) => method === 'auth:saveSettings')?.[1];
    expect(stageParams).toBeDefined();
    recorder.mockClear();
    // main-agent-reassign-popover.component.ts calls state.activateConnection(pending.id, target, context).
    const popoverTarget = defaultMainConnectionTarget(state as unknown as ProvidersSettingsStateService);
    expect(popoverTarget).not.toBeNull();
    await setup.activateConnection(provider, popoverTarget!, context, hooks);
    const popoverParams = recorder.mock.calls.find(([method]) => method === 'auth:saveSettings')?.[1];
    expect(popoverParams).toEqual(stageParams);
  });
});
